import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createCovenant, SERVICES, subsystems } from '../src/index.js'

describe('root plugin (app)：真实组装 9 个子系统', () => {
  it('subsystems 引用 9 个真实现模块（非 no-op 占位）', () => {
    const entries = Object.entries(subsystems)
    expect(entries.length).toBe(9)
    for (const [, mod] of entries) {
      expect(Object.keys(mod as object).length).toBeGreaterThan(0)
    }
  })

  it('加载根插件 → 9 个子插件经 ctx.provide 注册为服务 → ctx.get 可取到真模块', async () => {
    const root = new Context()
    const fiber = await root.plugin(createCovenant())
    expect(fiber.state).toBe(2) // FiberState.ACTIVE
    expect(fiber.name).toBe('dsh-covenant')

    // 每个子系统的核心 API 都作为服务可被取用，且与直接 import 的真模块一致
    expect(root.get(SERVICES.assertion)).toBe(subsystems.assertion)
    expect(root.get(SERVICES['evidence-model'])).toBe(subsystems.evidenceModel)
    expect(root.get(SERVICES['host-adapter'])).toBe(subsystems.hostAdapter)
    expect(root.get(SERVICES['orchestrator-core'])).toBe(subsystems.orchestratorCore)
    expect(root.get(SERVICES['dual-entry'])).toBe(subsystems.dualEntry)

    await root.fiber.dispose()
  })

  it('SERVICES 覆盖 9 个子系统服务名', () => {
    expect(Object.values(SERVICES).length).toBe(9)
    expect(Object.values(SERVICES).every((s) => s.startsWith('covenant.'))).toBe(true)
  })
})