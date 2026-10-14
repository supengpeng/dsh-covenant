import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { RemoteHostAdapter } from '../src/index.js'

const fixtures = (...p: string[]): string => path.resolve(process.cwd(), 'packages/host-adapter/tests/fixtures', ...p)
const good = fixtures('good-plugin.mjs')
const crash = fixtures('crash-plugin.mjs')

/** 可连通的 ssh 目标（本环境 localhost 已配置 root 免密）。 */
const TARGET = process.env.DSH_COVENANT_REMOTE_TARGET ?? 'localhost'

function sshAvailable(): boolean {
  try {
    execSync(`ssh -o BatchMode=yes -o ConnectTimeout=4 -o StrictHostKeyChecking=no ${TARGET} "echo ok"`, {
      stdio: 'ignore',
      timeout: 8000,
    })
    return true
  } catch {
    return false
  }
}

const SSH = sshAvailable()

/** 远程残留的 dsh-covenant 临时目录（dispose 应清理）。 */
function leftoverRemoteDirs(): string {
  try {
    return execSync(
      `ssh -o BatchMode=yes -o StrictHostKeyChecking=no ${TARGET} "ls -d /tmp/dsh-covenant-remote-* 2>/dev/null"`,
      { encoding: 'utf8', timeout: 8000 },
    ).trim()
  } catch {
    return ''
  }
}

async function waitRemoteCleaned(timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (leftoverRemoteDirs() === '') return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return leftoverRemoteDirs() === ''
}

describe('RemoteHostAdapter（真实 ssh 远程档，§5.3 端到端）', () => {
  it('真实远程主机：load → drive → inspect → dispose 走通', async () => {
    const handle = await new RemoteHostAdapter({ target: TARGET }).spawn({ tier: 'remote', timeout: 30000 })
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

  it('崩溃隔离：远程主机上插件崩溃 → FAILED，平台进程不受影响', async () => {
    const handle = await new RemoteHostAdapter({ target: TARGET }).spawn({ tier: 'remote', timeout: 30000 })
    const loaded = await handle.load({ module: crash })
    expect(loaded.state).toBe('FAILED')
    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
  })

  it('远程档满足安全隔离（requireSecurityIsolation 不拒退）', async () => {
    const handle = await new RemoteHostAdapter({ target: TARGET }).spawn({ tier: 'remote', requireSecurityIsolation: true, timeout: 30000 })
    const loaded = await handle.load({ module: good })
    expect(loaded.state).toBe('ACTIVE')
    await handle.dispose(loaded)
  })

  it('dispose 后远程临时目录被清理（无残留）', async () => {
    const handle = await new RemoteHostAdapter({ target: TARGET }).spawn({ tier: 'remote', timeout: 30000 })
    const loaded = await handle.load({ module: good })
    await handle.dispose(loaded)
    expect(await waitRemoteCleaned()).toBe(true)
  })
})

// 无 ssh 后端时真实远端路径显式 SKIP（不伪装通过）；门控与容器档一致。
if (!SSH) {
  describe('RemoteHostAdapter（skipped）', () => {
    it.skip(`无可用 ssh 目标 ${TARGET}：真实远端集成验证 NOT_RUN`, () => {})
  })
}

describe('远端档无后端降级（不依赖真实 ssh）', () => {
  it('ssh/scp 不可用 → 干净 FAILED（不抛到平台）', async () => {
    const handle = await new RemoteHostAdapter({ ssh: '/nonexistent/ssh', scp: '/nonexistent/scp' }).spawn({
      tier: 'remote',
      timeout: 8000,
    })
    const loaded = await handle.load({ module: good })
    expect(loaded.state).toBe('FAILED')
    expect(loaded.error).toMatch(/module upload failed|spawn error|unavailable/i)
    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
  })
})