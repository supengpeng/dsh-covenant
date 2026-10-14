import { describe, expect, it } from 'vitest'
import {
  assertNoSharedChannels,
  isExpired,
  issueLease,
  recycleLease,
  WorkerHostRuntime,
  type ResourceBindings,
} from '../src/index.js'

describe('assertNoSharedChannels（A4 信道清单须为空）', () => {
  it('returns empty for disjoint bindings', () => {
    const a: ResourceBindings = { file: '/tmp/a', port: 1111, cache: 'ca' }
    const b: ResourceBindings = { file: '/tmp/b', port: 2222, cache: 'cb' }
    expect(assertNoSharedChannels(a, b)).toEqual([])
  })

  it('detects every shared channel', () => {
    const sharedObj = {}
    const a: ResourceBindings = { sharedMemory: sharedObj, moduleState: sharedObj, file: '/f', port: 1, network: 'n', env: { K: 'v' }, cache: 'c' }
    const b: ResourceBindings = { sharedMemory: sharedObj, moduleState: sharedObj, file: '/f', port: 1, network: 'n', env: { K: 'v' }, cache: 'c' }
    expect([...assertNoSharedChannels(a, b)].sort()).toEqual(['cache', 'env', 'file', 'module-state', 'network', 'port', 'shared-memory'])
  })
})

describe('Lease（§15.6 租约 = 资源占位非权限，TTL 到期回收留痕）', () => {
  it('expires at TTL and recycle 留痕（不可变）', () => {
    const l = issueLease('tok', 'subprocess', 1000, 0)
    expect(isExpired(l, 999)).toBe(false)
    expect(isExpired(l, 1000)).toBe(true)

    const recycled = recycleLease(l, 1000)
    expect(recycled.state).toBe('recycled')
    expect(recycled.history).toEqual(['issued@0', 'recycled@1000'])
    expect(l.state).toBe('held') // 原对象未改动（不可变）
  })
})

describe('WorkerHostRuntime（三档执行环境 / 同档并发独立实例 / 租约回收）', () => {
  it('同档并发各占独立实例与独立租约', () => {
    const rt = new WorkerHostRuntime(() => 0)
    const i1 = rt.acquire('subprocess')
    const i2 = rt.acquire('subprocess')
    expect(i1.id).not.toBe(i2.id)
    expect(i1.lease!.token).not.toBe(i2.lease!.token)
    expect(assertNoSharedChannels(i1.bindings, i2.bindings)).toEqual([])
  })

  it('TTL 到期回收留痕，回收后 expiredUnrecycled 归零', () => {
    let now = 0
    const rt = new WorkerHostRuntime(() => now)
    const i = rt.acquire('subprocess', { ttlMs: 1000 })
    expect(rt.expiredUnrecycled()).toBe(0)
    now = 1001
    expect(rt.expiredUnrecycled()).toBe(1) // 到期未回收
    const recycled = rt.recycleExpired()
    expect(recycled.length).toBe(1)
    expect(i.lease!.state).toBe('recycled')
    expect(rt.expiredUnrecycled()).toBe(0)
  })

  it('并发交错不改变结果（引理 2.3 实测面）', async () => {
    const rt = new WorkerHostRuntime(() => 0)
    const i1 = rt.acquire('subprocess')
    const i2 = rt.acquire('subprocess')
    const work = async (id: string): Promise<{ id: string; len: number }> => ({ id, len: id.length })
    const sequential = [await work(i1.id), await work(i2.id)]
    const concurrent = await Promise.all([work(i1.id), work(i2.id)])
    expect(concurrent).toEqual(sequential)
  })
})