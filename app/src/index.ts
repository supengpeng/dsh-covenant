import type { Context } from '@deepseek-ai/cordis'

/**
 * 根插件（architecture.md §5.1 / development.md §2 假设 2）：
 * 对外单插件，对内用 `ctx.plugin(child)` 组装 9 个子插件，
 * 每个子插件独立 fiber 生命周期与版本。
 *
 * `name` 与 `apply` 直接导出，供 `ctx.plugin(import('@dsh-covenant/app'))` 加载；
 * `createCovenant(children)` 提供可注入子插件能力的装配工厂（测试/复用）。
 */

export const name = 'dsh-covenant'

export interface ChildPlugin {
  readonly name: string
  readonly apply: (ctx: Context) => void | Promise<void>
}

/** 9 个子插件的无操作占位（后续任务逐项填充，见 development.md §0 能力地图）。 */
export const DEFAULT_CHILDREN: readonly ChildPlugin[] = [
  { name: 'covenant:assertion', apply: () => {} },
  { name: 'covenant:evidence-model', apply: () => {} },
  { name: 'covenant:worker-host-runtime', apply: () => {} },
  { name: 'covenant:host-adapter', apply: () => {} },
  { name: 'covenant:capability-probe', apply: () => {} },
  { name: 'covenant:orchestrator-core', apply: () => {} },
  { name: 'covenant:tool-spec', apply: () => {} },
  { name: 'covenant:suggester-human', apply: () => {} },
  { name: 'covenant:dual-entry', apply: () => {} },
]

export function createCovenant(children: readonly ChildPlugin[] = DEFAULT_CHILDREN) {
  return {
    name,
    async apply(ctx: Context): Promise<void> {
      // 装载子插件并等待各自 fiber 就绪：保证根 ACTIVE ⇔ 全部子插件已装载（M1 可观测性约定）。
      // 子插件仍是独立 fiber（独立状态/版本），此处只是装配时等待其就绪。
      for (const child of children) {
        await ctx.plugin(child)
      }
    },
  }
}

export const apply = (ctx: Context): Promise<void> => createCovenant().apply(ctx)

export default { name, apply }