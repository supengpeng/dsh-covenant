import type { ExecutionPlan, RunSpec } from '@dsh-covenant/orchestrator-core'
import { Orchestrator } from '@dsh-covenant/orchestrator-core'
import type { EvidenceEntry, Face } from '@dsh-covenant/evidence-model'
import { EvidenceChain, sha256Hex } from '@dsh-covenant/evidence-model'

/**
 * 对外双入口（development.md §5.9；theory-proof.md T4 / D2）。
 *
 * 本地自检（单插件、人读）与市场门禁（批量、可审计、可追责）**复用同一个
 * 「规格 → 执行计划」内核映射（同一个 `Orchestrator`）**，因此同一规格（及
 * 其规范绑定 B_s）在双入口得到同一内核判定与同一内容寻址根。
 */

export interface TestTarget {
  readonly id: string
  readonly spec: RunSpec
}

export interface Report {
  readonly targetId: string
  readonly plan: ExecutionPlan
  readonly chain: EvidenceChain
  readonly face: string
}

export interface GateReport {
  readonly reports: readonly Report[]
  /** 门禁聚合根（有序串联各目标 chain.root 的哈希），内容寻址、可审计。 */
  readonly root: string
  readonly dryRun: boolean
}

export class DualEntry {
  private readonly orchestrator = new Orchestrator()

  constructor(private readonly face: Face = 'html') {}

  /** D2：双入口共用的单一「规格 → 执行计划 + 证据链」映射。 */
  private async runTarget(target: TestTarget): Promise<Report> {
    const { plan, chain } = await this.orchestrator.run(target.spec)
    return { targetId: target.id, plan, chain, face: chain.render(this.face) }
  }

  /** 本地自检：单插件、人读报告。 */
  async selfCheck(target: TestTarget): Promise<Report> {
    return this.runTarget(target)
  }

  /** 市场门禁：批量；dry-run 与正式结论一致，仅标记不对外发布。 */
  async gate(targets: readonly TestTarget[], opts: { readonly dryRun?: boolean } = {}): Promise<GateReport> {
    const sorted = [...targets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const reports: Report[] = []
    for (const t of sorted) reports.push(await this.runTarget(t))
    const root = sha256Hex(reports.map((r) => r.chain.root()).join('|'))
    return { reports, root, dryRun: opts.dryRun ?? false }
  }

  /** 逐条追溯：按 targetId + 条目下标定位证据条目（门禁判定可追责）。 */
  trace(report: GateReport, targetId: string, index: number): { readonly targetId: string; readonly entry: EvidenceEntry } | null {
    const r = report.reports.find((x) => x.targetId === targetId)
    const entry = r?.chain.entries[index]
    if (!r || !entry) return null
    return { targetId, entry }
  }
}