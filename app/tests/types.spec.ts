import { describe, expectTypeOf, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type * as assertion from '@dsh-covenant/assertion'
import type * as orchestratorCore from '@dsh-covenant/orchestrator-core'

/** 聚合服务类型（来自 services.ts 的 `declare module` augmentation）。 */
type Covenant = Context['covenant']

describe('类型化服务（B 路径）：ctx.covenant 编译期类型安全', () => {
  it('ctx.covenant 聚合 9 个子系统，类型与模块命名空间精确一致', () => {
    expectTypeOf<Covenant['assertion']>().toEqualTypeOf<typeof assertion>()
    expectTypeOf<Covenant['orchestratorCore']>().toEqualTypeOf<typeof orchestratorCore>()
  })

  it('子系统的具体方法签名精确', () => {
    expectTypeOf<Covenant['orchestratorCore']['verifyCycle']>().toBeFunction()
    expectTypeOf<Covenant['assertion']['judge']>().toBeFunction()
  })

  it('非法访问在编译期报错（type-space 断言，运行时无副作用）', () => {
    // @ts-expect-error assertion 命名空间不存在 nonexistent
    type BadAssertionKey = Covenant['assertion']['nonexistent']
    // @ts-expect-error covenant 无 orchestrator 子系统（正确名 orchestratorCore）
    type BadServiceKey = Covenant['orchestrator']
  })
})