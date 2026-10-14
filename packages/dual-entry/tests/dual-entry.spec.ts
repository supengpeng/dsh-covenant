import { describe, expect, it } from 'vitest'
import type { RunSpec } from '@dsh-covenant/orchestrator-core'
import { DualEntry, type TestTarget } from '../src/index.js'

function spec(seed = 's'): RunSpec {
  return {
    graph: {
      nodes: [{ id: 'p', inputType: 'x', outputType: 'x', isolationTier: 'subprocess', deterministic: true }],
      edges: [],
    },
    capabilities: {},
    assertions: { p: { expect: 1, require: [] } },
    behaviors: { p: () => 1 },
    binding: { envSnapshot: 'e', toolVersion: '1', modelVersion: 'v1', seed },
  }
}

const target: TestTarget = { id: 'pluginA', spec: spec() }

describe('DualEntry（T4 双入口同结论 / D2 同内核映射）', () => {
  it('同一规格在本地自检与市场门禁得到同根、同判定', async () => {
    const de = new DualEntry()
    const local = await de.selfCheck(target)
    const gate = await de.gate([target])
    expect(gate.reports.length).toBe(1)
    expect(local.chain.root()).toBe(gate.reports[0]!.chain.root())
    expect(local.chain.entries.map((e) => e.verdict)).toEqual(gate.reports[0]!.chain.entries.map((e) => e.verdict))
  })

  it('dry-run 与正式门禁结论一致（可预测）', async () => {
    const de = new DualEntry()
    const normal = await de.gate([target])
    const dry = await de.gate([target], { dryRun: true })
    expect(dry.root).toBe(normal.root)
    expect(dry.dryRun).toBe(true)
    expect(normal.dryRun).toBe(false)
  })

  it('门禁报告判定可逐条追溯到证据链（可审计可追责）', async () => {
    const de = new DualEntry()
    const gate = await de.gate([target])
    for (const r of gate.reports) expect(r.chain.verify()).toBe(true)
    const traced = de.trace(gate, 'pluginA', 0)!
    expect(traced.entry.verdict).toBe('pass')
    expect(de.trace(gate, 'nope', 0)).toBeNull()
  })

  it('门禁聚合根是内容寻址的（任一目标链变化即翻转根）', async () => {
    const de = new DualEntry()
    const g1 = await de.gate([target])
    const other: TestTarget = { id: 'pluginA', spec: spec('different-seed') }
    const g2 = await de.gate([other])
    expect(g1.root).not.toBe(g2.root)
  })
})