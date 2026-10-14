import { describe, expect, it } from 'vitest'
import { issueWaiver, requireWaiverBasis } from '../src/index.js'

describe('免闸留痕（Task 14，§15.3）', () => {
  it('免跑依据齐全（谁判 + 命中判据）→ 有效', () => {
    expect(requireWaiverBasis(issueWaiver('layer', 'judge', 'criterion'))).toEqual({ ok: true })
  })

  it('缺「谁判」或「命中判据」→ 无效（判「闸被静默跳过」）', () => {
    expect(requireWaiverBasis(issueWaiver('layer', '', 'criterion')).ok).toBe(false)
    expect(requireWaiverBasis(issueWaiver('layer', 'judge', '')).ok).toBe(false)
  })
})