import type { VerdictRecord } from './verdict.js'

/**
 * 判定治理（architecture.md §15.2 / §15.3「可异议」「终裁留痕」；development.md Task 13）。
 *
 * 在断言 SPI 之上补「复核义务」与「终裁位」两个角色：
 *  - 复核者产出独立 `VerdictRecord`，与原始判定比对 → `confirmed` / `overturned`；
 *  - 复核不一致 → 终裁位裁决并 append-only 留痕（`ArbitrationRecord`）；
 *  - 每个 `fail` 可被异议（申诉方/外部校准者触发复核链）。
 *
 * 确认/推翻事件即 §15.7 通道可信度的样本来源（`disposition` 供下游采样本）。
 */

export type ReviewDisposition = 'confirmed' | 'overturned'

/** 复核比对：原判定与复核判定。 */
export function compareReview(original: VerdictRecord, reviewed: VerdictRecord): ReviewDisposition {
  return original.verdict === reviewed.verdict ? 'confirmed' : 'overturned'
}

/** 可异议判定（A10/§15.3）：仅 `fail` 且证据非空可定位者可被异议。 */
export function canAppeal(record: VerdictRecord): boolean {
  return record.verdict === 'fail' && record.evidence.trim().length > 0
}

/** 申诉（申诉方 / 外部校准者触发，指向证据链中第 `targetIndex` 条）。 */
export interface Appeal {
  readonly caseId: string
  readonly targetIndex: number
  readonly appellant: string
  readonly reason: string
}

export function createAppeal(caseId: string, targetIndex: number, appellant: string, reason: string): Appeal {
  if (!reason.trim()) throw new Error('appeal reason must not be empty (§15.3 可异议)')
  return { caseId, targetIndex, appellant, reason }
}

/** 终裁记录（append-only 入证据链的原始数据；由调用方用 entryFrom 转成证据条目）。 */
export interface ArbitrationRecord {
  readonly caseId: string
  readonly original: VerdictRecord
  readonly reviewed: VerdictRecord
  readonly decision: VerdictRecord
  readonly arbiter: string
  readonly note: string
}

export function arbitrate(
  caseId: string,
  original: VerdictRecord,
  reviewed: VerdictRecord,
  decision: VerdictRecord,
  arbiter: string,
  note: string,
): ArbitrationRecord {
  return { caseId, original, reviewed, decision, arbiter, note }
}

/** 确认/推翻样本（§15.7 通道可信度样本）：按判定通道归并的（确认数, 推翻数）增量。 */
export interface CredibilitySample {
  readonly channel: string
  readonly confirmed: boolean
}

export function sampleOf(channel: string, disposition: ReviewDisposition): CredibilitySample {
  return { channel, confirmed: disposition === 'confirmed' }
}