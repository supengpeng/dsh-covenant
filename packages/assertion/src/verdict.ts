/**
 * 判定与能力四态的词表——本包是「内核最内层」，零依赖。
 *
 * 记号对应 theory-proof.md §1.1：
 *  - V = { pass, fail, skip, error, inconclusive }（§4 判定精确，无隐式通过）
 *  - S = { P, A, U, D }（architecture.md §8.3 能力四态）
 */

/** 判定枚举（theory-proof §1.1 记号 V）。 */
export type Verdict = 'pass' | 'fail' | 'skip' | 'error' | 'inconclusive'

/** 判定枚举全序，用于报告的靶心分割（T5 五桶）。 */
export const VERDICTS: readonly Verdict[] = [
  'pass',
  'fail',
  'skip',
  'error',
  'inconclusive',
] as const

/** 能力四态（theory-proof §1.1 记号 S；architecture.md §8.3）。 */
export type CapabilityState =
  | 'present'
  | 'absent'
  | 'undetectable'
  | 'claimed-unverified'

/** 能力矩阵：能力名 → 四态（theory-proof §1.1 记号 s）。 */
export type CapabilityMatrix = Readonly<Record<string, CapabilityState>>

/**
 * 单次判断的内部一致性（development.md §5.4），区别于「通道可信度」（§15.7）。
 * `score ∈ [0,1]`：确定性判定（pass/fail/error）取 1；软判定（skip/inconclusive）取 0，
 * 因软判定并未对被断言对象本身下结论。
 */
export interface Confidence {
  readonly score: number
  readonly basis: string
}

/** 归一化观测（探头输出）。`value` 为确定性取值；`error` 为观测过程错误（ρ 分支 1）。 */
export interface Observation {
  readonly value: unknown
  readonly error?: boolean
  readonly errorDetail?: string
}

/** 期望（断言定义）。`require` 为必需能力 req(a)；`expect` 为期望值，与观测深比较。 */
export interface Expected {
  readonly expect: unknown
  readonly require: readonly string[]
}

/** 判定上下文（一次判定所需的外部事实；均确定性输入，保证 A1 纯函数）。 */
export interface JudgeCtx {
  readonly capabilities: CapabilityMatrix
}

/**
 * 判定记录（development.md §5.4；A10）。
 * `evidence` 非空且可定位；`channel` 为判定通道（§15.7 通道可信度样本源）。
 */
export interface VerdictRecord {
  readonly verdict: Verdict
  readonly evidence: string
  readonly confidence: Confidence
  readonly channel: string
}