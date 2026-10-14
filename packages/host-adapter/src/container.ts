import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
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
import { WORKER_SOURCE } from './subprocess.js'

/**
 * 容器档参考实现（architecture.md §5.3「端到端」；§8.1「容器/远程为后续适配器」）。
 *
 * 用 `docker run --rm -i -v <模块目录>:/app:ro <image> node -e <worker>` 起真实容器，
 * 与被测插件（PUT）仍只经行文本 JSON 帧（序列化消息桥，A4）通信。相比 vm 档，
 * 容器提供**安全隔离**（进程 + 文件系统 + 网络命名空间），可满足 `requireSecurityIsolation`。
 * 复用子进程档的内嵌 worker 协议（WORKER_SOURCE），仅载体从裸 node 子进程换成容器内 node。
 */

interface Frame {
  event: string
  state?: string
  handle?: string
  error?: string
  value?: unknown
  alive?: boolean
  code?: number | null
}

interface Waiter {
  predicate: (f: Frame) => boolean
  resolve: (f: Frame) => void
  timer: NodeJS.Timeout
}

const DEFAULT_TIMEOUT = 15_000
const DEFAULT_IMAGE = 'node:20-alpine'
const DEFAULT_DOCKER = 'docker'

export interface ContainerAdapterOptions {
  readonly image?: string
  readonly docker?: string
}

export class ContainerHostAdapter {
  readonly tier = 'container' as const

  private readonly image: string
  private readonly docker: string

  constructor(opts: ContainerAdapterOptions = {}) {
    this.image = opts.image ?? DEFAULT_IMAGE
    this.docker = opts.docker ?? DEFAULT_DOCKER
  }

  async spawn(spec: HostSpec): Promise<HostHandle> {
    if (spec.tier !== 'container') {
      throw new StateError('TIER_MISMATCH', `container adapter cannot serve tier '${spec.tier}'`)
    }
    return new ContainerHostHandle(spec, this.image, this.docker)
  }
}

class ContainerHostHandle implements HostHandle {
  readonly tier = 'container' as const

  private readonly sm = new HostStateMachine()
  private child: ChildProcess | null = null
  private readonly waiters: Waiter[] = []
  private buffer = ''
  private childLog = ''
  private childAlive = false

  constructor(
    private readonly spec: HostSpec,
    private readonly image: string,
    private readonly docker: string,
  ) {}

  get state(): HostLifecycle {
    return this.sm.state
  }

  async load(put: Put): Promise<LoadedHandle> {
    this.sm.guard(['PENDING'], 'load')
    this.sm.transition('LOADING')

    const id = randomUUID()
    const timeout = this.spec.timeout ?? DEFAULT_TIMEOUT
    const hostDir = dirname(resolve(put.module))
    const base = basename(put.module)
    const containerModule = `/app/${base}`

    const args = [
      'run',
      '--rm',
      '-i',
      '--label',
      'dsh-covenant=true',
      '-v',
      `${hostDir}:/app:ro`,
      this.image,
      'node',
      '-e',
      WORKER_SOURCE,
      containerModule,
      put.exportName ?? '',
      id,
    ]

    const child = spawn(this.docker, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    this.child = child
    this.childAlive = true

    child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 1)
        if (line.trim() === '') continue
        try {
          this.deliver(JSON.parse(line) as Frame)
        } catch {
          /* 忽略非 JSON 输出 */
        }
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      this.childLog += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      this.childAlive = false
      this.deliver({ event: 'exit', code: null, error: `container runtime unavailable: ${String(err?.message ?? err)}` })
    })
    child.on('exit', (code) => {
      this.childAlive = false
      this.deliver({ event: 'exit', code })
    })

    child.stdin!.write(JSON.stringify({ op: 'load', module: containerModule, exportName: put.exportName }))
    child.stdin!.write('\n')

    const frame = await this.waitFrame(
      (f) => f.event === 'ready' || f.event === 'failed' || f.event === 'exit',
      timeout,
    ).catch((): Frame => {
      this.childLog += 'timeout: load'
      child.kill('SIGKILL')
      return { event: 'failed', error: 'load timeout' }
    })

    if (frame.event === 'ready') {
      this.sm.transition('ACTIVE')
      return { id, state: 'ACTIVE' }
    }
    const reason = frame.event === 'failed' ? frame.error : `container exited (code ${frame.code}) before ready${frame.error ? ': ' + frame.error : ''}`
    this.sm.transition('FAILED')
    return { id, state: 'FAILED', error: reason ?? 'unknown failure' }
  }

  async drive(_loaded: LoadedHandle, op: DriveOp): Promise<DriveResult> {
    this.sm.guard(['ACTIVE'], 'drive')
    const frame = await this.request({ op: 'drive', args: op.args }, (f) => f.event === 'drive:result')
    return frame.error ? { ok: false, error: frame.error } : { ok: true, value: frame.value }
  }

  async inspect(_loaded: LoadedHandle): Promise<Inspection> {
    this.sm.guard(['ACTIVE'], 'inspect')
    const frame = await this.request({ op: 'inspect' }, (f) => f.event === 'inspect:result')
    return { state: this.state, alive: this.childAlive && frame.alive === true, meta: { image: this.image } }
  }

  async dispose(_loaded: LoadedHandle): Promise<void> {
    if (this.sm.state === 'DISPOSED') return
    this.sm.guard(['ACTIVE', 'FAILED', 'LOADING', 'PENDING'], 'dispose')
    this.sm.transition('UNLOADING')

    const child = this.child
    if (child && this.childAlive) {
      child.stdin!.write('{"op":"dispose"}\n')
      // 等容器客户端真正退出（`docker run --rm` 在客户端退出前完成移除），再回到 DISPOSED
      await new Promise<void>((resolveP) => {
        if (child.exitCode !== null || !this.childAlive) return resolveP()
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolveP()
        }, this.spec.timeout ?? DEFAULT_TIMEOUT)
        child.once('exit', () => {
          clearTimeout(timer)
          resolveP()
        })
      })
    }
    this.sm.transition('DISPOSED')
  }

  /** 内部日志（供诊断/断言）。 */
  get log(): string {
    return this.childLog
  }

  private request(msg: unknown, predicate: (f: Frame) => boolean): Promise<Frame> {
    if (!this.child?.stdin) throw new StateError('NO_CHILD', 'no live container')
    const pending = this.waitFrame(predicate, this.spec.timeout ?? DEFAULT_TIMEOUT)
    this.child.stdin.write(JSON.stringify(msg) + '\n')
    return pending
  }

  private waitFrame(predicate: (f: Frame) => boolean, timeout: number): Promise<Frame> {
    return new Promise<Frame>((resolveP, reject) => {
      const waiter: Waiter = { predicate, resolve: () => {}, timer: setTimeout(() => {}, 0) }
      const done = (f: Frame): void => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        clearTimeout(waiter.timer)
        resolveP(f)
      }
      waiter.resolve = done
      waiter.timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new StateError('TIMEOUT', 'timeout waiting for container frame'))
      }, timeout)
      this.waiters.push(waiter)
    })
  }

  private deliver(frame: Frame): void {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!
      if (w.predicate(frame)) {
        this.waiters.splice(i, 1)
        clearTimeout(w.timer)
        w.resolve(frame)
        return
      }
    }
    if (frame.event === 'exit' && !this.childAlive && this.sm.state === 'ACTIVE') {
      this.sm.transition('FAILED')
    }
  }
}

export function createContainerAdapter(opts: ContainerAdapterOptions = {}): ContainerHostAdapter {
  return new ContainerHostAdapter(opts)
}