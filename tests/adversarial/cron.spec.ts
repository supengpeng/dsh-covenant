import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { entryFrom, EvidenceChain, generateKeyPair, type Binding } from '@dsh-covenant/evidence-model'
import { assertNoSharedChannels } from '@dsh-covenant/worker-host-runtime'
import type { Verdict } from '@dsh-covenant/assertion'
import {
  AdversarialCronRunner,
  cronMatches,
  nextRunAfter,
  parseExternalSamples,
  readExternalSamplesFile,
  type AdversarialCategory,
  type AdversarialSample,
} from '@dsh-covenant/orchestrator-core'

const fixtures = (...p: string[]): string => path.resolve(process.cwd(), 'tests/adversarial/fixtures', ...p)

const DETECTORS: Record<AdversarialCategory, (s: AdversarialSample) => boolean> = {
  'isolation-escape': (s) => {
    const p = s.payload as { sharedFile: string; sharedPort: number; sharedCache: string }
    const violations = assertNoSharedChannels(
      { file: p.sharedFile, port: p.sharedPort, cache: p.sharedCache },
      { file: p.sharedFile, port: p.sharedPort, cache: p.sharedCache },
    )
    return violations.length >= 3
  },
  'forge-evidence': (s) => {
    const p = s.payload as { forgedVerdict: string; noise: string }
    const kp = generateKeyPair()
    const binding: Binding = { envSnapshot: 'e', toolVersion: '1', modelVersion: 'v1', seed: 's', executionOrder: ['x'] }
    const base = EvidenceChain.genesis(binding, kp.publicKeyPem)
      .append(entryFrom({ verdict: 'fail', evidence: 'original', confidence: { score: 1, basis: 't' }, channel: 'c' }))
      .seal(kp.privateKeyPem)
    const forged = EvidenceChain.genesis(binding, kp.publicKeyPem)
      .append(entryFrom({ verdict: (p.forgedVerdict.includes('pass') ? 'pass' : 'fail') as Verdict, evidence: p.noise, confidence: { score: 1, basis: 't' }, channel: 'c' }))
      .withSignature(base.signature)
    return base.verify() && !forged.verify()
  },
  'privilege-escalation': (s) => {
    const p = s.payload as { vmTier: boolean; requireSecurityIsolation: boolean }
    return p.vmTier === true && p.requireSecurityIsolation === true
  },
  'violating-plugin': (s) => {
    const p = s.payload as { violatesContract: boolean }
    return p.violatesContract === true
  },
}

const detect = (s: AdversarialSample): boolean => DETECTORS[s.category](s)

describe('cron 解析（真实时间调度基础）', () => {
  it('cronMatches 命中 */15 整点', () => {
    expect(cronMatches('*/15 * * * *', new Date(2026, 0, 1, 0, 0))).toBe(true)
    expect(cronMatches('*/15 * * * *', new Date(2026, 0, 1, 0, 15))).toBe(true)
    expect(cronMatches('*/15 * * * *', new Date(2026, 0, 1, 0, 14))).toBe(false)
  })

  it('nextRunAfter 计算下一个触发时刻', () => {
    expect(nextRunAfter('*/15 * * * *', new Date(2026, 0, 1, 0, 0))?.getTime()).toBe(new Date(2026, 0, 1, 0, 15).getTime())
    expect(nextRunAfter('0 3 * * *', new Date(2026, 0, 1, 0, 0))?.getTime()).toBe(new Date(2026, 0, 1, 3, 0).getTime())
  })

  it('非法表达式抛错', () => {
    expect(() => cronMatches('not a cron', new Date())).toThrow()
  })
})

describe('外部样本供给（本地 JSON manifest）', () => {
  it('读取并解析合法 manifest，字段齐全', () => {
    const set = readExternalSamplesFile(fixtures('external-v1.json'))
    expect(set.schemaVersion).toBe(1)
    expect(set.version).toBe('external:v1')
    expect(set.samples.length).toBe(4)
    for (const s of set.samples) {
      expect(s.category).toBeTruthy()
      expect(s.id).toBeTruthy()
    }
  })

  it('非法 manifest 一律 FAIL（schemaVersion / 空集 / 未知类别）', () => {
    expect(() => parseExternalSamples('{}')).toThrow(/schemaVersion/)
    expect(() => parseExternalSamples('{"schemaVersion":1,"version":"v","samples":[]}')).toThrow(/empty|must not be empty/)
    expect(() =>
      parseExternalSamples('{"schemaVersion":1,"version":"v","samples":[{"id":"x","category":"hax","payload":{}}]}'),
    ).toThrow(/unknown category/)
    expect(() => parseExternalSamples('not json')).toThrow(/valid JSON/)
  })
})

describe('AdversarialCronRunner（真实时间 cron + 外部样本周期）', () => {
  function supplier(cycleIndex: number): readonly AdversarialSample[] {
    return readExternalSamplesFile(fixtures(cycleIndex === 0 ? 'external-v1.json' : 'external-v2.json')).samples
  }

  it('到达 cron 触发点才引入外部样本，未到期不触发', async () => {
    const runner = new AdversarialCronRunner({
      cron: '*/15 * * * *',
      startFrom: new Date(2026, 0, 1, 0, 0),
      supplier,
      detect,
    })
    // 00:14 未到 00:15 → 无结果
    expect(await runner.run(new Date(2026, 0, 1, 0, 14))).toEqual([])
    // 00:30 → 触发 00:15、00:30 两次（cycleIndex 0/1 → v1/v2），均 100% 检出
    const results = await runner.run(new Date(2026, 0, 1, 0, 30))
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.detected, `detected=${r.detected} total=${r.total}`).toBe(r.total)
      expect(r.missed).toEqual([])
    }
  })

  it('漏检即 FAIL（missed > 0）', async () => {
    const runner = new AdversarialCronRunner({
      cron: '*/15 * * * *',
      startFrom: new Date(2026, 0, 1, 0, 0),
      supplier,
      detect: () => false,
    })
    const results = await runner.run(new Date(2026, 0, 1, 0, 15))
    expect(results.length).toBe(1)
    expect(results[0]!.missed.length).toBe(4)
  })

  it('空样本供给即 FAIL（不静默通过）', async () => {
    const runner = new AdversarialCronRunner({
      cron: '*/15 * * * *',
      startFrom: new Date(2026, 0, 1, 0, 0),
      supplier: async () => [],
      detect,
    })
    await expect(runner.run(new Date(2026, 0, 1, 0, 15))).rejects.toThrow(/empty sample set/)
  })
})