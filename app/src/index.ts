import type { Context } from '@deepseek-ai/cordis'
import * as assertion from '@dsh-covenant/assertion'
import * as capabilityProbe from '@dsh-covenant/capability-probe'
import * as dualEntry from '@dsh-covenant/dual-entry'
import * as evidenceModel from '@dsh-covenant/evidence-model'
import * as hostAdapter from '@dsh-covenant/host-adapter'
import * as orchestratorCore from '@dsh-covenant/orchestrator-core'
import * as suggesterHuman from '@dsh-covenant/suggester-human'
import * as toolSpec from '@dsh-covenant/tool-spec'
import * as workerHostRuntime from '@dsh-covenant/worker-host-runtime'

import { COVENANT_SERVICE, type CovenantServices } from './services.js'

/**
 * 根插件（architecture.md §5.1 / development.md §2 假设 2）：
 * 对外是**单个插件**，对内把 9 个子系统聚合成一个类型化服务 `ctx.covenant`。
 * 下游经 `ctx.covenant.<子系统>.<方法>`（或 `ctx.get('covenant')`）类型安全取用，
 * 类型来自 `services.ts` 的 `declare module` augmentation。
 *
 * `apply`/`name` 直接导出，供 `ctx.plugin(import('@dsh-covenant/app'))` 加载。
 */

export const name = 'dsh-covenant'

/** 9 个子系统聚合服务实例（类型化，与 `CovenantServices` 精确对应）。 */
const covenant: CovenantServices = {
  assertion,
  capabilityProbe,
  dualEntry,
  evidenceModel,
  hostAdapter,
  orchestratorCore,
  suggesterHuman,
  toolSpec,
  workerHostRuntime,
}

export { COVENANT_SERVICE }
export type { CovenantServices }
export { covenant }
/** 向后兼容别名：9 个子系统模块引用（与 covenant 一致）。 */
export const subsystems = covenant

export function createCovenant() {
  return {
    name,
    apply(ctx: Context): void {
      // 类型化服务：`covenant` 已被 augmentation 声明为 `Context['covenant']`，
      // 走 `provide` 的 keyof-this 重载，名称与值类型精确匹配。
      ctx.provide(COVENANT_SERVICE, covenant)
    },
  }
}

export const apply = (ctx: Context): void => createCovenant().apply(ctx)

export default { name, apply }