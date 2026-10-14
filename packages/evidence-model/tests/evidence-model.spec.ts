import { describe, expect, it } from 'vitest'
import type { Verdict, VerdictRecord } from '@dsh-covenant/assertion'
import { judge } from '@dsh-covenant/assertion'
import {
  canon,
  entryFrom,
  EvidenceChain,
  generateKeyPair,
  renderFace,
  type Binding,
} from '../src/index.js'

function binding(seed: string): Binding {
  return {
    envSnapshot: 'node:24.21.0',
    toolVersion: '1.0.0',
    modelVersion: 'v1',
    seed,
    executionOrder: ['probe', 'judge'],
  }
}

function rec(verdict: Verdict, evidence: string, channel = 'ch'): VerdictRecord {
  return {
    verdict,
    evidence,
    confidence: { score: verdict === 'pass' || verdict === 'fail' || verdict === 'error' ? 1 : 0, basis: 't' },
    channel,
  }
}

function sealedChain(entries: Array<Omit<ReturnType<typeof entryFrom>, 'prev'>>, b = binding('s'), kp = generateKeyPair()) {
  let chain = EvidenceChain.genesis(b, kp.publicKeyPem)
  for (const e of entries) chain = chain.append(e)
  return { chain: chain.seal(kp.privateKeyPem), kp }
}

describe('canon (A5/A9 规范化)', () => {
  it('is key-order-insensitive for objects', () => {
    expect(canon({ a: 1, b: 2, c: { x: 'y', z: 3 } })).toBe(canon({ c: { z: 3, x: 'y' }, b: 2, a: 1 }))
  })
  it('is order-sensitive for arrays', () => {
    expect(canon([1, 2])).not.toBe(canon([2, 1]))
  })
  it('normalizes -0 to 0 and distinguishes types', () => {
    expect(canon(-0)).toBe(canon(0))
    expect(canon(1)).not.toBe(canon('1'))
    expect(canon(null)).not.toBe(canon('null'))
  })
  it('rejects non-JSON values at the hash boundary (A9 enforcement)', () => {
    expect(() => canon(new Date())).toThrow()
    expect(() => canon(Number.NaN)).toThrow()
    expect(() => canon(undefined)).toThrow()
    expect(() => canon(new Map())).toThrow()
    expect(() => canon({ a: undefined })).toThrow()
    expect(() => canon([undefined])).toThrow()
  })
})

describe('chain construction (定义 3.1)', () => {
  it('append returns a new instance and never mutates the prior chain (append-only)', () => {
    const kp = generateKeyPair()
    const a = EvidenceChain.genesis(binding('s'), kp.publicKeyPem)
    const b = a.append(entryFrom(rec('pass', 'e1')))
    expect(a.entries.length).toBe(0)
    expect(b.entries.length).toBe(1)
    expect(a.root()).not.toBe(b.root())
  })

  it('append invalidates the prior signature (root changed)', () => {
    const kp = generateKeyPair()
    const sealed = EvidenceChain.genesis(binding('s'), kp.publicKeyPem)
      .append(entryFrom(rec('pass', 'e1')))
      .seal(kp.privateKeyPem)
    expect(sealed.verify()).toBe(true)
    const grown = sealed.append(entryFrom(rec('fail', 'e2')))
    expect(grown.verify()).toBe(false) // 未重新签名
  })

  it('root is content-addressed: replay with same B + same entries yields same root', () => {
    const a = sealedChain([entryFrom(rec('pass', 'e1')), entryFrom(rec('skip', 'e2'))])
    const b = sealedChain([entryFrom(rec('pass', 'e1')), entryFrom(rec('skip', 'e2'))])
    // 不同密钥签名不影响 root（root 只由 B 与 payload 决定）
    expect(a.chain.root()).toBe(b.chain.root())
  })

  it('binding B participates in genesis: any B component change flips root', () => {
    const base = binding('s')
    const a = EvidenceChain.genesis(base, null)
    const b = EvidenceChain.genesis({ ...base, seed: 'other' }, null)
    const c = EvidenceChain.genesis({ ...base, executionOrder: ['b', 'a'] }, null)
    expect(a.root()).not.toBe(b.root())
    expect(a.root()).not.toBe(c.root())
  })
})

