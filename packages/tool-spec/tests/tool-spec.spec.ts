import { describe, expect, it } from 'vitest'
import { valid } from '@dsh-covenant/orchestrator-core'
import {
  ProtocolAdapter,
  sameConclusion,
  TestTool,
  toGraphNode,
  validateManifest,
  type ToolManifest,
} from '../src/index.js'

function manifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id: 't',
    version: '1.0.0',
    ioType: 'x',
    isolationTier: 'subprocess',
    deterministic: true,
    sideEffects: [],
    timeout: 1000,
    verdictSchema: 'pass',
    ...overrides,
  }
}

describe('validateManifest（§5.6 字段齐全）', () => {
  it('accepts a complete manifest', () => {
    expect(validateManifest(manifest())).toEqual({ ok: true })
  })

  it('rejects incomplete manifests', () => {
    expect(validateManifest(manifest({ id: '' })).ok).toBe(false)
    expect(validateManifest(manifest({ version: '' })).ok).toBe(false)
    expect(validateManifest(manifest({ ioType: '' })).ok).toBe(false)
    expect(validateManifest(manifest({ timeout: 0 })).ok).toBe(false)
    expect(validateManifest(manifest({ timeout: Number.NaN })).ok).toBe(false)
    expect(validateManifest(manifest({ verdictSchema: 'maybe' as never })).ok).toBe(false)
    expect(validateManifest(manifest({ sideEffects: ['nope' as never] })).ok).toBe(false)
  })
})

describe('SDK 主路径 ⇔ 协议兜底适配器可互换（§5.6）', () => {
  class AdderSdk extends TestTool {
    readonly manifest = manifest({ id: 'adder', ioType: 'num' })
    async run(input: unknown): Promise<unknown> {
      const n = input as { a: number; b: number }
      return n.a + n.b
    }
  }

  const adderProtocol = new ProtocolAdapter(manifest({ id: 'adder', ioType: 'num' }), async (input) => {
    const n = input as { a: number; b: number }
    return n.a + n.b
  })

  it('same manifest + same logic → same conclusion over a set of inputs', async () => {
    expect(await sameConclusion(new AdderSdk(), adderProtocol, [{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: -1, b: 10 }])).toBe(true)
  })

  it('different tool identities do not compare as interchangeable', async () => {
    const other = new ProtocolAdapter(manifest({ id: 'other', ioType: 'num' }), async (i) => i)
    expect(await sameConclusion(new AdderSdk(), other, [{ a: 1, b: 2 }])).toBe(false)
  })
})

describe('仅凭 manifest 即可静态校验（组合内核无需理解工具内部）', () => {
  const a = manifest({ id: 'a', ioType: 'x', isolationTier: 'vm' })
  const b = manifest({ id: 'b', ioType: 'x', isolationTier: 'subprocess' })
  const c = manifest({ id: 'c', ioType: 'y', isolationTier: 'vm' })

  it('单工具自检图合法', () => {
    expect(valid({ nodes: [toGraphNode(a)], edges: [] })).toEqual({ ok: true })
  })

  it('类型不匹配（ioType 不同）被 valid 拒绝', () => {
    const v = valid({ nodes: [toGraphNode(a), toGraphNode(c)], edges: [{ from: 'a', to: 'c' }] })
    expect(v.ok).toBe(false)
    expect((v as { reasons: readonly string[] }).reasons.join(' ')).toMatch(/type mismatch/)
  })

  it('跨档无桥被 valid 拒绝', () => {
    const v = valid({ nodes: [toGraphNode(a), toGraphNode(b)], edges: [{ from: 'a', to: 'b' }] })
    expect(v.ok).toBe(false)
    expect((v as { reasons: readonly string[] }).reasons.join(' ')).toMatch(/isolation-tier/)
  })
})