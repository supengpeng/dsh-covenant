import type { HostHandle, HostLifecycle, IsolationTier } from '@dsh-covenant/host-adapter'

/**
 * 隔离工作宿主运行时（development.md §5.8；architecture.md §5.2/§5.3）。
 *
 * 是 `host-adapter` 的执行后端：管理 WorkerInstance（三档隔离 + 租约），
 * 并落地 A4 零共享可变状态（信道清单须为空）与 §15.6 租约回收。
 */

/** A4 信道清单（均须为空）：进程内共享内存/模块级可变/文件/端口/网络/环境变量/缓存。 */
export type Channel =
  | 'shared-memory'
  | 'module-state'
  | 'file'
  | 'port'
  | 'network'
  | 'env'
  | 'cache'

/** 实例的资源配置（channel 若被设定，则两个实例值相同即视为「共享该信道」= 违反 A4）。 */
export interface ResourceBindings {
  readonly sharedMemory?: object
  readonly moduleState?: object
  readonly file?: string
  readonly port?: number
  readonly network?: string
  readonly env?: Readonly<Record<string, string>>
  readonly cache?: string
}

/** 断言两实例之间无可写共享信道；返回被违反的信道名（空数组 = A4 满足）。 */
export function assertNoSharedChannels(
  a?: ResourceBindings,
  b?: ResourceBindings,
): readonly Channel[] {
  const violated: Channel[] = []
  if (a?.sharedMemory !== undefined && a.sharedMemory === b?.sharedMemory) violated.push('shared-memory')
  if (a?.moduleState !== undefined && a.moduleState === b?.moduleState) violated.push('module-state')
  if (a?.file !== undefined && a.file === b?.file) violated.push('file')
  if (a?.port !== undefined && a.port === b?.port) violated.push('port')
  if (a?.network !== undefined && a.network === b?.network) violated.push('network')
  if (a?.cache !== undefined && a.cache === b?.cache) violated.push('cache')
  if (a?.env !== undefined && b?.env !== undefined && shareEnv(a.env, b.env)) violated.push('env')
  return violated
}

function shareEnv(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  for (const k of Object.keys(a)) {
    if (k in b && a[k] === b[k] && a[k] !== '') return true
  }
  return false
}

/** 租约 = 资源占位（非权限），TTL 到期回收留痕（§15.6 / §15.3 租约回收）。 */
export interface Lease {
  readonly token: string
  readonly tier: IsolationTier
  readonly ttlMs: number
  readonly acquiredAt: number
  state: 'held' | 'recycled'
  holder: string | null
  /** 留痕（append-only 语义；这里用不可变数组 + 复制替换）。 */
  readonly history: readonly string[]
}

export function issueLease(token: string, tier: IsolationTier, ttlMs: number, now: number): Lease {
  return { token, tier, ttlMs, acquiredAt: now, state: 'held', holder: null, history: [`issued@${now}`] }
}

export function isExpired(lease: Lease, now: number): boolean {
  return lease.state === 'held' && now - lease.acquiredAt >= lease.ttlMs
}

/** 回收租约（返回带留痕的新对象，不改入参——不可变）。 */
export function recycleLease(lease: Lease, now: number): Lease {
  return { ...lease, state: 'recycled', history: [...lease.history, `recycled@${now}`] }
}

/** 工作宿主实例（§5.8：WorkerInstance { tier; lease; state }）。 */
export interface WorkerInstance {
  readonly id: string
  readonly tier: IsolationTier
  readonly handle: HostHandle | null
  readonly bindings?: ResourceBindings
  lease: Lease | null
  state: HostLifecycle
}

export interface AcquireOptions {
  readonly ttlMs?: number
  readonly bindings?: ResourceBindings
  readonly handle?: HostHandle
  readonly now?: number
}

/** 三档执行环境运行时：并发各占独立实例 + 租约回收。 */
export class WorkerHostRuntime {
  private seq = 0
  private readonly instances = new Map<string, WorkerInstance>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** 分配一个独立实例（每个实例独立租约 + 独立 id；同档并发互不共享）。 */
  acquire(tier: IsolationTier, opts: AcquireOptions = {}): WorkerInstance {
    const now = opts.now ?? this.now()
    const id = `${tier}-${++this.seq}`
    const lease = issueLease(`lease:${id}`, tier, opts.ttlMs ?? 60_000, now)
    lease.holder = id
    const instance: WorkerInstance = {
      id,
      tier,
      handle: opts.handle ?? null,
      bindings: opts.bindings,
      lease,
      state: 'PENDING',
    }
    this.instances.set(id, instance)
    return instance
  }

  /** 释放实例并回收其租约（留痕）。 */
  release(id: string): Lease | null {
    const inst = this.instances.get(id)
    if (!inst || !inst.lease) return null
    const recycled = recycleLease(inst.lease, this.now())
    inst.lease = recycled
    inst.state = 'DISPOSED'
    return recycled
  }

  /** TTL 到期回收：返回本次被回收的租约（留痕）；到期未回收者调用方须判 FAIL。 */
  recycleExpired(): readonly Lease[] {
    const now = this.now()
    const recycled: Lease[] = []
    for (const inst of this.instances.values()) {
      if (inst.lease && isExpired(inst.lease, now)) {
        inst.lease = recycleLease(inst.lease, now)
        inst.state = 'DISPOSED'
        recycled.push(inst.lease)
      }
    }
    return recycled
  }

  /** 尚未回收但已过期的租约数（治理检测点：应为 0，否则判 FAIL）。 */
  expiredUnrecycled(): number {
    const now = this.now()
    let n = 0
    for (const inst of this.instances.values()) {
      if (inst.lease && isExpired(inst.lease, now)) n += 1
    }
    return n
  }

  get instancesSnapshot(): readonly WorkerInstance[] {
    return [...this.instances.values()]
  }
}