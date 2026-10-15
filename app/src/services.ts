import type * as assertion from '@dsh-covenant/assertion'
import type * as capabilityProbe from '@dsh-covenant/capability-probe'
import type * as dualEntry from '@dsh-covenant/dual-entry'
import type * as evidenceModel from '@dsh-covenant/evidence-model'
import type * as hostAdapter from '@dsh-covenant/host-adapter'
import type * as orchestratorCore from '@dsh-covenant/orchestrator-core'
import type * as suggesterHuman from '@dsh-covenant/suggester-human'
import type * as toolSpec from '@dsh-covenant/tool-spec'
import type * as workerHostRuntime from '@dsh-covenant/worker-host-runtime'

/**
 * 类型化服务契约（B 路径）：
 * 把 9 个子系统的**模块命名空间类型**聚合成一个 `CovenantServices`，
 * 经 `declare module` 把 `covenant` 注入 Cordis `Context` 类型，
 * 使下游能在编译期类型安全地 `ctx.covenant.<子系统>.<方法>` inject。
 */

/** 9 个子系统的类型化句柄（聚合服务 `ctx.covenant`）。 */
export interface CovenantServices {
  readonly assertion: typeof assertion
  readonly capabilityProbe: typeof capabilityProbe
  readonly dualEntry: typeof dualEntry
  readonly evidenceModel: typeof evidenceModel
  readonly hostAdapter: typeof hostAdapter
  readonly orchestratorCore: typeof orchestratorCore
  readonly suggesterHuman: typeof suggesterHuman
  readonly toolSpec: typeof toolSpec
  readonly workerHostRuntime: typeof workerHostRuntime
}

/** 聚合服务的服务名（`ctx.get(COVENANT_SERVICE)` / `ctx.covenant`）。 */
export const COVENANT_SERVICE = 'covenant' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * DSH 插件测试平台（元插件）聚合服务：9 个子系统的类型化句柄。
     * 下游 `ctx.covenant.assertion`、`ctx.covenant.orchestratorCore` 等直接类型安全调用，
     * 亦可用 `ctx.get('covenant')` 取得运行时实例。包路径见 {@link CovenantServices}。
     */
    covenant: CovenantServices
  }
}