import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createCovenant, DEFAULT_CHILDREN, type ChildPlugin } from '../src/index.js'

describe('root plugin (app)', () => {
  it('assembles exactly nine child sub-plugins (development.md §0 能力地图)', () => {
    expect(DEFAULT_CHILDREN.length).toBe(9)
    expect(DEFAULT_CHILDREN.map((c) => c.name).sort()).toEqual([
      'covenant:assertion',
      'covenant:capability-probe',
      'covenant:dual-entry',
      'covenant:evidence-model',
      'covenant:host-adapter',
      'covenant:orchestrator-core',
      'covenant:suggester-human',
      'covenant:tool-spec',
      'covenant:worker-host-runtime',
    ])
  })

  it('runs a child fiber lifecycle: load ⇔ ACTIVE, dispose ⇔ disposer runs', async () => {
    const events: string[] = []
    const child: ChildPlugin = {
      name: 'probe-child',
      apply(ctx: Context) {
        ctx.effect(() => {
          events.push('child:loaded')
          return () => events.push('child:disposed')
        })
      },
    }

    const root = new Context()
    const fiber = await root.plugin(createCovenant([child]))

    expect(events).toContain('child:loaded')
    // FiberState.ACTIVE == 2（const enum 运行时被擦除，故用数值 + 注释，见 docs/contract-ledger.md §2）
    expect(fiber.state).toBe(2)

    await root.fiber.dispose()
    expect(events).toContain('child:disposed')
  })

  it('loads the full default covenant to ACTIVE', async () => {
    const root = new Context()
    const fiber = await root.plugin(createCovenant())
    expect(fiber.state).toBe(2) // FiberState.ACTIVE
    expect(fiber.name).toBe('dsh-covenant')
    await root.fiber.dispose()
  })
})