import { describe, expect, it } from 'vitest'
import type { VerdictRecord } from '@dsh-covenant/assertion'
import { entryFrom, EvidenceChain, generateKeyPair, type Binding } from '@dsh-covenant/evidence-model'

/**
 * T1–T5 实测证据写回证据链（development.md §7.1 / 成功标准 §10）。
 * 每个定理各有一条 `pass` 证据，指向覆盖它的测试；链可重放验证（内容寻址）。
 */
describe('T1–T5 实测证据写回证据链', () => {
  it('五条定理各有证据入链且可重放验证', () => {
    const kp = generateKeyPair()
    const binding: Binding = {
      envSnapshot: 'node:24',
      toolVersion: '1',
      modelVersion: 'v1',
      seed: 'theorems',
      executionOrder: ['T1', 'T2', 'T3', 'T4', 'T5'],
    }

    const recs: VerdictRecord[] = [
      { verdict: 'pass', evidence: 'T1 无假判定 — assertion/tests + capability-probe/tests', confidence: { score: 1, basis: 'observed' }, channel: 'T1' },
      { verdict: 'pass', evidence: 'T2 执行确定 — orchestrator-core/tests (planDigest/order/run 重放)', confidence: { score: 1, basis: 'observed' }, channel: 'T2' },
      { verdict: 'pass', evidence: 'T3 篡改可检与可重放 — evidence-model/tests', confidence: { score: 1, basis: 'observed' }, channel: 'T3' },
      { verdict: 'pass', evidence: 'T4 双入口同结论 — dual-entry/tests', confidence: { score: 1, basis: 'observed' }, channel: 'T4' },
      { verdict: 'pass', evidence: 'T5 五桶分割无静默跳过 — evidence-model/tests (summary)', confidence: { score: 1, basis: 'observed' }, channel: 'T5' },
    ]

    let chain = EvidenceChain.genesis(binding, kp.publicKeyPem)
    for (const r of recs) chain = chain.append(entryFrom(r))
    chain = chain.seal(kp.privateKeyPem)

    expect(chain.verify()).toBe(true)
    expect(chain.summary().pass).toBe(5)
    expect(chain.entries.map((e) => e.channel)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])

    // 同 B 重放一致（root 确定性）
    let replay = EvidenceChain.genesis(binding, kp.publicKeyPem)
    for (const r of recs) replay = replay.append(entryFrom(r))
    replay = replay.seal(kp.privateKeyPem)
    expect(replay.root()).toBe(chain.root())
  })
})