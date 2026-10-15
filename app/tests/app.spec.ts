import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { COVENANT_SERVICE, createCovenant, covenant, subsystems } from '../src/index.js'

describe('root plugin (app)：类型化聚合服务 ctx.covenant', () => {
  it('subsystems/covenant 引用 9 个真实现模块（非占位）', () => {
    expect(Object.keys(subsystems).length).toBe(9)
    expect(subsystems).toBe(covenant)
    for (const [, mod] of Object.entries(subsystems)) {
      expect(Object.keys(mod as object).length).toBeGreaterThan(0)
    }
  })

  it('加载根插件 → ctx.get(COVENANT_SERVICE) 取到聚合服务，与真模块一致', async () => {
    const root = new Context()
    const fiber = await root.plugin(createCovenant())
    expect(fiber.state).toBe(2) // FiberState.ACTIVE
    expect(fiber.name).toBe('dsh-covenant')

    const got = root.get(COVENANT_SERVICE)!
    expect(got).toBe(covenant)
    expect(got.assertion).toBe(subsystems.assertion)
    expect(got.orchestratorCore).toBe(subsystems.orchestratorCore)
    expect(got.hostAdapter).toBe(subsystems.hostAdapter)

    await root.fiber.dispose()
  })

  it('COVENANT_SERVICE 为聚合服务名 constant', () => {
    expect(COVENANT_SERVICE).toBe('covenant')
  })
})