describe('T3: tamper detection (引理 3.1 / 3.2)', () => {
  it('tampering any payload (verdict) is detected by verify() (引理 3.1)', () => {
    const { chain } = sealedChain([entryFrom(rec('pass', 'e1'))])
    const originalSig = chain.signature
    // 篡改 payload.verdict 后，重放原签名（不重签）——root 变化，原签名不再匹配 ⇒ verify 失败
    const tampered = EvidenceChain.genesis(chain.binding, chain.publicKeyPem)
      .append(entryFrom(rec('fail', 'e1')))
      .withSignature(originalSig)
    expect(tampered.root()).not.toBe(chain.root())
    expect(tampered.verify()).toBe(false)
    // 原链校验仍通过（未被改动）
    expect(chain.verify()).toBe(true)
  })

  it('tampering normalized detail (payload) is detected; raw evidence is outside the hash boundary', () => {
    const { chain } = sealedChain([entryFrom(rec('pass', 'e1'), { ok: true })])
    const tamperDetail = EvidenceChain.genesis(chain.binding, chain.publicKeyPem)
      .append(entryFrom(rec('pass', 'e1'), { ok: false }))
      .withSignature(chain.signature)
    expect(tamperDetail.verify()).toBe(false)
    // 原始证据域改动不参与哈希（A9），root 不变
    const tamperEvidence = EvidenceChain.genesis(chain.binding, null)
      .append(entryFrom(rec('pass', 'raw-A'), { ok: true }))
    const tamperEvidence2 = EvidenceChain.genesis(chain.binding, null)
      .append(entryFrom(rec('pass', 'raw-B'), { ok: true }))
    expect(tamperEvidence.root()).toBe(tamperEvidence2.root())
  })

  it('swap order (引理 3.2) changes root', () => {
    const a = EvidenceChain.genesis(binding('s'), null)
      .append(entryFrom(rec('pass', 'e1')))
      .append(entryFrom(rec('skip', 'e2')))
    const b = EvidenceChain.genesis(binding('s'), null)
      .append(entryFrom(rec('skip', 'e2')))
      .append(entryFrom(rec('pass', 'e1')))
    expect(a.root()).not.toBe(b.root())
  })

  it('truncation (引理 3.2) changes root', () => {
    const full = EvidenceChain.genesis(binding('s'), null)
      .append(entryFrom(rec('pass', 'e1')))
      .append(entryFrom(rec('fail', 'e2')))
    const one = EvidenceChain.genesis(binding('s'), null).append(entryFrom(rec('pass', 'e1')))
    expect(full.root()).not.toBe(one.root())
  })

  it('signature is unforgeable: a different private key cannot produce a valid signature', () => {
    const kp = generateKeyPair()
    const kp2 = generateKeyPair()
    const chain = EvidenceChain.genesis(binding('s'), kp.publicKeyPem)
      .append(entryFrom(rec('pass', 'e1')))
      .seal(kp.privateKeyPem)
    // 用另一把私钥对同 root 签名 → 声明的公钥校验失败
    const forged = EvidenceChain.genesis(binding('s'), kp.publicKeyPem)
      .append(entryFrom(rec('pass', 'e1')))
      .seal(kp2.privateKeyPem)
    expect(forged.verify()).toBe(false)
  })
})

describe('A9: replay determinism (载荷归一化)', () => {
  it('raw evidence drift does NOT change root (evidence excluded from payload); verdict does', () => {
    const sameRoot = EvidenceChain.genesis(binding('s'), null).append(entryFrom(rec('pass', 'evidence#v1'))).root()
    const driftedRoot = EvidenceChain.genesis(binding('s'), null).append(entryFrom(rec('pass', 'evidence#v2'))).root()
    expect(sameRoot).toBe(driftedRoot) // A9：证据不入载荷 ⇒ 判定一致 ⇒ root 相等
    const verdictFlip = EvidenceChain.genesis(binding('s'), null).append(entryFrom(rec('fail', 'evidence#v1'))).root()
    expect(sameRoot).not.toBe(verdictFlip)
  })
})

describe('T5: faces are pure functions of the authoritative chain (五桶分割)', () => {
  const verdicts: Verdict[] = ['pass', 'fail', 'skip', 'error', 'inconclusive', 'pass']
  const entries = verdicts.map((v, i) => entryFrom(rec(v, `evidence-${i}`, `channel-${v}`)))
  const chain = EvidenceChain.genesis(binding('rep'), null)
  let built = chain
  for (const e of entries) built = built.append(e)

  it('summary is a full partition: every entry lands in exactly one bucket', () => {
    const s = built.summary()
    const total = s.pass + s.fail + s.skip + s.error + s.inconclusive
    expect(total).toBe(entries.length)
    expect(s.pass).toBe(2)
    expect(s.fail).toBe(1)
    expect(s.skip).toBe(1)
    expect(s.error).toBe(1)
    expect(s.inconclusive).toBe(1)
  })

  it('render is deterministic (same chain → byte-identical face)', () => {
    for (const face of ['tap', 'junit', 'html'] as const) {
      expect(renderFace(built, face)).toBe(renderFace(built, face))
    }
  })

  it('TAP face carries every verdict with evidence for soft verdicts', () => {
    const tap = renderFace(built, 'tap')
    expect(tap).toContain('TAP version 13')
    expect(tap).toContain('1..6')
    expect(tap).toContain('not ok') // fail/error
    expect(tap).toContain('# SKIP') // skip/inconclusive
  })

  it('JUnit face counts failures/errors/skipped correctly', () => {
    const junit = renderFace(built, 'junit')
    expect(junit).toContain('tests="6"')
    expect(junit).toContain('failures="1"')
    expect(junit).toContain('errors="1"')
    expect(junit).toContain('skipped="2"')
  })

  it('HTML face escapes evidence and includes the authoritative root', () => {
    const html = renderFace(built, 'html')
    expect(html).toContain(built.root())
    // 证明转义真实发生：喂入含 < & 的证据串，必须出现对应实体
    const esc = EvidenceChain.genesis(binding('esc'), null).append(entryFrom(rec('pass', 'a<b&c')))
    expect(renderFace(esc, 'html')).toContain('a&lt;b&amp;c')
  })
})

describe('integration: judge → evidence chain (探测 → 判定 → 入链)', () => {
  it('a skipped (capability-gated) verdict keeps its non-empty evidence on the chain', () => {
    const r = judge({ value: 1 }, { expect: 1, require: ['cap'] }, { capabilities: { cap: 'absent' } }, 'probe-a')
    expect(r.verdict).toBe('skip')
    const kp = generateKeyPair()
    const chain = EvidenceChain.genesis(binding('int'), kp.publicKeyPem)
      .append(entryFrom(r))
      .seal(kp.privateKeyPem)
    expect(chain.verify()).toBe(true)
    expect(chain.summary().skip).toBe(1)
  })
})