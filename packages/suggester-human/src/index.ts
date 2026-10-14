import { valid, type CompositionGraph, type Edge } from '@dsh-covenant/orchestrator-core'
import { toGraphNode, type ToolManifest } from '@dsh-covenant/tool-spec'

/**
 * 组合建议器 + 人工把关（development.md §5.7；architecture.md §9.2/§9.3）。
 *
 * - 建议器输出**不受信**：候选必须过内核 `valid(G)` + 人工确认才铸成规格（A6）；
 * - 规则引擎先行、留 AI 插槽（`SuggesterModel` 可替换）；
 * - 模型版本化不可变，替换走 diff、旧版可回滚（版本化替换 B）。
 */

export interface ToolCatalog {
  readonly tools: readonly ToolManifest[]
}

export interface CandidateDraft {
  readonly id: string
  readonly graph: CompositionGraph
  readonly rationale: string
}

export interface Candidate extends CandidateDraft {
  /** 产生该候选的模型版本（版本化替换 B 的溯源锚）。 */
  readonly modelVersion: string
}

/** 建议模型：纯函数（catalog → 候选草稿），运行时只读、不改内核（A6）。 */
export type SuggesterModel = (catalog: ToolCatalog) => readonly CandidateDraft[]

export interface Suggester {
  suggest(catalog: ToolCatalog): readonly Candidate[]
}

export class RuleSuggester implements Suggester {
  constructor(
    readonly modelVersion: string,
    private readonly model: SuggesterModel,
  ) {}

  suggest(catalog: ToolCatalog): readonly Candidate[] {
    return this.model(catalog).map((d) => ({ ...d, modelVersion: this.modelVersion }))
  }
}

/** 规则引擎默认模型：单工具自检 + 两两类型兼容链（跨档自动加桥）。 */
export function ruleModel(catalog: ToolCatalog): readonly CandidateDraft[] {
  const drafts: CandidateDraft[] = []
  const tools = catalog.tools
  for (const t of tools) {
    drafts.push({
      id: `self:${t.id}`,
      graph: { nodes: [toGraphNode(t)], edges: [] },
      rationale: `single-tool self-check of ${t.id}`,
    })
  }
  for (const a of tools) {
    for (const b of tools) {
      if (a.id === b.id) continue
      if (a.ioType !== b.ioType) continue // 类型约束：输出=输入
      const edge: Edge =
        a.isolationTier === b.isolationTier
          ? { from: a.id, to: b.id }
          : { from: a.id, to: b.id, bridged: true } // 跨档序列化桥（§9）
      drafts.push({
        id: `chain:${a.id}->${b.id}`,
        graph: { nodes: [toGraphNode(a), toGraphNode(b)], edges: [edge] },
        rationale: `pairwise chain ${a.id} -> ${b.id}`,
      })
    }
  }
  return drafts
}

/** 版本化模型注册表 + 回滚（§15.7 / 版本化替换 B）。 */
export interface DeployedModel {
  readonly version: string
  suggest(catalog: ToolCatalog): readonly Candidate[]
}

export class SuggesterRegistry {
  private readonly models = new Map<string, SuggesterModel>()
  private readonly stack: string[] = []

  deploy(version: string, model: SuggesterModel): { readonly diff: string; readonly previous: string | null } {
    const previous = this.stack[this.stack.length - 1] ?? null
    this.models.set(version, model)
    this.stack.push(version)
    return { diff: `deploy ${previous ?? '(none)'} → ${version}`, previous }
  }

  active(): DeployedModel | null {
    const version = this.stack[this.stack.length - 1]
    if (!version) return null
    const model = this.models.get(version)!
    return {
      version,
      suggest: (catalog) => model(catalog).map((d) => ({ ...d, modelVersion: version })),
    }
  }

  /** 回滚到上一版本（不可变历史，不回写旧候选）。 */
  rollback(): DeployedModel | null {
    this.stack.pop()
    return this.active()
  }
}

export type Decision =
  | { readonly kind: 'accept'; readonly candidateId: string }
  | { readonly kind: 'reject'; readonly candidateId: string; readonly reason: string }
  | { readonly kind: 'edit'; readonly candidateId: string; readonly graph: CompositionGraph; readonly note?: string }

export type DecisionRecord = Decision & {
  readonly modelVersion: string
  readonly at: number
}

/** 人工把关：记录采纳/拒绝/修正（决策记录作为未来训练原料）。 */
export class HumanGateway {
  private readonly records: DecisionRecord[] = []
  private readonly acceptedIds = new Set<string>()

  decide(candidate: Candidate, decision: Decision, now = Date.now()): DecisionRecord {
    const record: DecisionRecord = { ...decision, modelVersion: candidate.modelVersion, at: now }
    this.records.push(record)
    if (decision.kind === 'accept' || decision.kind === 'edit') this.acceptedIds.add(candidate.id)
    return record
  }

  isAccepted(id: string): boolean {
    return this.acceptedIds.has(id)
  }

  recordsSnapshot(): readonly DecisionRecord[] {
    return this.records
  }
}

export type ConstituteResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** 铸成规格：候选（或其修正图）必过 `valid(G)` + 人工确认才进入执行。 */
export function constitute(
  graph: CompositionGraph,
  isAccepted: boolean,
): ConstituteResult {
  const v = valid(graph)
  if (!v.ok) return { ok: false, reason: `invalid graph: ${v.reasons.join('; ')}` }
  if (!isAccepted) return { ok: false, reason: 'not human-accepted (§9.3)' }
  return { ok: true }
}