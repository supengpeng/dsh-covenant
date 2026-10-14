import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
 * 子进程档参考实现（architecture.md §5.3「单插件集成」；§8.1「参考实现先做本地子进程」）。
 *
 * 控制面经 `node -e` 内嵌 worker 起独立子进程，与被测插件（PUT）只通过
 * 行文本 JSON 帧（序列化消息桥，A4）通信——崩溃/泄漏不拖垮平台进程。
 * 内嵌 worker 为 CommonJS（V8 直接 eval），PUT 由 worker 动态 `import()`（兼容 ESM/CJS）。
 */

// 内嵌 worker（避免依赖运行期文件路径解析；仅用单/双引号，无模板字符串）
const WORKER_SOURCE = [
  "'use strict'",
  "const readline = require('node:readline')",
  'function mockCtx() {',
  '  var mock = function () {}',
  '  return new Proxy(mock, {',
  '    get: function () { return mock },',
  '    apply: function () { return mock },',
  '    construct: function () { return mock }',
  '  })',
  '}',
  "function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n') }",
  'var moduleArg = process.argv[1]',
  'var exportName = process.argv[2]',
  'var handleId = process.argv[3]',
  'var disposer = null',
  "var state = 'PENDING'",
  'async function doLoad(mod, exp) {',
  '  var origWrite = process.stdout.write.bind(process.stdout)',
  '  try {',
  '    var ns = await import(mod)',
  "    var apply = (exp && ns[exp]) || ns.apply || (ns.default && (ns.default.apply || ns.default)) || ns.default",
  '    process.stdout.write = process.stderr.write.bind(process.stderr)',
  '    try {',
  "      if (typeof apply === 'function') {",
  '        var ret = await apply(mockCtx())',
  "        if (typeof ret === 'function') disposer = ret",
  '      }',
  '    } finally { process.stdout.write = origWrite }',
  "    state = 'ACTIVE'",
  "    send({ event: 'ready', handle: handleId, state: 'ACTIVE' })",
  '  } catch (err) {',
  '    process.stdout.write = origWrite',
  "    state = 'FAILED'",
  "    send({ event: 'failed', error: String((err && err.stack) || err) })",
  '    setTimeout(function () { process.exit(1) }, 10)',
  '  }',
  '}',
  'var rl = readline.createInterface({ input: process.stdin })',
  "rl.on('line', function (line) {",
  '  var msg = null',
  "  try { msg = JSON.parse(line) } catch (e) { return }",
  "  if (msg.op === 'load') {",
  '    doLoad(msg.module, msg.exportName)',
  "  } else if (msg.op === 'drive') {",
  '    try {',
  '      var value = JSON.parse(JSON.stringify(msg.args === undefined ? null : msg.args))',
  "      send({ event: 'drive:result', ok: true, value: value })",
  '    } catch (err) {',
  "      send({ event: 'drive:result', ok: false, error: String((err && err.message) || err) })",
  '    }',
  "  } else if (msg.op === 'inspect') {",
  "    send({ event: 'inspect:result', state: state, alive: true, handle: handleId })",
  "  } else if (msg.op === 'dispose') {",
  '    (async function () {',
  "      try { if (typeof disposer === 'function') await disposer() } catch (e) {}",
  "      state = 'DISPOSED'",
  "      send({ event: 'disposed', handle: handleId, state: 'DISPOSED' })",
  '      setTimeout(function () { process.exit(0) }, 10)',
  '    })()',
  '  }',
  '})',
].join('\n')

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

const DEFAULT_TIMEOUT = 5000

export class SubprocessHostAdapter {
  readonly tier = 'subprocess' as const

  async spawn(spec: HostSpec): Promise<HostHandle> {
    if (spec.tier !== 'subprocess') {
      throw new StateError('TIER_MISMATCH', `subprocess adapter cannot serve tier '${spec.tier}'`)
    }
    return new SubprocessHostHandle(spec)
  }
}

class SubprocessHostHandle implements HostHandle {
  readonly tier = 'subprocess' as const

  private readonly sm = new HostStateMachine()
  private child: ChildProcess | null = null
  private readonly waiters: Waiter[] = []
  private buffer = ''
  private childLog = ''
  private childAlive = false

  constructor(private readonly spec: HostSpec) {}

  get state(): HostLifecycle {
    return this.sm.state
  }

