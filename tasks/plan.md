# Implementation Plan: DSH 插件测试平台

> 任务清单落在 [todo.md](./todo.md)。本文件是决策/风险/开放问题，任务是 todo.md 的检查表索引。
> 规格真源：`development.md`（模块规格）、`architecture.md`（架构）、`theory-proof.md`（A0–A10 / T1–T5）。

## Overview

把「验证其它 DSH 插件」的元插件按 `development.md` §0 的 9 模块与施工顺序实现出来；目标是让 theory-proof 的 T1–T5 结论落到可运行代码上，且每个模块有可证伪验收门。参考实现先做子进程档 + `vm` 档（容器/远端档列为后续里程碑）。

## Architecture Decisions

- **形态**：对外单根插件（`app/`），对内 9 个 Cordis 子插件 / package（`packages/*`），各自独立 fiber 生命周期与版本（architecture.md §5.1）。
- **契约真源**：实现前对 DSH monorepo 的 cordis 契约逐条核实（回执 §五.2 / theory-proof B2）。
- **内核优先**：`evidence-model → assertion → host-adapter → capability-probe → orchestrator-core → … → dual-entry`，依赖只指向内核（§7）。
- **确定性优先**：环境快照 `B`（版本矩阵/种子/顺序/调度）贯穿所有模块，A8/A9 在 M1 就落地（不进后期补丁）。
- **规格级、非代码**：本计划的任务只到「模块 + 验收门」粒度，接口签名以 `development.md` §5 的 `// spec（示意）` 为准。
- **任务粒度**：一律 S/M（1–5 文件），XL 直接拆。

## Task List（索引，详见 todo.md）

### Phase 1 — 内核闭环（M1）
- [ ] Task 1 仓库脚手架 + 根插件骨架
- [ ] Task 2 evidence-model 证据链数据结构 + 内容寻址
- [ ] Task 3 evidence-model 归一化 canon + verify（A9）
- [ ] Task 4 assertion 判定接口 + verdict + 证据字段（A10）
- [ ] Task 5 host-adapter 接口 + 子进程档参考实现（A7）

### Checkpoint: M1 内核闭环
- [ ] 单插件跑通「探测→判定→入链→出报告」
- [ ] T3 篡改可检 + 同 B 重放一致实测通过

### Phase 2 — 编排与调度（M2）
- [ ] Task 6 capability-probe 三探头 + 四态（A2/T1）
- [ ] Task 7 orchestrator-core 组合图 + valid(G)
- [ ] Task 8 orchestrator-core 执行调度（拓序+分发+收集）

### Checkpoint: M2 编排与调度
- [ ] 组合图合法执行，T1 / T2 实测通过

### Phase 3 — 组合子系统（M3）
- [ ] Task 9 worker-host-runtime 三档隔离 + 租约（A4）
- [ ] Task 10 tool-spec 工具规范 + SDK/适配器
- [ ] Task 11 suggester-human 建议器 + 人工把关（A6）

### Checkpoint: M3 组合
- [ ] 候选→静态校验→人工确认→铸成规格，A6 实测通过

### Phase 4 — 双入口（M4）
- [ ] Task 12 dual-entry 本地自检 + 市场门禁（T4）

### Checkpoint: M4 双入口
- [ ] 双入口同结论，T4 实测通过

### Phase 5 — 治理面收口（M5）
- [ ] Task 13 判定·复核·终裁 + 可异议（§15.3）
- [ ] Task 14 免闸留痕 + 单向性 + 冗余不可遗忘（T5）
- [ ] Task 15 递归截断 + 租约回收 + 学习闭环（§15.6）
- [ ] Task 16 通道可信度 + 对抗集（§15.7 / F14 F17）

### Checkpoint: M5 治理面
- [ ] §15.3 五条不变量检测点可证伪，T5 实测通过

### Phase 6 — 信封 + 对抗（M6）
- [ ] Task 17 机检 + 信封校验 + 对抗集全检出

### Checkpoint: Complete
- [ ] `node theory-envelope-check.mjs` 退出 0
- [ ] `node theory-model-check.mjs` 通过
- [ ] T1–T5 各有实测证据写回证据链
- [ ] §6 十项治理机制各有实现点 + 检测点，无「有名无实」

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| cordis 契约未逐行核实（B2） | High | Task 1 内先做「契约台账」，逐条对齐 monorepo 源码面 |
| `node:vm` 误当安全隔离（A7） | High | 子进程档先行；vm 档验收显式标注「仅行为隔离」+ 越界拒退测试 |
| 缓存/环境漂移漏判（B3/A3） | Med | A3「每次测 + 轻量指纹」在 capability-probe 落地 |
| `A9` 载荷归一化反例已存在 | Med | M1 即实现 canon 键序不敏感 + 剔可变字段，不后补 |
| 建议器运行时改内核（B4/A6） | Med | 类型层禁运行时注入；候选必须过 valid(G) + 人工确认 |
| 治理项「有名无实」复发 | Med | 每项治理机制固定「实现点 + 检测点」双列，无检测点不算完成 |

## Open Questions（不阻塞计划，M6 前需拍板）

1. 是否把 `development.md` 纳入 `theory-envelope-check.mjs` 的 §引用校验。
2. 容器/远端档：独立后续里程碑 vs 本次（默认：本次仅子进程 + vm）。
3. F17 对抗集的新变种周期与样本来源口径。
4. 工作文件（`gen_html.mjs` / `.archify` / `.review-findings-*`）入库或 `.gitignore`。