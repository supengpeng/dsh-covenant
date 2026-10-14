import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { ContainerHostAdapter } from '../src/index.js'

const fixtures = (...p: string[]): string => path.resolve(process.cwd(), 'packages/host-adapter/tests/fixtures', ...p)
const good = fixtures('good-plugin.mjs')
const crash = fixtures('crash-plugin.mjs')

/** docker 后端可用性（测试跳过/运行判定；不可用时真实容器路径显式 SKIP，不算失败）。 */
function dockerAvailable(): boolean {
  try {
    execSync('docker version', { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

const DOCKER = dockerAvailable()

/** 残留的 dsh-covenant 容器（--rm 应自动清空）。 */
function leftoverContainers(): string {
  try {
    return execSync('docker ps -aq --filter label=dsh-covenant=true', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function waitCleaned(timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (leftoverContainers() === '') return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return leftoverContainers() === ''
}

describe.skipIf(!DOCKER)('ContainerHostAdapter（真实 docker 容器档，§5.3 端到端）', () => {
  it('真实容器：load → drive → inspect → dispose 走通', async () => {
    const handle = await new ContainerHostAdapter().spawn({ tier: 'container', timeout: 30000 })
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

  it('崩溃隔离：容器内插件崩溃 → FAILED，平台进程不受影响', async () => {
    const handle = await new ContainerHostAdapter().spawn({ tier: 'container', timeout: 30000 })
    const loaded = await handle.load({ module: crash })
    expect(loaded.state).toBe('FAILED')
    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
  })

  it('container 档满足安全隔离（requireSecurityIsolation 不拒退，区别于 vm A7）', async () => {
    const handle = await new ContainerHostAdapter().spawn({ tier: 'container', requireSecurityIsolation: true, timeout: 30000 })
    const loaded = await handle.load({ module: good })
    expect(loaded.state).toBe('ACTIVE')
    await handle.dispose(loaded)
  })

  it('dispose 后容器被清理（--rm 生效，无残留）', async () => {
    const handle = await new ContainerHostAdapter().spawn({ tier: 'container', timeout: 30000 })
    const loaded = await handle.load({ module: good })
    await handle.dispose(loaded)
    expect(await waitCleaned()).toBe(true)
  })
})

describe('container 档无后端降级（不依赖真实 docker）', () => {
  it('docker 不可用 → 干净 FAILED（不抛到平台）', async () => {
    const handle = await new ContainerHostAdapter({ docker: '/nonexistent/docker' }).spawn({ tier: 'container', timeout: 8000 })
    const loaded = await handle.load({ module: good })
    expect(loaded.state).toBe('FAILED')
    expect(loaded.error).toMatch(/runtime unavailable|ENOENT/i)
    await handle.dispose(loaded)
    expect(handle.state).toBe('DISPOSED')
  })
})