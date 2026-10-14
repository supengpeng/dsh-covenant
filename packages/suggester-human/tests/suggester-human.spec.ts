import { describe, expect, it } from 'vitest'
import { valid, type CompositionGraph } from '@dsh-covenant/orchestrator-core'
import type { ToolManifest } from '@dsh-covenant/tool-spec'
import {
  constitute,
  HumanGateway,
  ruleModel,
  RuleSuggester,
  SuggesterRegistry,
  type ToolCatalog,
} from '../src/index.js'

function mn(id: string, ioType: string, tier: 'vm' | 'subprocess' | 'container' = 'subprocess'): ToolManifest {
  return {
    id,
    version: '1.0.0',
    ioType,
    isolationTier: tier,
    deterministic: true,
    sideEffects: [],
    timeout: 1000,
    verdictSchema: 'pass',
  }
}

const catalog: ToolCatalog = { tools: [mn('t1', 'x'), mn('t2', 'x'), mn('t3', 'y', 'vm'), mn('t4', 'x', 'vm')] }

const validGraph: CompositionGraph = {
  nodes: [{ id: 'a', inputType: 'x', outputType: 'x', isolationTier: 'subprocess', deterministic: true }],
  edges: [],
}
const cyclicGraph: CompositionGraph = {
  nodes: [
    { id: 'a', inputType: 'x', outputType: 'x', isolationTier: 'subprocess', deterministic: true },
    { id: 'b', inputType: 'x', outputType: 'x', isolationTier: 'subprocess', deterministic: true },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ],
}

describe('规则引擎建议器（§9.2 / A6）', () => {
  it('产出自检单工具 + 两两类型兼容链，且候选图全部合法', () => {
    const drafts = ruleModel(catalog)
    expect(drafts.length).toBeGreaterThan(0)
    for (const d of drafts) expect(valid(d.graph)).toEqual({ ok: true })
  })

  it('跨档（同类型、异隔离档）自动加序列化桥', () => {
    const cross = ruleModel(catalog).find((d) => d.id === 'chain:t1->t4')!
    expect(cross).toBeDefined()
    expect(cross.graph.edges[0]!.bridged).toBe(true)
  })

  it('输出为纯函数且不改 catalog（A6 运行时建议器只读不改内核）', () => {
    const before = JSON.stringify(catalog)
    const suggester = new RuleSuggester('v1', ruleModel)
    const a = suggester.suggest(catalog)
    const b = suggester.suggest(catalog)
    expect(a).toEqual(b)
    expect(JSON.stringify(catalog)).toBe(before)
    expect(a.every((c) => c.modelVersion === 'v1')).toBe(true) // 模型版本溯源
  })
})

describe('铸成规格（valid(G) + 人工确认，§9.3）', () => {
  it('valid 且人工确认 → ok；任一缺 -> 拒绝', () => {
    expect(constitute(validGraph, true)).toEqual({ ok: true })
    expect(constitute(validGraph, false).ok).toBe(false) // 未人工确认
    const inv = constitute(cyclicGraph, true)
    expect(inv.ok).toBe(false)
    expect((inv as { reason: string }).reason).toMatch(/cyclic/)
  })
})

describe('人工把关（决策留痕，作训练原料）', () => {
  it('接受/拒绝分开记录且决定成员关系', () => {
    const gw = new HumanGateway()
    gw.decide({ id: 'c1', graph: validGraph, rationale: 'r', modelVersion: 'v1' }, { kind: 'accept', candidateId: 'c1' }, 1)
    gw.decide({ id: 'c2', graph: validGraph, rationale: 'r', modelVersion: 'v1' }, { kind: 'reject', candidateId: 'c2', reason: 'no' }, 2)
    expect(gw.isAccepted('c1')).toBe(true)
    expect(gw.isAccepted('c2')).toBe(false)
    expect(gw.recordsSnapshot().length).toBe(2)
  })
})

describe('模型版本化替换 + 回滚（版本化替换 B）', () => {
  it('deploy v2 生效，rollback 恢复 v1', () => {
    const reg = new SuggesterRegistry()
    reg.deploy('v1', ruleModel)
    reg.deploy('v2', () => []) // 空模型
    expect(reg.active()!.version).toBe('v2')
    expect(reg.active()!.suggest(catalog).length).toBe(0)
    reg.rollback()
    expect(reg.active()!.version).toBe('v1')
    expect(reg.active()!.suggest(catalog).length).toBeGreaterThan(0)
  })
})