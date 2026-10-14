import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { SubprocessHostAdapter, VmHostAdapter } from '@dsh-covenant/host-adapter'
import { entryFrom, EvidenceChain, generateKeyPair, type Binding } from '@dsh-covenant/evidence-model'
import { assertNoSharedChannels } from '@dsh-covenant/worker-host-runtime'
import type { VerdictRecord } from '@dsh-covenant/assertion'

/**
 * 对抗集（architecture.md §15.7 F17；development.md Task 16/17）。
 * 平台对自己的判定能力做「能红」式验证：已知恶意/违规注入必须 100% 检出，
 * 任一漏检即判 FAIL（此处表现为测试失败）。
 */

const fixtures = (...p: string[]): string => path.resolve(process.cwd(), 'tests/adversarial/fixtures', ...p)

const adversarialCases: ReadonlyArray<{ name: string; detect: () => Promise<boolean> }> = [
  {
    name: '违规插件（装载失败）',
    detect: async () => {
      const handle = await new SubprocessHostAdapter().spawn({ tier: 'subprocess', timeout: 8000 })
      const loaded = await handle.load({ module: fixtures('violating-plugin.mjs') })
      await handle.dispose(loaded)
      return loaded.state === 'FAILED'
    },
  },
  {
    name: '越权（vm 档请求安全隔离）',
    detect: async () => {
      try {
        await new VmHostAdapter().spawn({ tier: 'vm', requireSecurityIsolation: true })
        return false
      } catch {
        return true
      }
    },
  },
  {
    name: '伪造证据（篡改证据链）',
    detect: async () => {
      const kp = generateKeyPair()
      const binding: Binding = { envSnapshot: 'e', toolVersion: '1', modelVersion: 'v1', seed: 's', executionOrder: ['x'] }
      const rec: VerdictRecord = { verdict: 'fail', evidence: 'real evidence', confidence: { score: 1, basis: 't' }, channel: 'c' }
      const chain = EvidenceChain.genesis(binding, kp.publicKeyPem).append(entryFrom(rec)).seal(kp.privateKeyPem)
      // 伪造：把 fail 改成 pass，重放原签名
      const forged = EvidenceChain.genesis(binding, kp.publicKeyPem)
        .append(entryFrom({ ...rec, verdict: 'pass', evidence: 'forged' }))
        .withSignature(chain.signature)
      return chain.verify() && !forged.verify()
    },
  },
  {
    name: '隔离逃逸（跨实例共享信道）',
    detect: async () => {
      const shared = {}
      const violations = assertNoSharedChannels(
        { sharedMemory: shared, file: '/same', port: 80 },
        { sharedMemory: shared, file: '/same', port: 80 },
      )
      return violations.length === 3 && violations.includes('shared-memory') && violations.includes('file') && violations.includes('port')
    },
  },
]

describe('对抗集（F17：100% 检出，漏检即 FAIL）', () => {
  it(`全部 ${adversarialCases.length} 个恶意/违规注入样本均被检出`, async () => {
    const results: Array<{ name: string; detected: boolean }> = []
    for (const c of adversarialCases) {
      results.push({ name: c.name, detected: await c.detect() })
    }
    expect(results.length).toBe(4)
    for (const r of results) {
      expect(r.detected, `对抗样本「${r.name}」漏检`).toBe(true)
    }
  })
})