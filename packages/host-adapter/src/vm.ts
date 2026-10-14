import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import {
  HostStateMachine,
  StateError,
  type DriveOp,
  type DriveResult,
  type HostHandle,
  type HostLifecycle,
  type HostSpec,
  type Inspection,
  type LoadedHandle,
  type Put,
} from './spi.js'

/**
 * vm 档（architecture.md §5.3「单元/契约」，进程内 `node:vm` 白盒）。
 *
 * **A7 范围限制（显式成文）**：`node:vm` 只提供**行为隔离**（独立全局作用域），
 * **不是安全隔离 / 安全边界**；对抗故障模型必须走子进程 / 容器档。
 * 因此本适配器拒绝任何 `requireSecurityIsolation` 场景（越界即拒退）。
 */

export const A7_DISCLAIMER =
  'node:vm provides behavioral isolation only — NOT a security boundary (A7). Adversarial scenarios require the subprocess/container tier.'

function universalMockCtx(): unknown {
  // 通用 mock：任意属性访问/调用/构造都返回自身，保证 PUT 的 apply(ctx) 不缺真实宿主 API 时不抛错
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mock: any = function () {}
  return new Proxy(mock, {
    get: () => mock,
    apply: () => mock,
    construct: () => mock,
  })
}

export class VmHostAdapter {
  readonly tier = 'vm' as const

  async spawn(spec: HostSpec): Promise<HostHandle> {
    if (spec.tier !== 'vm') {
      throw new StateError('TIER_MISMATCH', `vm adapter cannot serve tier '${spec.tier}'`)
    }
    if (spec.requireSecurityIsolation) {
      throw new StateError('A7_VIOLATION', A7_DISCLAIMER)
    }
    return new VmHostHandle(spec)
  }
}

class VmHostHandle implements HostHandle {
  readonly tier = 'vm' as const
  private readonly sm = new HostStateMachine()
  private disposer: (() => unknown) | undefined

  constructor(private readonly spec: HostSpec) {}

  get state(): HostLifecycle {
    return this.sm.state
  }

  async load(put: Put): Promise<LoadedHandle> {
    this.sm.guard(['PENDING'], 'load')
    this.sm.transition('LOADING')
    const id = randomUUID()
    try {
      // vm 档只支持 CJS 形态（module.exports）的 PUT 源；ESM import/export 在 vm.Script 内不支持 → FAILED
      const src = await readFile(put.module, 'utf8')
      const moduleObj: { exports: unknown } = { exports: undefined }
      const sandbox = { module: moduleObj, exports: moduleObj.exports }
      vm.createContext(sandbox)
      const wrapper = `(function (module, exports) { ${src}\n})(module, exports)`
      new vm.Script(wrapper, { filename: put.module }).runInContext(sandbox)

      const mod = moduleObj.exports as Record<string, unknown>
      const apply =
        (put.exportName && mod[put.exportName]) ?? mod.apply ?? (mod.default as { apply?: unknown } | undefined)?.apply ?? mod.default
      if (typeof apply === 'function') {
        const ret = await (apply as (ctx: unknown) => unknown)(universalMockCtx())
        if (typeof ret === 'function') this.disposer = ret as () => unknown
      }
      this.sm.transition('ACTIVE')
      return { id, state: 'ACTIVE' }
    } catch (err) {
      this.sm.transition('FAILED')
      return { id, state: 'FAILED', error: String((err as Error)?.stack ?? err) }
    }
  }

  async drive(_loaded: LoadedHandle, op: DriveOp): Promise<DriveResult> {
    this.sm.guard(['ACTIVE'], 'drive')
    // 进程内序列化往返：与子进程档同一语义（只经可序列化快照，A4）
    try {
      const value = JSON.parse(JSON.stringify(op.args ?? null))
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  }

  async inspect(_loaded: LoadedHandle): Promise<Inspection> {
    this.sm.guard(['ACTIVE'], 'inspect')
    return { state: this.state, alive: true, meta: { inProcess: true } }
  }

  async dispose(_loaded: LoadedHandle): Promise<void> {
    if (this.sm.state === 'DISPOSED') return
    this.sm.guard(['PENDING', 'LOADING', 'ACTIVE', 'FAILED'], 'dispose')
    this.sm.transition('UNLOADING')
    try {
      if (this.disposer) this.disposer()
    } catch {
      /* 处置失败不影响到达 DISPOSED */
    }
    this.sm.transition('DISPOSED')
  }
}

export function createVmAdapter(): VmHostAdapter {
  return new VmHostAdapter()
}