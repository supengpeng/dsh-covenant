# Cordis 契约台账（Contract Ledger）

> **对应**：`tasks/todo.md` Task 1「cordis 契约台账」；`development.md` §3.1；theory-proof B2 / 评审回执 §五.2。
> **核实口径**：对 DSH monorepo 源码面逐条核实。路径以 `/root/deepseek-harness/`（DSH 源码检出）为根。
> **状态**：`已核实`（有源码/生成文档证据）· `待核实`（需后续任务在具体使用点补证）。
> **生成日期**：2026-10-14。

## 0. 版本锚定（§15.5 版本锚定）

| 工件 | 版本 | 说明 |
|---|---|---|
| vendored cordis（生产） | `@deepseek-ai/cordis@4.0.5-alpha.1` | `vendor/cordis/package.json`；DSH 运行时实际加载 |
| npm cordis（本仓库开发锚） | `@deepseek-ai/cordis@4.0.4` | 本仓库 `app` 用其做本地 fiber 生命周期测试（npm 已发布稳定版） |
| 生成 API 目录 | `docs/cordis-api/*` | `scripts/gen-cordis-catalog.ts` 自 `vendor/cordis/src/*` 生成 |

> 差异注记：vendored 为 `4.0.5-alpha.1`，npm 稳定版为 `4.0.4`。本台账以 **vendored 源码面** 为准记录契约（生产真源），开发期用 `4.0.4` 做行为复现；`FiberState` / `ctx.plugin` / `ctx.effect` 等本平台依赖的 API 面在两者间一致。

## 1. 上下文与生命周期（cordis core，`vendor/cordis/src/*`）

| # | API | 契约要点 | 源码证据 | 状态 |
|---|---|---|---|---|
| C1 | `ctx.effect(execute, label?)` | 注册绑定当前 fiber 的清理感知副作用；`execute` 立即执行；返回 disposer，反序回收；fiber 已处置抛 `CordisError('INACTIVE_EFFECT')` | `vendor/cordis/src/fiber.ts:415`；`docs/cordis-api/fiber.md` | 已核实 |
| C2 | `ctx.plugin(plugin, ...args)` | 装载插件，返回 `Fiber & PromiseLike<Fiber>` | `vendor/cordis/src/registry.ts`（`docs/cordis-api/registry.md:35`） | 已核实 |
| C3 | `ctx.inject(deps, callback)` | `ctx.plugin({ inject, apply: callback })` 简写；依赖变化时卸载并重跑 callback | `vendor/cordis/src/registry.ts`（`docs/cordis-api/registry.md:8`） | 已核实 |
| C4 | `ctx.on(name, listener)` / `ctx.once` | 注册事件监听（disposable） | `vendor/cordis/src/events.ts:34`；`docs/cordis-api/inherited.md` | 已核实 |
| C5 | `ctx.emit/parallel/serial/bail/waterfall` | 事件派发五态（sync/awaited/first-bail/short-circuit chain） | `vendor/cordis/src/events.ts:34` | 已核实 |
| C6 | `ctx.get(name, strict?)` / `ctx.set` / `ctx.provide` / `ctx.accessor` / `ctx.mixin` | 服务存储读写与绑定 | `vendor/cordis/src/reflect.ts`（`docs/cordis-api/context.md` 服务存储节） | 已核实 |
| C7 | `ctx.extend(meta?)` | 派生子上下文，原型继承，父不被改动 | `vendor/cordis/src/context.ts:99` | 已核实 |
| C8 | `ctx.isolate(name, label?)` | 为 `name` 建独立服务作用域 | `vendor/cordis/src/context.ts:121` | 已核实 |
| C9 | `ctx.intercept(name, config)` | 为子插件合并服务拦截配置 | `vendor/cordis/src/context.ts:139` | 已核实 |
| C10 | `ctx.root / fiber / registry / reflect / events / logger` | 环境句柄 | `vendor/cordis/src/context.ts:16-32` | 已核实 |
| C11 | `ctx.timer`（+ interval/timeout/throttle/debounce） | 一次性定时器助手 | `vendor/timer/src/index.ts` | 已核实 |
| C12 | `ctx.loader` | 引导应用的配置 Loader | `vendor/loader/src/index.ts` | 已核实 |

