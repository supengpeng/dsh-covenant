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
 * 远程档参考实现（architecture.md §5.3「端到端」；§8.1「容器·远程」后续适配器）。
 *
 * 传输：`scp -r <模块目录> <target>:<远程临时目录>/` 上传被测插件模块，
 * 再 `ssh <target> node -e <worker> …` 在远程主机装载/驱动，仍只经行文本 JSON 帧
 * （序列化消息桥，A4）通信；dispose 清理远程临时目录。
 *
 * 注意：ssh 会把 argv 拼接后交给远程 shell 解析，故 worker 源码以 **base64** 传输
 * （shell 安全字符集）+ 各参数逐一带引号，避免多行/元字符被 shell 破坏。
 * 与 container 档同构：仅载体从 docker 换成 ssh。当 `target` 指向**独立可信主机**时
 * 提供跨主机隔离，可满足 `requireSecurityIsolation`；默认 `localhost` 仅是协议/传输的
 * 自测目标（同机回环），**不构成「独立主机隔离」证据**——安全隔离主张须以真实远端主机为准。
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

const DEFAULT_TIMEOUT = 20_000
const DEFAULT_TARGET = 'localhost'
const DEFAULT_SSH = 'ssh'
const DEFAULT_SCP = 'scp'

/** worker 源码 base64（shell 安全），远程解码后 eval；splice 掉 b64 使 worker 看到正确 argv。 */
const WORKER_B64 = Buffer.from(WORKER_SOURCE, 'utf8').toString('base64')
const DECODER =
  "{var b=process.argv[1];process.argv.splice(1,1);eval(Buffer.from(b,'base64').toString('utf8'))}"

/** POSIX 单引号转义（含内部单引号）。 */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export interface RemoteAdapterOptions {
  readonly target?: string
  readonly ssh?: string
  readonly scp?: string
}

function sshOpts(): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no']
}

export class RemoteHostAdapter {
  readonly tier = 'remote' as const

  private readonly target: string
  private readonly ssh: string
  private readonly scp: string

  constructor(opts: RemoteAdapterOptions = {}) {
    this.target = opts.target ?? DEFAULT_TARGET
    this.ssh = opts.ssh ?? DEFAULT_SSH
    this.scp = opts.scp ?? DEFAULT_SCP
  }

  async spawn(spec: HostSpec): Promise<HostHandle> {
    if (spec.tier !== 'remote') {
      throw new StateError('TIER_MISMATCH', `remote adapter cannot serve tier '${spec.tier}'`)
    }
    return new RemoteHostHandle(spec, this.target, this.ssh, this.scp)
  }
}

class RemoteHostHandle implements HostHandle {
  readonly tier = 'remote' as const

  private readonly sm = new HostStateMachine()
  private child: ChildProcess | null = null
  private readonly waiters: Waiter[] = []
  private buffer = ''
  private childLog = ''
  private childAlive = false
  private remoteDir: string | null = null

  constructor(
    private readonly spec: HostSpec,
    private readonly target: string,
    private readonly ssh: string,
    private readonly scp: string,
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
    const remoteDir = `/tmp/dsh-covenant-remote-${id}`
    this.remoteDir = remoteDir
    const remoteModule = `${remoteDir}/${base}`

    // 1) 上传模块目录到远程临时目录（序列化传输，A4 无共享可变状态）。
    //    `-O` 强制 legacy scp：现代 sftp-scp 对「不存在的目标目录 + 尾斜杠」会 canonicalize 失败。
    const scpRes = await execOnce([this.scp, '-O', '-r', ...sshOpts(), hostDir, `${this.target}:${remoteDir}`])
    if (scpRes.code !== 0) {
      this.sm.transition('FAILED')
      return { id, state: 'FAILED', error: `module upload failed: ${scpRes.stderr.trim() || String(scpRes.code)}` }
    }

    // 2) 远程执行 worker（整个远程命令作为单一已引号化参数，避免 ssh→shell 破坏）
    const remoteCmd = `node -e ${sq(DECODER)} ${sq(WORKER_B64)} ${sq(remoteModule)} ${sq(put.exportName ?? '')} ${sq(id)}`
    const child = spawn(this.ssh, [...sshOpts(), this.target, remoteCmd], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
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
      this.deliver({ event: 'exit', code: null, error: `remote host unavailable: ${String(err?.message ?? err)}` })
    })
    child.on('exit', (code) => {
      this.childAlive = false
      this.deliver({ event: 'exit', code })
    })

    child.stdin!.write(JSON.stringify({ op: 'load', module: remoteModule, exportName: put.exportName }))
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
    const reason =
      frame.event === 'failed'
        ? frame.error
        : `remote worker exited (code ${frame.code}) before ready${frame.error ? ': ' + frame.error : ''}`
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
    return { state: this.state, alive: this.childAlive && frame.alive === true, meta: { target: this.target } }
  }

  async dispose(_loaded: LoadedHandle): Promise<void> {
    if (this.sm.state === 'DISPOSED') return
    this.sm.guard(['ACTIVE', 'FAILED', 'LOADING', 'PENDING'], 'dispose')
    this.sm.transition('UNLOADING')

    const child = this.child
    if (child && this.childAlive) {
      child.stdin!.write('{"op":"dispose"}\n')
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
    if (this.remoteDir) {
      await execOnce([this.ssh, ...sshOpts(), this.target, `rm -rf ${sq(this.remoteDir)}`])
    }
    this.sm.transition('DISPOSED')
  }

  get log(): string {
    return this.childLog
  }

  private request(msg: unknown, predicate: (f: Frame) => boolean): Promise<Frame> {
    if (!this.child?.stdin) throw new StateError('NO_CHILD', 'no live remote process')
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
        reject(new StateError('TIMEOUT', 'timeout waiting for remote frame'))
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

function execOnce(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn(args[0]!, args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
    child.stderr!.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', (err) => resolveP({ code: null, stdout, stderr: `spawn error: ${String(err?.message ?? err)}` }))
    child.on('exit', (code) => resolveP({ code, stdout, stderr }))
  })
}

export function createRemoteAdapter(opts: RemoteAdapterOptions = {}): RemoteHostAdapter {
  return new RemoteHostAdapter(opts)
}