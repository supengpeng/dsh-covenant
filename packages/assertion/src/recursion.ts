import type { VerdictRecord } from './verdict.js'

/**
 * 递归截断（architecture.md §15.6 G1；development.md Task 15）。
 *
 * 判定不确定时逐级上溯（判定 → 复核 → 终裁），每上溯一层深度 +1；
 * 一确定（pass/fail）即停；达上限（默认 3 层）仍不确定 → `inconclusive` + 停止猜测。
 */

export const RECURSION_DEPTH_LIMIT = 3

export interface RecursionResolution {
  readonly verdict: 'pass' | 'fail' | 'inconclusive'
  readonly depth: number
  /** 是否因达到上限仍不确定而被截断（留痕停止）。 */
  readonly truncated: boolean
}

export function resolveReviewChain(levels: readonly VerdictRecord[]): RecursionResolution {
  let depth = 0
  for (const r of levels) {
    if (depth >= RECURSION_DEPTH_LIMIT) {
      return { verdict: 'inconclusive', depth: RECURSION_DEPTH_LIMIT, truncated: true }
    }
    if (r.verdict === 'pass' || r.verdict === 'fail') {
      return { verdict: r.verdict, depth, truncated: false }
    }
    depth += 1
  }
  return { verdict: 'inconclusive', depth, truncated: depth >= RECURSION_DEPTH_LIMIT }
}