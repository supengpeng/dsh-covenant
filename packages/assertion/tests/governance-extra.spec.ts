import { describe, expect, it } from 'vitest'
import {
  ChannelCredibility,
  compositeTrust,
  RECURSION_DEPTH_LIMIT,
  recordFailure,
  resolveReviewChain,
  reviseRule,
  type VerdictRecord,
} from '../src/index.js'

function rec(verdict: VerdictRecord['verdict']): VerdictRecord {
  return { verdict, evidence: 'ev', confidence: { score: 1, basis: 't' }, channel: 'ch' }
}

describe('递归截断（Task 15，§15.6 G1）', () => {
  it('确定（pass/fail）即停', () => {
    expect(resolveReviewChain([rec('inconclusive'), rec('inconclusive'), rec('fail')])).toEqual({
      verdict: 'fail',
      depth: 2,
      truncated: false,
    })
    expect(resolveReviewChain([rec('pass')])).toEqual({ verdict: 'pass', depth: 0, truncated: false })
  })

  it('超 3 层仍不确定 → inconclusive + 截断停止', () => {
    const r = resolveReviewChain([rec('inconclusive'), rec('inconclusive'), rec('inconclusive'), rec('inconclusive'), rec('inconclusive')])
    expect(r.verdict).toBe('inconclusive')
    expect(r.truncated).toBe(true)
    expect(r.depth).toBe(RECURSION_DEPTH_LIMIT)
  })
})

describe('学习闭环（Task 15，§15.6 G5）', () => {
  it('失败记录 → 版本化修正（旧版不回删）', () => {
    const fail = recordFailure('rule-x', 'v1', 'case-1', 'expected', 'actual')
    expect(fail.ruleVersion).toBe('v1')
    const rev = reviseRule('rule-x', 'v1', 'v2', 'fixed by arbiter')
    expect(rev.fromVersion).toBe('v1')
    expect(rev.toVersion).toBe('v2')
  })

  it('修正记录要求非空说明', () => {
    expect(() => reviseRule('rule-x', 'v1', 'v2', '')).toThrow()
  })
})

describe('通道可信度（Task 16，§15.7 F14）', () => {
  it('后验命中率 = 确认数/总判定数，并由样本序列重算', () => {
    const c = new ChannelCredibility()
    c.record('chA', true)
    c.record('chA', false)
    c.record('chA', true)
    expect(c.posterior('chA')).toBe(2 / 3)

    // 由同一样本序列重放到新账本 → 同一后验（可由证据链重算）
    const c2 = new ChannelCredibility()
    for (const confirmed of [true, false, true]) c2.record('chA', confirmed)
    expect(c2.posterior('chA')).toBe(c.posterior('chA'))
  })

  it('零样本判「未验证」；可信级两维合成', () => {
    const c = new ChannelCredibility()
    expect(c.posterior('chX')).toBeNull()
    expect(c.isVerified('chX')).toBe(false)
    expect(compositeTrust('source', null)).toEqual({ score: 1, verified: false })
    c.record('chY', true)
    expect(compositeTrust('real-host', c.posterior('chY'))).toEqual({ score: 3, verified: true })
  })
})