## 2. Fiber 状态机（§15.8 硬契约）

- **枚举**：`FiberState = { PENDING=0, LOADING=1, ACTIVE=2, FAILED=3, DISPOSED=4, UNLOADING=5 }`
  - 声明：`vendor/cordis/src/fiber.ts:147-155`（`export const enum FiberState`）。
  - 语义：`PENDING` 等服务，`LOADING` 回调执行中，`ACTIVE` 已装载提供服务，`FAILED` 回调/配置抛错，`UNLOADING` disposer 回收中，`DISPOSED` 已处置。
  - **const enum**：运行时被擦除（编译产物为数字字面量，如 `2 /* FiberState.ACTIVE */`，见 `vendor/cordis/lib/types/fiber.js`）；跨模块按 `FiberState.XXX` 使用需在编译期内联，故本平台测试用数字常量 + 行内注释，不跨包 import 该 const enum。
- **迁移**：`internal/status` 事件随 `fiber.state` 变化派发（`fiber.ts:582-589`，仅在 ACTIVE↔非 ACTIVE 之间通知）。
- **`fiber.await()`** 等生命周期收口：`fiber.ts:704`（await）、`fiber.ts:718`（restart）、`fiber.ts:736`（update）。
- **与 development.md §2 假设一致**：`PENDING→LOADING→ACTIVE→(UNLOADING)→DISPOSED`，可 ↘`FAILED`。**已核实**。
- **§15.8 硬契约**（不可增状态 / `DISPOSED` 不可重启）：由 `dispose()` 后 `assertActive()` 抛 `INACTIVE_EFFECT` 保证。已核实面：`vendor/cordis/src/fiber.ts:351-353`。

## 3. 内部事件（cordis core + loader/hmr/timer）

`internal/plugin`、`internal/status`、`internal/service`、`internal/update`、`internal/config`、`internal/get`、`internal/set`、`internal/listener`、`internal/dispatch`、`exit`、`loader/config-update`、`loader/entry-init`、`loader/partial-dispose`、`loader/patch-context`、`loader/volatile-update`。

来源：`docs/cordis-api/inherited.md`（生成自 `vendor/cordis/src/events.ts:331-351` 与 `vendor/loader/src/index.ts`）。**已核实**。

## 4. Harness 层扩展（超出 cordis core，供后续任务使用点补证）

| # | API | 契约要点 | 源码证据 | 状态 |
|---|---|---|---|---|
| H1 | `ctx.tools`（ToolRuntime） | 工具注册/注销；`tools/change` 事件；`tools/execute` 等拦截 waterfall | `packages/core/tools/src/index.ts` | 待核实（Task 6/工具桥接时逐条） |
| H2 | `ctx.cordisInspect`（Inspect Provider） | `.list()` / `.query()` / `.register(provider)` | `packages/extensions/tool-cordis/src/index.ts`、`host.ts` | 待核实 |
| H3 | Client `dynamicCordisRunner` / `remote.dynamicCordisRunner` | 动态客户端半部的 host 侧桥（invoke/getClientCode/runHostHalf…） | `packages/extensions/cordis-client-runner/src/client/index.ts` | 待核实（`vm` 档行为面复用，§2 假设 3） |

## 5. 结论

- `development.md` §2 假设 1 所列 `ctx.effect/plugin/on/provide/inject/extend/isolate/intercept` 与 Fiber 状态机，均已在 vendored 源码面逐条核实（C1–C12、§2）。
- `ctx.tools.register` 在 cordis core 中不存在——它是 **harness 层** `tools` 服务（H1），非 cordis 内核 API；实现工具注册面时须以 H1 的 ToolRuntime 契约为准，不得臆造。
- 评审回执 §五.2 的唯一未决项（"契约真源主张未核实"）至此闭合：`docs/cordis-api/* ← gen-cordis-catalog.ts ← vendor/cordis/src/*` 的生成链已在 vendor 源码面证实。