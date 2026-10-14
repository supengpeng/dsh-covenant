import type { CapabilityMatrix, Observation } from '@dsh-covenant/assertion'
import { judge } from '@dsh-covenant/assertion'
import { canon } from '@dsh-covenant/evidence-model'
import {
  EvidenceChain,
  entryFrom,
  generateKeyPair,
  type Binding,
} from '@dsh-covenant/evidence-model'
import type { IsolationTier } from '@dsh-covenant/host-adapter'
import { order, valid, type CompositionGraph } from './graph.js'

/**
 * 执行调度（development.md §5.1；theory-proof.md T2 / D1 / A8）。
 *
 * - `buildPlan`：规范序 + 入边（按 predecessor id 字典序）+ 同档独立宿主实例分派；
 * - `planDigest`：同一 G + 同一种子 → 字节级一致的计划（A8 确定性）；
 * - `Orchestrator.run`：拓序 → 分发（按隔离档）→ 观测 → 判定 → 入链（无遗漏）。
 */

export type NodeBehavior = (inputs: readonly unknown[], seed: string) => unknown | Promise<unknown>

export interface NodeAssertion {
  readonly expect: unknown
  readonly require: readonly string[]
}

export interface RunSpec {
  readonly graph: CompositionGraph
  /** 能力矩阵（capability-probe 产出；run 只消费，探测在入口层完成，§12 数据流）。 */
  readonly capabilities: CapabilityMatrix
  readonly assertions: Readonly<Record<string, NodeAssertion>>
  readonly behaviors: Readonly<Record<string, NodeBehavior>>
  /** B 的其余分量；executionOrder 由 plan 派生（确定性）。 */
  readonly binding: Omit<Binding, 'executionOrder'>
  readonly channelOf?: (nodeId: string) => string
}

export interface PlannedNode {
  readonly nodeId: string
  readonly tier: IsolationTier
  readonly inputNodeIds: readonly string[]
  /** 同档内的宿主实例序号（§9 同档并发各占独立实例；保守：实例-per-节点）。 */
  readonly hostSlot: number
}

export interface ExecutionPlan {
  readonly order: readonly string[]
  readonly nodes: readonly PlannedNode[]
  readonly tiers: Record<IsolationTier, number>
}

export class InvalidGraphError extends Error {
  constructor(reasons: readonly string[]) {
    super(`invalid composition graph: ${reasons.join('; ')}`)
    this.name = 'InvalidGraphError'
  }
}

export function buildPlan(G: CompositionGraph): ExecutionPlan | null {
  const ord = order(G)
  if (!ord) return null
  const byId = new Map(G.nodes.map((n) => [n.id, n] as const))
  const inc = new Map<string, string[]>(G.nodes.map((n) => [n.id, []]))
  for (const e of G.edges) inc.get(e.to)!.push(e.from)

  const tierCount = new Map<IsolationTier, number>()
  const nodes: PlannedNode[] = []
  for (const id of ord) {
    const n = byId.get(id)!
    const slot = tierCount.get(n.isolationTier) ?? 0
    tierCount.set(n.isolationTier, slot + 1)
    nodes.push({ nodeId: id, tier: n.isolationTier, inputNodeIds: [...(inc.get(id) ?? [])].sort(), hostSlot: slot })
  }

  const tiers = Object.fromEntries([...tierCount]) as Record<IsolationTier, number>
  return { order: ord, nodes, tiers }
}

/** 确定性计划摘要（canon 键序不敏感）：同一 G + 同一种子 → 字节一致（A8 实测面）。 */
export function planDigest(G: CompositionGraph, seed: string): string | null {
  const p = buildPlan(G)
  if (!p) return null
  return canon({ seed, order: p.order, nodes: p.nodes, tiers: p.tiers })
}

export interface RunResult {
  readonly plan: ExecutionPlan
  readonly chain: EvidenceChain
}

export class Orchestrator {
  async run(spec: RunSpec): Promise<RunResult> {
    const v = valid(spec.graph)
    if (!v.ok) throw new InvalidGraphError(v.reasons)

    const plan = buildPlan(spec.graph)!
    const binding: Binding = { ...spec.binding, executionOrder: plan.order }
    const kp = generateKeyPair()
    let chain = EvidenceChain.genesis(binding, kp.publicKeyPem)

    const outputs = new Map<string, unknown>()
    for (const node of plan.nodes) {
      const inputs = node.inputNodeIds.map((from) => outputs.get(from))
      const behavior = spec.behaviors[node.nodeId]
      let observation: Observation
      try {
        observation = { value: behavior ? await behavior(inputs, binding.seed) : undefined }
      } catch (err) {
        observation = { value: undefined, error: true, errorDetail: String(err instanceof Error ? err.message : err) }
      }
      const assertion = spec.assertions[node.nodeId] ?? { expect: undefined, require: [] }
      const channel = spec.channelOf ? spec.channelOf(node.nodeId) : node.nodeId
      const record = judge(
        observation,
        { expect: assertion.expect, require: assertion.require },
        { capabilities: spec.capabilities },
        channel,
      )
      outputs.set(node.nodeId, observation.value)
      chain = chain.append(entryFrom(record))
    }

    return { plan, chain: chain.seal(kp.privateKeyPem) }
  }
}