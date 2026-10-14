/**
 * 判定层学习闭环（architecture.md §15.6 G5；development.md Task 15）。
 *
 * 断言规则被终裁推翻（或被对抗变异检出判错）即记一次「失败」；
 * 失败 → 记录 → 规则修正（人工/离线，版本化）→ 以追加形式回链（不改历史）。
 */

export interface RuleFailure {
  readonly ruleId: string
  /** 失败时规则版本（溯源）。 */
  readonly ruleVersion: string
  readonly caseId: string
  readonly expected: unknown
  readonly actual: unknown
}

export interface RuleRevision {
  readonly ruleId: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly note: string
}

export function recordFailure(
  ruleId: string,
  ruleVersion: string,
  caseId: string,
  expected: unknown,
  actual: unknown,
): RuleFailure {
  return { ruleId, ruleVersion, caseId, expected, actual }
}

/** 版本化修正：新版本指向前一版本（旧版不回删，可回滚）。 */
export function reviseRule(ruleId: string, fromVersion: string, toVersion: string, note: string): RuleRevision {
  if (!note.trim()) throw new Error('rule revision note must not be empty (§15.6 学习闭环)')
  return { ruleId, fromVersion, toVersion, note }
}