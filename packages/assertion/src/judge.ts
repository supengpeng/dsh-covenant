import { deepEqual } from './equal.js'
import type {
  CapabilityState,
  Confidence,
  Expected,
  JudgeCtx,
  Observation,
  Verdict,
  VerdictRecord,
} from './verdict.js'

const DETERMINISTIC: Confidence = { score: 1, basis: 'deterministic' }
const SOFT: Confidence = { score: 0, basis: 'capability-gated (no verdict on the target)' }

function record(
  verdict: Verdict,
  evidence: string,
  confidence: Confidence,
  channel: string,
): VerdictRecord {
  return { verdict, evidence, confidence, channel }
}

/**
 * 判定纯函数 ρ（theory-proof.md 定义 1.2 优先链 / A1）。
 *
 * 优先链（按序取首个命中）：
 *  1. 观测过程错误（`obs.error`）                     → `error`
 *  2. req(a) 存在 `absent` 能力                        → `skip`
 *  3. req(a) 存在 `undetectable`/`claimed-unverified`   → `inconclusive`
 *  4. req(a) 全 `present`                              → `compare(o,e)` ∈ { pass, fail }
 *
 * A1 全域性守卫：req(a) 任一能力不在能力矩阵中（s 非全域），ρ 无定义，
 * 返回 `error` 且证据点名缺失能力——**绝不**静默降级为 pass/fail/skip。
 */
export function judge(
  obs: Observation,
  expected: Expected,
  ctx: JudgeCtx,
  channel = 'assertion',
): VerdictRecord {
  // 分支 1：观测过程错误
  if (obs.error) {
    return record(
      'error',
      obs.errorDetail ? `observation error: ${obs.errorDetail}` : 'observation error (unspecified)',
      DETERMINISTIC,
      channel,
    )
  }

  const caps = ctx.capabilities
  const require = expected.require

  // A1 全域性守卫：缺能力 ⇒ ρ 无定义 ⇒ 显式 error
  const missing = require.filter((c) => !(c in caps))
  if (missing.length > 0) {
    return record(
      'error',
      `capability matrix is not total over req(a): missing [${missing.join(', ')}] (violates A1 totality)`,
      DETERMINISTIC,
      channel,
    )
  }

  // 分支 2：∃ absent → skip（注：absent 优先于 undetectable/claimed，见定义 1.2 解释性选择）
  const absent = require.filter((c) => caps[c] === 'absent')
  if (absent.length > 0) {
    return record('skip', `required capability absent: [${absent.join(', ')}]`, SOFT, channel)
  }

  // 分支 3：∃ undetectable / claimed-unverified → inconclusive
  const unverified = require.filter((c) => {
    const s = caps[c]
    return s === 'undetectable' || s === 'claimed-unverified'
  })
  if (unverified.length > 0) {
    return record(
      'inconclusive',
      `required capability not verified: [${unverified.join(', ')}]`,
      SOFT,
      channel,
    )
  }

  // 分支 4：全 present → compare(o, e)
  const matched = deepEqual(obs.value, expected.expect)
  return matched
    ? record('pass', 'observation deeply equals expected', DETERMINISTIC, channel)
    : record('fail', 'observation differs from expected', DETERMINISTIC, channel)
}

/**
 * 归一函数 η（theory-proof.md 定义 1.1；architecture.md §8.3）。
 * 由探头观测（probe）与插件自述（decl）映射到能力四态。
 *
 *  - present        → 'present'
 *  - absent         → 'absent'
 *  - failed ∧ !decl → 'undetectable'
 *  - failed ∧ decl  → 'claimed-unverified'
 */
export type ProbeObservation = 'present' | 'absent' | 'failed'

export function normalizeCapability(
  probe: ProbeObservation,
  decl: boolean,
): CapabilityState {
  if (probe === 'present') return 'present'
  if (probe === 'absent') return 'absent'
  return decl ? 'claimed-unverified' : 'undetectable'
}