import {
  normalizeCapability,
  type CapabilityMatrix,
  type CapabilityState,
  type ProbeObservation,
} from '@dsh-covenant/assertion'

/**
 * 能力探测器（architecture.md §8.3 / development.md §5.5）。
 *
 * 三探头归一为一个能力矩阵（四态）：
 *  - 宿主能力：客观事实，缓存 + 版本指纹失效；
 *  - 环境能力：客观事实，每次测（A3 环境漂移）；
 *  - 插件自述：声明（decl），须实测通过才算「已验证」；探不到 → `claimed-unverified`。
 *
 * 归一函数 η（theory-proof 定义 1.1）由 @dsh-covenant/assertion 提供：
 *   present → 'present'；absent → 'absent'；failed ∧ ¬decl → 'undetectable'；failed ∧ decl → 'claimed-unverified'。
 * 因此「探不到」**永远不可能**报 `present`（A2 探头保真 / T1 无假判定）。
 */

export type ProbeKind = 'host' | 'environment'

export type ObservationMap = Readonly<Record<string, ProbeObservation>>

/** 单个能力条目的探测结果（审计证据）。 */
export interface ProbeResult {
  /** 决定性探头（客观观测来源）；两探头都未观测到则为 undefined。 */
  readonly probe?: ProbeKind
  readonly capability: string
  readonly verdict: CapabilityState
  /** 插件自述原文（仅当该能力被插件声明时存在）。 */
  readonly decl?: string
}

/** 三探头数据源（编排层用 host-adapter 的 inspect 供给宿主/环境观测；本模块只依赖接口）。 */
export interface ProbeSources {
  /** 轻量宿主指纹（版本矩阵/环境快照），用于缓存失效判断。 */
  hostFingerprint(): Promise<string>
  /** 完整宿主能力观测（较昂贵；缓存后仅在指纹失效时重跑）。 */
  hostObservations(): Promise<ObservationMap>
  /** 环境能力观测（每次测，不缓存）。 */
  environment(): Promise<ObservationMap>
}

/** 待测目标：能力全集 + 插件自述（能力名 → 自述原文）。 */
export interface ProbeTarget {
  readonly capabilities: readonly string[]
  readonly declared: Readonly<Record<string, string>>
}

export interface CapabilityProbe {
  probe(target: ProbeTarget): Promise<{ matrix: CapabilityMatrix; results: readonly ProbeResult[] }>
}

export class StandardCapabilityProbe implements CapabilityProbe {
  private hostCache: { fingerprint: string; observations: ObservationMap } | null = null

  constructor(private readonly sources: ProbeSources) {}

  async probe(target: ProbeTarget): Promise<{ matrix: CapabilityMatrix; results: readonly ProbeResult[] }> {
    // 宿主：缓存 + 指纹失效（§8.3「宿主=缓存+指纹」）
    const fingerprint = await this.sources.hostFingerprint()
    let hostObs: ObservationMap
    if (this.hostCache && this.hostCache.fingerprint === fingerprint) {
      hostObs = this.hostCache.observations
    } else {
      hostObs = await this.sources.hostObservations()
      this.hostCache = { fingerprint, observations: hostObs }
    }

    // 环境：每次测（§8.3「环境=每次测」/ A3）
    const envObs = await this.sources.environment()

    // 客观观测合并：env 兜底、host 权威（重叠时 host 覆盖）
    const objective: Record<string, ProbeObservation> = { ...envObs }
    for (const [k, v] of Object.entries(hostObs)) objective[k] = v

    const matrix: Record<string, CapabilityState> = {}
    const results: ProbeResult[] = []
    for (const cap of target.capabilities) {
      const obs = objective[cap] ?? 'failed'
      const decl = target.declared[cap]
      const state = normalizeCapability(obs, decl !== undefined)
      matrix[cap] = state
      results.push({
        probe: hostObs[cap] !== undefined ? 'host' : envObs[cap] !== undefined ? 'environment' : undefined,
        capability: cap,
        verdict: state,
        ...(decl !== undefined ? { decl } : {}),
      })
    }

    return { matrix, results }
  }
}

/** 单次无缓存探测（供一次性使用，不保留跨调用缓存）。 */
export async function probeOnce(
  sources: ProbeSources,
  target: ProbeTarget,
): Promise<{ matrix: CapabilityMatrix; results: readonly ProbeResult[] }> {
  return new StandardCapabilityProbe(sources).probe(target)
}