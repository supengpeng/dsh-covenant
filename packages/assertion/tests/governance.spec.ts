import { describe, expect, it } from 'vitest'
import {
  arbitrate,
  canAppeal,
  compareReview,
  createAppeal,
  sampleOf,
  type VerdictRecord,
} from '../src/index.js'

function rec(verdict: VerdictRecord['verdict'], evidence = 'ev'): VerdictRecord {
  return { verdict, evidence, confidence: { score: 1, basis: 't' }, channel: 'ch' }
}

describe('判定治理（Task 13：复核 / 终裁 / 申诉）', () => {
  it('compareReview: 同 verdict → confirmed；异 → overturned', () => {
    expect(compareReview(rec('pass'), rec('pass'))).toBe('confirmed')
    expect(compareReview(rec('pass'), rec('fail'))).toBe('overturned')
  })

  it('canAppeal: 仅 fail 且证据非空可异议（A10/§15.3 三合取）', () => {
    expect(canAppeal(rec('fail', 'evidence'))).toBe(true)
    expect(canAppeal(rec('fail', ''))).toBe(false)
    expect(canAppeal(rec('pass'))).toBe(false)
    expect(canAppeal(rec('skip'))).toBe(false)
  })

  it('createAppeal 要求非空理由（申诉可触发）', () => {
    expect(() => createAppeal('c', 0, 'author', '')).toThrow()
    expect(createAppeal('c', 0, 'author', 'why').reason).toBe('why')
  })

  it('arbitrate 产出终裁记录（复核不一致 → 终裁留痕的可核数据）', () => {
    const a = arbitrate('case1', rec('pass'), rec('fail'), rec('fail'), 'arbiter', 'ruling')
    expect(a.caseId).toBe('case1')
    expect(a.decision.verdict).toBe('fail')
    expect(a.arbiter).toBe('arbiter')
    expect(a.original.verdict).toBe('pass')
  })

  it('确认/推翻事件转为通道可信度样本（§15.7 样本来源）', () => {
    expect(sampleOf('chA', 'confirmed')).toEqual({ channel: 'chA', confirmed: true })
    expect(sampleOf('chA', 'overturned')).toEqual({ channel: 'chA', confirmed: false })
  })
})