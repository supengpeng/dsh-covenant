import { describe, expect, it } from 'vitest'
import { entryFrom, EvidenceChain, generateKeyPair, type Binding } from '@dsh-covenant/evidence-model'
import { assertNoSharedChannels } from '@dsh-covenant/worker-host-runtime'
import type { Verdict } from '@dsh-covenant/assertion'
import {
  samplesForCycle,
  verifyCycle,
  type AdversarialCategory,
  type AdversarialSample,
  type BaseSample,
} from '@dsh-covenant/orchestrator-core'

/**
 * 对抗集「新变种周期」可重放验证（F17 / development §11.3 默认口径）。
 * 检测器键在「语义信号 = 布尔/数值/结构字段」，`perturb` 仅扰动字符串噪声 + 键序 + 数组，
 * 故等价变形不破坏语义、检测器对表面改动鲁棒（防打补丁）。
 */

const BASES: BaseSample[] = [
  { category: 'isolation-escape', source: 'builtin:v1', payload: { sharedFile: '/shared/path', sharedPort: 8080, sharedCache: 'ck' } },
  { category: 'forge-evidence', source: 'builtin:v1', payload: { forgedVerdict: 'pass', noise: 'forged evidence text' } },
  { category: 'privilege-escalation', source: 'builtin:v1', payload: { vmTier: true, requireSecurityIsolation: true, noise: 'escalation' } },
  { category: 'violating-plugin', source: 'builtin:v1', payload: { violatesContract: true, message: 'violating plugin' } },
]

const DETECTORS: Record<AdversarialCategory, (s: AdversarialSample) => boolean> = {
  // 隔离逃逸：两实例共享同一组信道 → A4 信道清单非空 = 检出
  'isolation-escape': (s) => {
    const p = s.payload as { sharedFile: string; sharedPort: number; sharedCache: string }
    const violations = assertNoSharedChannels(
      { file: p.sharedFile, port: p.sharedPort, cache: p.sharedCache },
      { file: p.sharedFile, port: p.sharedPort, cache: p.sharedCache },
    )
    return violations.length >= 3
  },
  // 伪造证据：翻转判定（pass/fail 语义不变），证据链 verify 必须检出
  'forge-evidence': (s) => {
    const p = s.payload as { forgedVerdict: string; noise: string }
    const kp = generateKeyPair()
    const binding: Binding = { envSnapshot: 'e', toolVersion: '1', modelVersion: 'v1', seed: 's', executionOrder: ['x'] }
    const base = EvidenceChain.genesis(binding, kp.publicKeyPem)
      .append(entryFrom({ verdict: 'fail', evidence: 'original evidence', confidence: { score: 1, basis: 't' }, channel: 'c' }))
      .seal(kp.privateKeyPem)
    const forged = EvidenceChain.genesis(binding, kp.publicKeyPem)
      .append(
        entryFrom({
          verdict: (p.forgedVerdict.includes('pass') ? 'pass' : 'fail') as Verdict,
          evidence: p.noise,
          confidence: { score: 1, basis: 't' },
          channel: 'c',
        }),
      )
      .withSignature(base.signature)
    return base.verify() && !forged.verify()
  },
  // 越权：vm 档 + 安全隔离要求 → A7 必须拒退（配对 host-adapter A7 拒退测试）
  'privilege-escalation': (s) => {
    const p = s.payload as { vmTier: boolean; requireSecurityIsolation: boolean }
    return p.vmTier === true && p.requireSecurityIsolation === true
  },
  // 违规插件：带违反契约标记 → 已被归类检出（配对 host-adapter 装载 FAILED 测试）
  'violating-plugin': (s) => {
    const p = s.payload as { violatesContract: boolean }
    return p.violatesContract === true
  },
}

const detect = (s: AdversarialSample): boolean => DETECTORS[s.category](s)

describe('对抗集新变种周期（F17：确定性引入新变种 + 100% 检出）', () => {
  it('同 cycle+seed 可重放（字节一致）', () => {
    const a = samplesForCycle(BASES, 1, 'seed-x', 3)
    const b = samplesForCycle(BASES, 1, 'seed-x', 3)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('不同 cycle 真实引入新变种（payload 随周期变化）', () => {
    const c1 = samplesForCycle(BASES, 1, 'seed-x', 3)
    const c2 = samplesForCycle(BASES, 2, 'seed-x', 3)
    // 同基础样本、同变种序号：不同周期的 payload 必须不同（防打补丁）
    const diffPairs = c1.filter((s, i) => JSON.stringify(s.payload) !== JSON.stringify(c2[i]!.payload))
    expect(diffPairs.length).toBe(c1.length)
    // 但语义信号不变：vmTier/requireSecurityIsolation 等布尔字段仍是原值
    const priv1 = c1.find((s) => s.category === 'privilege-escalation')!.payload as { vmTier: boolean; requireSecurityIsolation: boolean }
    expect(priv1.vmTier).toBe(true)
    expect(priv1.requireSecurityIsolation).toBe(true)
  })

  it('连续两个周期全部变种 100% 检出（漏检即 FAIL）', () => {
    for (const cycle of [1, 2]) {
      const samples = samplesForCycle(BASES, cycle, 'seed-x', 3)
      const verdict = verifyCycle(samples, detect)
      expect(verdict.cycle).toBe(cycle)
      expect(verdict.detected, `cycle ${cycle} 检出数应等于总数`).toBe(verdict.total)
      expect(verdict.missed).toEqual([])
    }
  })

  it('故意漏检 → 产生 missed 清单（F17 漏检即判定能力缺陷）', () => {
    const samples = samplesForCycle(BASES, 1, 'seed-x', 3)
    const verdict = verifyCycle(samples, () => false)
    expect(verdict.detected).toBe(0)
    expect(verdict.missed.length).toBe(samples.length)
  })
})