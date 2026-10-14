import { describe, expect, it } from 'vitest'
import type { VerdictRecord } from '@dsh-covenant/assertion'
import {
  entryFrom,
  EvidenceChain,
  generateKeyPair,
  isUnforgotten,
  replicaOf,
  replicasEquivalent,
  UnforgottenLedger,
  type Binding,
} from '../src/index.js'

describe('冗余与不可遗忘（Task 14，§15.3）', () => {
  const entries = [{ a: 1 }, { b: 2 }]

  it('双副本校验和等价；篡改归档 → 不等价', () => {
    const local = replicaOf(entries, 'local')
    const archive = replicaOf(entries, 'archive')
    expect(replicasEquivalent(local, archive)).toBe(true)
    expect(replicasEquivalent(local, replicaOf([{ a: 1 }, { b: 3 }], 'archive'))).toBe(false)
  })

  it('不可遗忘账本只追加：快照不可反写账本', () => {
    const ledger = new UnforgottenLedger()
    ledger.append('arbitration', { id: '1' })
    ledger.append('arbitration', { id: '2' })
    const snapshot = ledger.read('arbitration')
    expect(snapshot.length).toBe(2)
    ;(snapshot as unknown[]).push({ id: '3' })
    expect(ledger.read('arbitration').length).toBe(2) // 账本未受影响（读取返回副本）
  })

  it('写操作对非不可遗忘类目被拒（类目封闭）', () => {
    const ledger = new UnforgottenLedger()
    expect(() => ledger.append('nope' as never, {})).toThrow()
  })

  it('isUnforgotten 只认四类', () => {
    expect(isUnforgotten('waiver')).toBe(true)
    expect(isUnforgotten('arbitration')).toBe(true)
    expect(isUnforgotten('overturned-verdict')).toBe(true)
    expect(isUnforgotten('coverage-gap')).toBe(true)
    expect(isUnforgotten('random')).toBe(false)
  })
})

describe('单向性（Task 14：面孔是权威链的纯函数、禁止反写）', () => {
  it('render 两次 byte 一致，且不改动链', () => {
    const kp = generateKeyPair()
    const binding: Binding = { envSnapshot: 'e', toolVersion: '1', modelVersion: 'v1', seed: 's', executionOrder: ['x'] }
    const rec: VerdictRecord = { verdict: 'pass', evidence: 'ev', confidence: { score: 1, basis: 't' }, channel: 'c' }
    const chain = EvidenceChain.genesis(binding, kp.publicKeyPem).append(entryFrom(rec)).seal(kp.privateKeyPem)

    const before = { count: chain.entries.length, root: chain.root() }
    const f1 = chain.render('html')
    const f2 = chain.render('html')
    expect(f1).toBe(f2)
    expect(chain.entries.length).toBe(before.count)
    expect(chain.root()).toBe(before.root)
  })
})