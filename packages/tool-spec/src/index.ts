import { deepEqual, VERDICTS, type Verdict } from '@dsh-covenant/assertion'
import type { IsolationTier } from '@dsh-covenant/host-adapter'

/**
 * 工具规范（development.md §5.6）。
 *
 * `ToolManifest` 即协议内核：自描述完整到「组合内核无需理解工具内部」即可做
 * 类型/隔离档静态校验。SDK 主路径（`TestTool`）与协议兜底（`ProtocolAdapter`）
 * 针对同一工具逻辑可互换（同一输入 → 同结论）。
 */

/** A4 六信道副作用维度（共享内存/模块级可变/文件/端口/网络/环境变量/缓存）。 */
export type SideEffect =
  | 'shared-memory'
  | 'module-state'
  | 'file'
  | 'port'
  | 'network'
  | 'env'
  | 'cache'

const SIDE_EFFECTS: ReadonlySet<string> = new Set([
  'shared-memory',
  'module-state',
  'file',
  'port',
  'network',
  'env',
  'cache',
])

export interface ToolManifest {
  readonly id: string
  readonly version: string
  /** I/O 类型，供组合图类型约束（§5.6）。 */
  readonly ioType: string
  readonly isolationTier: IsolationTier
  /** A8：节点确定性标志。 */
  readonly deterministic: boolean
  readonly sideEffects: readonly SideEffect[]
  readonly timeout: number
  readonly verdictSchema: Verdict
}

export type ManifestValidity = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] }

/** manifest 字段校验（§5.6「字段齐全」）。 */
export function validateManifest(m: ToolManifest): ManifestValidity {
  const reasons: string[] = []
  if (!m.id.trim()) reasons.push('id is empty')
  if (!m.version.trim()) reasons.push('version is empty')
  if (!m.ioType.trim()) reasons.push('ioType is empty')
  if (!(Number.isFinite(m.timeout) && m.timeout > 0)) reasons.push('timeout must be > 0')
  if (!(VERDICTS as readonly string[]).includes(m.verdictSchema)) reasons.push(`verdictSchema '${m.verdictSchema}' is not a Verdict`)
  for (const s of m.sideEffects) if (!SIDE_EFFECTS.has(s)) reasons.push(`unknown sideEffect '${String(s)}'`)
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

/** 由 manifest 派生组合图节点的结构化字段（供组合内核静态校验；无反向类型依赖，结构兼容 NodeSpec）。 */
export function toGraphNode(m: ToolManifest): {
  readonly id: string
  readonly inputType: string
  readonly outputType: string
  readonly isolationTier: IsolationTier
  readonly deterministic: boolean
} {
  return {
    id: m.id,
    inputType: m.ioType,
    outputType: m.ioType,
    isolationTier: m.isolationTier,
    deterministic: m.deterministic,
  }
}

export interface Tool {
  readonly manifest: ToolManifest
  run(input: unknown): Promise<unknown>
}

/** SDK 主路径：作者继承实现 `manifest` 与 `run`。 */
export abstract class TestTool implements Tool {
  abstract readonly manifest: ToolManifest
  abstract run(input: unknown): Promise<unknown>
}

/** 协议兜底适配器：把「符合调用协议的异步函数」包成 Tool（与 SDK 主路径可互换）。 */
export type ProtocolInvoke = (input: unknown) => Promise<unknown>

export class ProtocolAdapter implements Tool {
  constructor(
    readonly manifest: ToolManifest,
    private readonly invoke: ProtocolInvoke,
  ) {}

  async run(input: unknown): Promise<unknown> {
    return this.invoke(input)
  }
}

/** 可互换性：同一组输入下，SDK 与协议两条路径产出一致结论（§5.6 验收门）。 */
export async function sameConclusion(a: Tool, b: Tool, inputs: readonly unknown[]): Promise<boolean> {
  if (a.manifest.id !== b.manifest.id) return false
  for (const input of inputs) {
    if (!deepEqual(await a.run(input), await b.run(input))) return false
  }
  return true
}