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

/**
 * 根插件（architecture.md §5.1 / development.md §2 假设 2）：
 * 对外是**单个插件**；对内用 `ctx.plugin(child)` 组装 9 个子插件，各自独立 fiber
 * 生命周期，并把每个子系统的核心 API 用 `ctx.provide` 注册为 Cordis 服务，
 * 下游（UI 面板 / 工具 / CLI）经 `ctx.inject('covenant.<name>')` 取用。
 *
 * `apply`/`name` 直接导出，供 `ctx.plugin(import('@dsh-covenant/app'))` 加载。
 */

export const name = 'dsh-covenant'

/** 9 个子系统的服务名（下游 ctx.inject 用）。 */
export const SERVICES = {
  assertion: 'covenant.assertion',
  'capability-probe': 'covenant.capability-probe',
  'dual-entry': 'covenant.dual-entry',
  'evidence-model': 'covenant.evidence-model',
  'host-adapter': 'covenant.host-adapter',
  'orchestrator-core': 'covenant.orchestrator-core',
  'suggester-human': 'covenant.suggester-human',
  'tool-spec': 'covenant.tool-spec',
  'worker-host-runtime': 'covenant.worker-host-runtime',
} as const

interface Subsystem {
  readonly id: string
  readonly service: string
  readonly module: Record<string, unknown>
}

/** 9 个子系统（真实现，不是 no-op 占位）。 */
const SUBSYSTEMS: readonly Subsystem[] = [
  { id: 'assertion', service: SERVICES.assertion, module: assertion as unknown as Record<string, unknown> },
  { id: 'capability-probe', service: SERVICES['capability-probe'], module: capabilityProbe as unknown as Record<string, unknown> },
  { id: 'dual-entry', service: SERVICES['dual-entry'], module: dualEntry as unknown as Record<string, unknown> },
  { id: 'evidence-model', service: SERVICES['evidence-model'], module: evidenceModel as unknown as Record<string, unknown> },
  { id: 'host-adapter', service: SERVICES['host-adapter'], module: hostAdapter as unknown as Record<string, unknown> },
  { id: 'orchestrator-core', service: SERVICES['orchestrator-core'], module: orchestratorCore as unknown as Record<string, unknown> },
  { id: 'suggester-human', service: SERVICES['suggester-human'], module: suggesterHuman as unknown as Record<string, unknown> },
  { id: 'tool-spec', service: SERVICES['tool-spec'], module: toolSpec as unknown as Record<string, unknown> },
  { id: 'worker-host-runtime', service: SERVICES['worker-host-runtime'], module: workerHostRuntime as unknown as Record<string, unknown> },
]

/** 供测试/下游直接取用的子系统模块引用（证明非占位）。 */
export const subsystems = {
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

export function createCovenant() {
  return {
    name,
    apply(ctx: Context): void {
      for (const sub of SUBSYSTEMS) {
        ctx.plugin({
          name: `covenant:${sub.id}`,
          apply(innerCtx: Context): void {
            // 每个子插件把自己的核心 API 注册成服务（provide 内部已挂钩 fiber 生命周期）
            innerCtx.provide(sub.service, sub.module)
          },
        })
      }
    },
  }
}

export const apply = (ctx: Context): void => createCovenant().apply(ctx)

export default { name, apply }