import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  A7_DISCLAIMER,
  ContainerHostAdapter,
  createAdapter,
  HostStateMachine,
  RemoteHostAdapter,
  StateError,
  SubprocessHostAdapter,
  VmHostAdapter,
  type HostSpec,
} from '../src/index.js'

// 测试经根 `pnpm test` 运行，cwd 即仓库根
const fixtures = (...p: string[]): string => path.resolve(process.cwd(), 'packages/host-adapter/tests/fixtures', ...p)
const good = fixtures('good-plugin.mjs')
const goodCjs = fixtures('good-plugin.cjs')
const crash = fixtures('crash-plugin.mjs')
const throwsF = fixtures('throws-plugin.mjs')
const noisy = fixtures('noisy-plugin.mjs')

const SP = (timeout = 8000, extra: Partial<HostSpec> = {}): HostSpec => ({ tier: 'subprocess', timeout, ...extra })

describe('HostStateMachine（Fiber 状态机 / §15.8 硬契约）', () => {
  it('walks PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED', () => {
    const sm = new HostStateMachine()
    expect(sm.state).toBe('PENDING')
    sm.transition('LOADING')
    sm.transition('ACTIVE')
    sm.transition('UNLOADING')
    sm.transition('DISPOSED')
    expect(sm.state).toBe('DISPOSED')
  })

  it('rejects illegal transitions', () => {
    const sm = new HostStateMachine()
    expect(() => sm.transition('ACTIVE')).toThrow(StateError) // PENDING 不能直接 ACTIVE
    sm.transition('LOADING')
    sm.transition('ACTIVE')
    expect(() => sm.transition('LOADING')).toThrow(StateError) // ACTIVE 不可回退 LOADING
    expect(() => sm.transition('ACTIVE')).toThrow(StateError) // ACTIVE 自环非法
  })

  it('DISPOSED is terminal: no restart (§15.8)', () => {
    const sm = new HostStateMachine()
    sm.transition('LOADING')
    sm.transition('ACTIVE')
    sm.transition('UNLOADING')
    sm.transition('DISPOSED')
    expect(() => sm.transition('LOADING')).toThrow(/DISPOSED.*restart|disposed/i)
    expect(sm.state).toBe('DISPOSED')
  })
})

describe('SubprocessHostAdapter（子进程档，A4/A7 行为）', () => {
  it('load → drive → inspect → dispose 走通（ACTIVE 后 round-trip）', async () => {
    const handle = await new SubprocessHostAdapter().spawn(SP())
    const loaded = await handle.load({ module: good })
    expect(loaded.state).toBe('ACTIVE')
    expect(handle.state).toBe('ACTIVE')

    const drv = await handle.drive(loaded, { kind: 'ping', args: { foo: 1 } })
    expect(drv.ok).toBe(true)
    expect(drv.value).toEqual({ foo: 1 })

    const insp = await handle.inspect(loaded)
    expect(insp.alive).toBe(true)

    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
  })

  it('崩溃不拖垮平台：crash plugin → FAILED，平台进程继续', async () => {
    const handle = await new SubprocessHostAdapter().spawn(SP())
    const loaded = await handle.load({ module: crash })
    expect(loaded.state).toBe('FAILED')
    expect(handle.state).toBe('FAILED')
    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
    // 平台进程未崩溃的表现：本测试继续执行到断言
  })

  it('装载期抛错 → FAILED', async () => {
    const handle = await new SubprocessHostAdapter().spawn(SP())
    const loaded = await handle.load({ module: throwsF })
    expect(loaded.state).toBe('FAILED')
    expect(loaded.error).toContain('boom')
    await handle.dispose(loaded)
  })

  it('PUT stdout 被重定向、不污染控制信道', async () => {
    const handle = await new SubprocessHostAdapter().spawn(SP())
    const loaded = await handle.load({ module: noisy })
    expect(loaded.state).toBe('ACTIVE')
    const insp = await handle.inspect(loaded)
    expect(insp.alive).toBe(true)
    await handle.dispose(loaded)
  })

  it('越界拒退：drive 在 load 之前 → StateError', async () => {
    const handle = await new SubprocessHostAdapter().spawn(SP())
    await expect(handle.drive({ id: 'x', state: 'PENDING' }, { kind: 'x' })).rejects.toThrow(StateError)
  })

  it('越界拒退：load 之后再次 load → StateError', async () => {
    const handle = await new SubprocessHostAdapter().spawn(SP())
    const loaded = await handle.load({ module: good })
    await expect(handle.load({ module: good })).rejects.toThrow(StateError)
    await handle.dispose(loaded)
  })
})

describe('VmHostAdapter（vm 档，A7 行为隔离）', () => {
  it('load CJS 形态 PUT → ACTIVE 并 dispose', async () => {
    const handle = await new VmHostAdapter().spawn({ tier: 'vm' })
    const loaded = await handle.load({ module: goodCjs })
    expect(loaded.state).toBe('ACTIVE')
    const drv = await handle.drive(loaded, { kind: 'echo', args: [1, 2] })
    expect(drv.ok).toBe(true)
    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
  })

  it('A7 越界拒退：requireSecurityIsolation → StateError + 免责声明', async () => {
    const adapter = new VmHostAdapter()
    await expect(adapter.spawn({ tier: 'vm', requireSecurityIsolation: true })).rejects.toThrow(/A7|behavioral isolation|security/i)
    expect(A7_DISCLAIMER).toMatch(/NOT a security boundary/)
  })

  it('vm 档仅行为隔离：ESM 模块装载失败（不宣称安全隔离）', async () => {
    const handle = await new VmHostAdapter().spawn({ tier: 'vm' })
    const loaded = await handle.load({ module: good }) // ESM .mjs 在 vm.Script 不支持
    expect(loaded.state).toBe('FAILED')
    await handle.dispose(loaded)
  })
})

describe('registry（按档分发，§5.3）', () => {
  it('分发到正确的适配器（四档均已接入寄存器）', () => {
    expect(createAdapter({ tier: 'vm' })).toBeInstanceOf(VmHostAdapter)
    expect(createAdapter({ tier: 'subprocess' })).toBeInstanceOf(SubprocessHostAdapter)
    expect(createAdapter({ tier: 'container' })).toBeInstanceOf(ContainerHostAdapter)
    expect(createAdapter({ tier: 'remote' })).toBeInstanceOf(RemoteHostAdapter)
  })
})