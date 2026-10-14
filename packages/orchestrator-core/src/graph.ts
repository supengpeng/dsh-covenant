import type { IsolationTier } from '@dsh-covenant/host-adapter'

/**
 * 组合图与静态合法谓词（theory-proof.md 定义 2.1/2.2、引理 2.1/2.2；development.md §5.1）。
 *
 * - 无环（T2 前提）；节点 id 唯一；边端点存在；
 * - 每条边 u→v：类型匹配 `ι_out(u) = ι_in(v)`；
 * - 每条边 u→v：隔离档约束 `τ(u) = τ(v) ∨ b(u,v)`（跨档只允许序列化桥）。
 * - `order(G)` 规范序（D1）：Kahn 每轮从入度 0 候选取 id 字典序最小者。
 */

export type IoType = string

export interface NodeSpec {
  readonly id: string
  readonly inputType: IoType
  readonly outputType: IoType
  readonly isolationTier: IsolationTier
  /** A8：节点在固定 B 下是否是其输入与 B 的确定性函数（随机节点仍须由 B 内种子驱动）。 */
  readonly deterministic: boolean
}

export interface Edge {
  readonly from: string
  readonly to: string
  /** b(u,v)：跨档序列化桥标志（true 时允许 τ(from)≠τ(to)）。 */
  readonly bridged?: boolean
}

export interface CompositionGraph {
  readonly nodes: readonly NodeSpec[]
  readonly edges: readonly Edge[]
}

export type Validity = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] }

/** 静态合法谓词（定义 2.1）。 */
export function valid(G: CompositionGraph): Validity {
  const reasons: string[] = []

  const ids = new Set(G.nodes.map((n) => n.id))
  if (ids.size !== G.nodes.length) reasons.push('duplicate node id (breaks D1 tie-break determinism)')

  const byId = new Map(G.nodes.map((n) => [n.id, n] as const))
  for (const e of G.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) {
      reasons.push(`edge ${e.from}→${e.to} references a missing node`)
      continue
    }
    const u = byId.get(e.from)!
    const v = byId.get(e.to)!
    if (u.outputType !== v.inputType) {
      reasons.push(`type mismatch on ${u.id}→${v.id}: ${u.outputType} ≠ ${v.inputType}`)
    }
    if (u.isolationTier !== v.isolationTier && !e.bridged) {
      reasons.push(`isolation-tier violation on ${u.id}→${v.id}: ${u.isolationTier} → ${v.isolationTier} without bridge`)
    }
  }

  if (order(G) === null) reasons.push('graph is cyclic (no topological order)')

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

/**
 * 规范序（定义 2.2 / D1）：Kahn 每轮取 id 字典序最小的入度 0 节点。
 * 返回 `null` 当且仅当图含环。与节点/边列举顺序无关（引理 2.2）。
 */
export function order(G: CompositionGraph): string[] | null {
  const indeg = new Map<string, number>(G.nodes.map((n) => [n.id, 0]))
  const adj = new Map<string, string[]>(G.nodes.map((n) => [n.id, []]))
  for (const e of G.edges) {
    const to = indeg.get(e.to)
    if (to === undefined) return null // 边指向缺失节点
    indeg.set(e.to, to + 1)
    const list = adj.get(e.from)
    if (!list) return null // 边起自缺失节点
    list.push(e.to)
  }

  const ready: string[] = []
  for (const n of G.nodes) if (indeg.get(n.id) === 0) ready.push(n.id)

  const result: string[] = []
  while (ready.length > 0) {
    ready.sort() // 字典序，取最小（D1 tie-break）
    const id = ready.shift()!
    result.push(id)
    for (const to of adj.get(id)!) {
      const d = indeg.get(to)! - 1
      indeg.set(to, d)
      if (d === 0) ready.push(to)
    }
  }

  return result.length === G.nodes.length ? result : null
}

/** 每个节点的入边（按图的遍历序；仅供输入收集，不决定执行序）。 */
export function incomingEdges(G: CompositionGraph, nodeId: string): readonly Edge[] {
  return G.edges.filter((e) => e.to === nodeId)
}