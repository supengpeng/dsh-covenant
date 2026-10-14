import { describe, expect, it } from 'vitest'
import type { ProbeObservation } from '@dsh-covenant/assertion'
import { StandardCapabilityProbe, type ProbeSources, type ProbeTarget, type ObservationMap } from '../src/index.js'

function harness(opts?: { hostObs?: ObservationMap; envObs?: ObservationMap }) {
  const state = {
    fingerprint: 'fp-v1',
    hostObs: opts?.hostObs ?? ({ net: 'present', gpu: 'absent' } as ObservationMap),
    envObs: opts?.envObs ?? ({ net: 'present', gpu: 'failed' } as ObservationMap),
    hostCalls: 0,
    envCalls: 0,
    fingerprintCalls: 0,
  }
  const sources: ProbeSources = {
    async hostFingerprint(): Promise<string> {
      state.fingerprintCalls += 1
      return state.fingerprint
    },
    async hostObservations(): Promise<ObservationMap> {
      state.hostCalls += 1
      return state.hostObs
    },
    async environment(): Promise<ObservationMap> {
      state.envCalls += 1
      return state.envObs
    },
  }
  return { sources, state }
}

describe('capability-probe（三探头 → 四态能力矩阵，T1 / A2 / A3）', () => {
  it('四态构成分割：present/absent/undetectable/claimed-unverified 各归其位', async () => {
    const { sources } = harness({
      hostObs: { a: 'present', b: 'absent' },
      envObs: { c: 'failed', d: 'failed' },
    })
    const target: ProbeTarget = {
      capabilities: ['a', 'b', 'c', 'd'],
      declared: { c: 'supports c' },
    }
    const { matrix, results } = await new StandardCapabilityProbe(sources).probe(target)
    expect(matrix.a).toBe('present')
    expect(matrix.b).toBe('absent')
    expect(matrix.c).toBe('claimed-unverified')
    expect(matrix.d).toBe('undetectable')
    // 四态恰好构成分割（不重不漏）
    expect(new Set(results.map((r) => r.verdict)).size).toBe(4)
    expect(results.length).toBe(4)
  })

  it('A2 探头保真：探不到（failed）永远不报 present', async () => {
    const { sources } = harness({
      hostObs: { x: 'failed' },
      envObs: { y: 'failed' },
    })
    const target: ProbeTarget = { capabilities: ['x', 'y'], declared: { x: 'declared-only' } }
    const { matrix } = await new StandardCapabilityProbe(sources).probe(target)
    expect(matrix.x).toBe('claimed-unverified')
    expect(matrix.y).toBe('undetectable')
    for (const v of Object.values(matrix)) expect(v).not.toBe('present')
  })

  it('宿主能力缓存 + 版本指纹失效（§8.3「宿主=缓存+指纹」）', async () => {
    const { sources, state } = harness()
    const probe = new StandardCapabilityProbe(sources)
    const target: ProbeTarget = { capabilities: ['net', 'gpu'], declared: {} }
    await probe.probe(target)
    await probe.probe(target)
    // 指纹未变 → 复用缓存，hostObservations 仅一次
    expect(state.hostCalls).toBe(1)
    state.fingerprint = 'fp-v2'
    await probe.probe(target)
    // 指纹变化 → 缓存失效，重跑宿主观测
    expect(state.hostCalls).toBe(2)
  })

  it('环境能力每次测（§8.3「环境=每次测」/ A3 漂移探测）', async () => {
    const { sources, state } = harness()
    const probe = new StandardCapabilityProbe(sources)
    const target: ProbeTarget = { capabilities: ['net', 'gpu'], declared: {} }
    await probe.probe(target)
    await probe.probe(target)
    expect(state.envCalls).toBe(2)
    expect(state.hostCalls).toBe(1) // 宿主仍走缓存
  })

  it('probe result 携带决定性探头与自述原文（审计证据）', async () => {
    const { sources } = harness({
      hostObs: { a: 'present', b: 'absent' },
      envObs: { e: 'present' },
    })
    const target: ProbeTarget = {
      capabilities: ['a', 'b', 'e', 'z'],
      declared: { z: 'self-declared z' },
    }
    const { results } = await new StandardCapabilityProbe(sources).probe(target)
    const byCap = Object.fromEntries(results.map((r) => [r.capability, r]))
    expect(byCap['a']!.probe).toBe('host')
    expect(byCap['b']!.probe).toBe('host')
    expect(byCap['e']!.probe).toBe('environment')
    expect(byCap['z']!.probe).toBeUndefined() // 未观测，仅自述 → claimed-unverified
    expect(byCap['z']!.verdict).toBe('claimed-unverified')
    expect(byCap['z']!.decl).toBe('self-declared z')
  })
})