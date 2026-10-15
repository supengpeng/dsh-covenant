import { describe, expect, it } from 'vitest'
import { subsystems } from '../src/index.js'

describe('端到端冒烟：探测 → 判定 → 入链 → 出报告（根插件装配的真实现）', () => {
  it('用装配的 9 个子系统跑通完整闭环', async () => {
    const { assertion, capabilityProbe, evidenceModel } = subsystems

    // 1) 探测：三探头 → 四态能力矩阵
    const { StandardCapabilityProbe } = capabilityProbe
    const probe = new StandardCapabilityProbe({
      hostFingerprint: async () => 'fp-1',
      hostObservations: async () => ({ 'cap-x': 'present' }),
      environment: async () => ({ 'cap-y': 'failed' }),
    })
    const { matrix } = await probe.probe({
      capabilities: ['cap-x', 'cap-y'],
      declared: { 'cap-y': 'claimed but unprobed' },
    })
    expect(matrix['cap-x']).toBe('present')
    expect(matrix['cap-y']).toBe('claimed-unverified')

    // 2) 判定：assertion.judge（纯函数 ρ）
    const { judge } = assertion
    const r1 = judge({ value: 42 }, { expect: 42, require: ['cap-x'] }, { capabilities: matrix }, 'probe-a')
    const r2 = judge({ value: 1 }, { expect: 1, require: ['cap-y'] }, { capabilities: matrix }, 'probe-b')
    expect(r1.verdict).toBe('pass')
    expect(r2.verdict).toBe('inconclusive')

    // 3) 入链：证据链（内容寻址 + 签名）
    const { EvidenceChain, entryFrom, generateKeyPair } = evidenceModel
    const kp = generateKeyPair()
    let chain = EvidenceChain.genesis(
      { envSnapshot: 'node:24', toolVersion: '1', modelVersion: 'v1', seed: 'e2e', executionOrder: ['probe-a', 'probe-b'] },
      kp.publicKeyPem,
    )
    chain = chain.append(entryFrom(r1)).append(entryFrom(r2)).seal(kp.privateKeyPem)

    // 4) 出报告
    expect(chain.verify()).toBe(true)
    expect(chain.summary()).toEqual({ pass: 1, fail: 0, skip: 0, error: 0, inconclusive: 1 })
    const tap = chain.render('tap')
    expect(tap).toContain('1..2')
    expect(tap).toContain('# SKIP (inconclusive)')
  })
})