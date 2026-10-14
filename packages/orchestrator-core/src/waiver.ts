/**
 * 免闸留痕（architecture.md §15.3「免闸留痕」；development.md Task 14）。
 *
 * 层/场景被判「不跑」必须显式记录「谁判 + 命中哪条判据」，与 `skip` 区分：
 * 缺「免跑依据」即视为「闸被静默跳过」（§15.3 检测点）。
 */

export interface WaiverRecord {
  readonly layer: string
  readonly judge: string
  readonly criterion: string
}

export type WaiverValidity = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export function issueWaiver(layer: string, judge: string, criterion: string): WaiverRecord {
  return { layer, judge, criterion }
}

/** 免跑依据必须齐全（谁判 + 命中判据），否则判「闸被静默跳过」。 */
export function requireWaiverBasis(w: WaiverRecord): WaiverValidity {
  if (!w.judge.trim()) return { ok: false, reason: 'waiver missing judge (谁判)' }
  if (!w.criterion.trim()) return { ok: false, reason: 'waiver missing criterion (命中判据)' }
  return { ok: true }
}