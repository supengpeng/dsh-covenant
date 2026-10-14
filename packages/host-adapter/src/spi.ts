/**
 * 宿主适配器 SPI（architecture.md §8.1 / development.md §5.3、§3.4）。
 *
 * 平台是「控制面」；被测插件（PUT）通过宿主适配器在**隔离工作宿主**内装载/驱动，
 * 控制面与工作宿主只经序列化消息桥（A4 零共享可变状态）。
 */

/** 隔离档（architecture.md §5.3：vm / 子进程 / 容器 / 远程）。 */
export type IsolationTier = 'vm' | 'subprocess' | 'container' | 'remote'

/**
 * 工作宿主生命周期状态——镜像 cordis FiberState 语义
 * （PENDING → LOADING → ACTIVE → (UNLOADING) → DISPOSED，可 ↘ FAILED）。
 * 用字符串枚举（而非 cordis 的 const enum）以便运行时可见与可测试。
 */
export type HostLifecycle =
  | 'PENDING'
  | 'LOADING'
  | 'ACTIVE'
  | 'UNLOADING'
  | 'DISPOSED'
  | 'FAILED'

/** 状态机硬错误（机器可读 code，对齐 CordisError 风格）。 */
export class StateError extends Error {
  override readonly name = 'StateError'
  readonly code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

/** 合法迁移表；DISPOSED 无出边（终端态，不可重启——§15.8 硬契约）。 */
const LEGAL: Readonly<Record<HostLifecycle, readonly HostLifecycle[]>> = {
  PENDING: ['LOADING', 'FAILED', 'UNLOADING', 'DISPOSED'],
  LOADING: ['ACTIVE', 'FAILED', 'UNLOADING', 'DISPOSED'],
  ACTIVE: ['FAILED', 'UNLOADING', 'DISPOSED'],
  UNLOADING: ['DISPOSED', 'FAILED'],
  FAILED: ['UNLOADING', 'DISPOSED'],
  DISPOSED: [],
}

export class HostStateMachine {
  private _state: HostLifecycle = 'PENDING'
  get state(): HostLifecycle {
    return this._state
  }

  /** 断言当前处于某状态，否则抛 StateError（越界即拒退）。 */
  guard(required: readonly HostLifecycle[], op: string): void {
    if (!required.includes(this._state)) {
      throw new StateError(
        'ILLEGAL_OPERATION',
        `illegal ${op}: state is ${this._state}, required ${required.join('|')}`,
      )
    }
  }

  /** 迁移。DISPOSED 之后任何迁移 / 非法迁移均抛 StateError。 */
  transition(next: HostLifecycle): void {
    if (this._state === 'DISPOSED') {
      throw new StateError('DISPOSED_RESTART', 'host already DISPOSED — cannot restart (§15.8 hard contract)')
    }
    if (!LEGAL[this._state].includes(next)) {
      throw new StateError('ILLEGAL_TRANSITION', `illegal lifecycle transition ${this._state} → ${next}`)
    }
    this._state = next
  }
}

/** 宿主规格（§5.3：tier/env/timeout/resourceBind；含 A7 隔离强度要求）。 */
export interface HostSpec {
  readonly tier: IsolationTier
  readonly timeout?: number
  readonly env?: Record<string, string>
  /** 租约占位（§15.6，worker-host-runtime 落地）。 */
  readonly resourceBind?: string
  /**
   * 场景是否要求「安全隔离」（对抗故障模型）。`node:vm`（A7）只提供行为隔离，
   * 设 true 时 vm 档必须拒退，只有子进程/容器档可满足。
   */
  readonly requireSecurityIsolation?: boolean
}

/** 被测插件（PUT）的最小加载描述。 */
export interface Put {
  readonly module: string
  readonly exportName?: string
}

export interface LoadedHandle {
  readonly id: string
  readonly state: HostLifecycle
  readonly error?: string
}

export interface DriveOp {
  readonly kind: string
  readonly args?: unknown
}

export interface DriveResult {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: string
}

export interface Inspection {
  readonly state: HostLifecycle
  readonly alive: boolean
  readonly meta?: Record<string, unknown>
}

/** 统一 HostHandle：load → drive → inspect → dispose 严格走状态机（§3.4）。 */
export interface HostHandle {
  readonly tier: IsolationTier
  readonly state: HostLifecycle
  load(put: Put): Promise<LoadedHandle>
  drive(loaded: LoadedHandle, op: DriveOp): Promise<DriveResult>
  inspect(loaded: LoadedHandle): Promise<Inspection>
  dispose(loaded: LoadedHandle): Promise<void>
}

export interface HostAdapter {
  readonly tier: IsolationTier
  spawn(spec: HostSpec): Promise<HostHandle>
}