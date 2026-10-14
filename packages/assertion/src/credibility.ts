/**
 * 通道可信度（architecture.md §15.7 F14；development.md Task 16）。
 *
 * 区分「置信度」（单次判断的内部一致性）与「可信度」（判定通道的历史验证命中率）。
 * 每个断言实现（判定通道）维护可信度，由证据链上的复核/终裁结果驱动更新——
 * 每次「复核确认」或「终裁推翻」都是一条样本，可信度 = 后验命中率（确认数/总判定数）。
 * 可信级 = 静态证据分级（源码 < mock < 真实宿主）× 通道历史命中率。
 */

export type EvidenceGrade = 'source' | 'mock' | 'real-host'

const GRADE_SCORE: Readonly<Record<EvidenceGrade, number>> = { source: 1, mock: 2, 'real-host': 3 }

/** 通道可信度账本（可由证据链样本序列重算）。 */
export class ChannelCredibility {
  private readonly samples = new Map<string, { confirmed: number; total: number }>()

  /** 记录一条样本（复核确认 / 终裁推翻）。 */
  record(channel: string, confirmed: boolean): void {
    const s = this.samples.get(channel) ?? { confirmed: 0, total: 0 }
    s.total += 1
    if (confirmed) s.confirmed += 1
    this.samples.set(channel, s)
  }

  /** 后验命中率；零样本返回 null（= 未验证，§15.7 检测点）。 */
  posterior(channel: string): number | null {
    const s = this.samples.get(channel)
    if (!s || s.total === 0) return null
    return s.confirmed / s.total
  }

  isVerified(channel: string): boolean {
    return this.posterior(channel) !== null
  }

  /** 快照（供重算复核）。 */
  snapshot(): Readonly<Record<string, { confirmed: number; total: number }>> {
    const out: Record<string, { confirmed: number; total: number }> = {}
    for (const [k, v] of this.samples) out[k] = { ...v }
    return out
  }
}

/** 可信级 = 静态证据分级 × 通道历史命中率（两维合成）；零样本判「未验证」。 */
export interface TrustLevel {
  readonly score: number
  readonly verified: boolean
}

export function compositeTrust(evidence: EvidenceGrade, posterior: number | null): TrustLevel {
  const grade = GRADE_SCORE[evidence]
  if (posterior === null) return { score: grade, verified: false }
  return { score: grade * posterior, verified: true }
}