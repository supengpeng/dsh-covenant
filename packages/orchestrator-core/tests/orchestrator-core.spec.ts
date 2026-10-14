import { describe, expect, it } from 'vitest'
import type { CapabilityMatrix } from '@dsh-covenant/assertion'
import type { IsolationTier } from '@dsh-covenant/host-adapter'
import {
  buildPlan,
  InvalidGraphError,
  order,
  Orchestrator,
  planDigest,
  valid,
  type CompositionGraph,
  type Edge,
  type NodeBehavior,
  type NodeSpec,
  type RunSpec,
} from '../src/index.js'

function node(id: string, tier: IsolationTier = 'subprocess', inT = 'x', outT = 'x', deterministic = true): NodeSpec {
  return { id, inputType: inT, outputType: outT, isolationTier: tier, deterministic }
}

const G = (nodes: NodeSpec[], edges: Edge[]): CompositionGraph => ({ nodes, edges })

describe('valid(G)（定义 2.1：无环 + 类型 + 隔离档）', () => {
  it('accepts a well-formed acyclic graph', () => {
    const g = G([node('a'), node('b')], [{ from: 'a', to: 'b' }])
    expect(valid(g)).toEqual({ ok: true })
  })

  it('rejects a cyclic graph', () => {
    const g = G([node('a'), node('b')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    const v = valid(g)
    expect(v.ok).toBe(false)
    expect((v as { ok: false; reasons: readonly string[] }).reasons.join(' ')).toMatch(/cyclic/)
  })

  it('rejects a self-loop (also cyclic)', () => {
    const g = G([node('a')], [{ from: 'a', to: 'a' }])
    expect(valid(g).ok).toBe(false)
  })

  it('rejects type mismatch', () => {
    const g = G([node('a', 'subprocess', 'x', 'x'), node('b', 'subprocess', 'y', 'x')], [{ from: 'a', to: 'b' }])
    const v = valid(g)
    expect(v.ok).toBe(false)
    expect((v as { ok: false; reasons: readonly string[] }).reasons.join(' ')).toMatch(/type mismatch/)
  })

  it('rejects cross-tier edge without bridge; accepts with bridge', () => {
    const noBridge = G([node('a', 'vm'), node('b', 'subprocess')], [{ from: 'a', to: 'b' }])
    expect(valid(noBridge).ok).toBe(false)
    const bridged = G([node('a', 'vm'), node('b', 'subprocess')], [{ from: 'a', to: 'b', bridged: true }])
    expect(valid(bridged)).toEqual({ ok: true })
  })

  it('rejects duplicate node ids', () => {
    const g = G([node('a'), node('a')], [])
    expect(valid(g).ok).toBe(false)
  })
})

describe('order(G)（定义 2.2 / D1 字典序 tie-break / 引理 2.2）', () => {
  it('produces the canonical lexicographic order for a diamond', () => {
    const g = G(
      [node('d'), node('b'), node('a'), node('c')], // 打乱节点列举序
      [
        { from: 'c', to: 'd' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'd' },
        { from: 'a', to: 'c' },
      ], // 打乱边列举序
    )
    expect(order(g)).toEqual(['a', 'b', 'c', 'd']) // a 后 {b,c} 取最小 b
  })

  it('order is independent of node/edge enumeration order (引理 2.2)', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')]
    const edges: Edge[] = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ]
    const o1 = order(G(nodes, edges))
    const o2 = order(G([...nodes].reverse(), [...edges].reverse()))
    expect(o1).toEqual(o2)
    expect(o1).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns null for a cyclic graph', () => {
    const g = G([node('a'), node('b')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    expect(order(g)).toBeNull()
  })
})

describe('plan（A8 确定性 / 分发按隔离档）', () => {
  it('planDigest is byte-identical for same graph + same seed, differs for different seed', () => {
    const g = G([node('a'), node('b'), node('c')], [
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
    ])
    const d1 = planDigest(g, 's1')
    const d2 = planDigest(g, 's1')
    const d3 = planDigest(g, 's2')
    expect(d1).toBe(d2)
    expect(d1).not.toBe(d3)
  })

  it('dispatch strictly follows isolation tiers (各档独立实例计数)', () => {
    const g = G(
      [node('a', 'vm'), node('b', 'subprocess'), node('c', 'subprocess')],
      [
        { from: 'a', to: 'b', bridged: true },
        { from: 'b', to: 'c' },
      ],
    )
    const plan = buildPlan(g)!
    expect(plan.tiers.vm).toBe(1)
    expect(plan.tiers.subprocess).toBe(2)
    const byId = Object.fromEntries(plan.nodes.map((n) => [n.nodeId, n]))
    expect(byId['a']!.tier).toBe('vm')
    expect(byId['b']!.tier).toBe('subprocess')
    expect(byId['c']!.tier).toBe('subprocess')
    expect(byId['b']!.hostSlot).toBe(0)
    expect(byId['c']!.hostSlot).toBe(1)
  })
})

describe('Orchestrator.run（探测→判定→入链→出报告 闭环）', () => {
  function runSpec(overrides?: Partial<RunSpec>): RunSpec {
    const graph = G(
      [node('probe'), node('judge')],
      [{ from: 'probe', to: 'judge' }],
    )
    const behaviors: Record<string, NodeBehavior> = {
      probe: () => 1,
      judge: (inputs) => (inputs[0] as number) + 1,
    }
    return {
      graph,
      capabilities: {},
      assertions: {
        probe: { expect: 1, require: [] },
        judge: { expect: 2, require: [] },
      },
      behaviors,
      binding: { envSnapshot: 'node:24', toolVersion: '1.0', modelVersion: 'v1', seed: 'seed-1' },
      ...overrides,
    }
  }

  it('runs the loop and records verdicts in topological order without omission', async () => {
    const { plan, chain } = await new Orchestrator().run(runSpec())
    expect(plan.order).toEqual(['probe', 'judge'])
    expect(chain.entries.length).toBe(2)
    expect(chain.entries[0]!.channel).toBe('probe')
    expect(chain.entries[1]!.channel).toBe('judge')
    expect(chain.entries[0]!.verdict).toBe('pass')
    expect(chain.entries[1]!.verdict).toBe('pass')
    expect(chain.verify()).toBe(true)
    expect(chain.render('tap')).toContain('1..2')
  })

  it('is deterministic: same RunSpec → same root (T2 条款 3 / T3 重放)', async () => {
    const r1 = await new Orchestrator().run(runSpec())
    const r2 = await new Orchestrator().run(runSpec())
    expect(r1.chain.root()).toBe(r2.chain.root())
  })

  it('rejects an invalid graph before executing', async () => {
    const spec = runSpec({ graph: G([node('a'), node('b')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]) })
    await expect(new Orchestrator().run(spec)).rejects.toThrow(InvalidGraphError)
  })

  it('capability-gated: absent required capability → skip (T1 无假判定)', async () => {
    const spec = runSpec({ capabilities: { cap: 'absent' } as CapabilityMatrix, assertions: { probe: { expect: 1, require: ['cap'] }, judge: { expect: 2, require: [] } } })
    const { chain } = await new Orchestrator().run(spec)
    expect(chain.entries[0]!.verdict).toBe('skip')
  })

  it('behavior error → error verdict (ρ 分支 1)', async () => {
    const spec = runSpec({
      behaviors: {
        probe: () => {
          throw new Error('boom')
        },
        judge: (inputs: readonly unknown[]) => inputs[0],
      },
    })
    const { chain } = await new Orchestrator().run(spec)
    expect(chain.entries[0]!.verdict).toBe('error')
    expect(chain.entries[0]!.evidence).toContain('boom')
  })
})