  async load(put: Put): Promise<LoadedHandle> {
    this.sm.guard(['PENDING'], 'load')
    this.sm.transition('LOADING')

    const id = randomUUID()
    const timeout = this.spec.timeout ?? DEFAULT_TIMEOUT
    const child = spawn(process.execPath, ['-e', WORKER_SOURCE, put.module, put.exportName ?? '', id], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
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
          /* 忽略非 JSON 输出（防御 PUT 污染） */
        }
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      this.childLog += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      this.childAlive = false
      this.deliver({ event: 'exit', code: null, error: String(err) })
    })
    child.on('exit', (code) => {
      this.childAlive = false
      this.deliver({ event: 'exit', code })
    })

    child.stdin!.write(JSON.stringify({ op: 'load', module: put.module, exportName: put.exportName }))
    child.stdin!.write('\n')

    const frame = await this.waitFrame(
      (f) => f.event === 'ready' || f.event === 'failed' || f.event === 'exit',
      timeout,
    ).catch((err: Error): Frame => {
      this.childLog += 'timeout: ' + err.message
      child.kill('SIGKILL')
      return { event: 'failed', error: 'load timeout' }
    })

    if (frame.event === 'ready') {
      this.sm.transition('ACTIVE')
      return { id, state: 'ACTIVE' }
    }
    // failed 或 exit（崩溃）→ FAILED（load 总返回、不抛出；平台进程不受影响）
    const reason = frame.event === 'failed' ? frame.error : `worker exited (code ${frame.code}) before ready`
    this.sm.transition('FAILED')
    return { id, state: 'FAILED', error: reason ?? 'unknown failure' }
  }

  async drive(_loaded: LoadedHandle, op: DriveOp): Promise<DriveResult> {
    this.sm.guard(['ACTIVE'], 'drive')
    const frame = await this.request(
      { op: 'drive', args: op.args },
      (f) => f.event === 'drive:result',
      this.spec.timeout ?? DEFAULT_TIMEOUT,
    )
    return frame.error ? { ok: false, error: frame.error } : { ok: true, value: frame.value }
  }

  async inspect(_loaded: LoadedHandle): Promise<Inspection> {
    this.sm.guard(['ACTIVE'], 'inspect')
    const frame = await this.request(
      { op: 'inspect' },
      (f) => f.event === 'inspect:result',
      this.spec.timeout ?? DEFAULT_TIMEOUT,
    )
    return { state: this.state, alive: this.childAlive && frame.alive === true, meta: { childPid: this.child?.pid } }
  }

  async dispose(_loaded: LoadedHandle): Promise<void> {
    if (this.sm.state === 'DISPOSED') return // 幂等：重复 dispose 为 no-op（load 仍不可重启）
    this.sm.guard(['ACTIVE', 'FAILED', 'LOADING', 'PENDING'], 'dispose')
    this.sm.transition('UNLOADING')

    const child = this.child
    if (child && this.childAlive) {
      child.stdin!.write('{"op":"dispose"}\n')
      await this.waitFrame(
        (f) => f.event === 'disposed' || f.event === 'exit',
        this.spec.timeout ?? DEFAULT_TIMEOUT,
      ).catch(() => undefined)
      if (this.childAlive) child.kill('SIGTERM')
      if (this.childAlive) {
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve())
          setTimeout(resolve, 500)
        })
      }
    }
    this.sm.transition('DISPOSED')
  }

  private request(msg: unknown, predicate: (f: Frame) => boolean, timeout: number): Promise<Frame> {
    if (!this.child?.stdin) throw new StateError('NO_CHILD', 'no live subprocess')
    const pending = this.waitFrame(predicate, timeout)
    this.child.stdin.write(JSON.stringify(msg) + '\n')
    return pending
  }

  private waitFrame(predicate: (f: Frame) => boolean, timeout: number): Promise<Frame> {
    return new Promise<Frame>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: () => {},
        timer: setTimeout(() => {}, 0),
      }
      const done = (f: Frame): void => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        clearTimeout(waiter.timer)
        resolve(f)
      }
      waiter.resolve = done
      waiter.timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new StateError('TIMEOUT', 'timeout waiting for worker frame'))
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
    // ACTIVE 后子进程意外退出（无等待者的异步失败）→ 状态机降为 FAILED
    if (frame.event === 'exit' && !this.childAlive && this.sm.state === 'ACTIVE') {
      this.sm.transition('FAILED')
    }
  }
}

export function createSubprocessAdapter(): SubprocessHostAdapter {
  return new SubprocessHostAdapter()
}