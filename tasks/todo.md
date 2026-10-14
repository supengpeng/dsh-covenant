# Task List: DSH 插件测试平台

> 规格真源：`development.md`。每任务验收答「建对了吗」，叠加全局 Definition of Done（测试过、可复现、证据入链）。

## Task 1: 仓库脚手架 + 根插件骨架 + cordis 契约台账

**Description:** 建 pnpm workspace、`app/`（根插件用 `ctx.plugin(child)` 组装）与 `packages/*` 空壳；对 DSH monorepo cordis 契约逐条核实（`ctx.effect/plugin/on/provide/inject/extend/isolate/intercept`、`ctx.tools.register`、Fiber 状态机），产出「契约台账」落库。

**Acceptance criteria:**
- [ ] `pnpm install && pnpm build` 通过，workspace 结构符合 `development.md` §3.2
- [ ] 根插件用 `ctx.plugin(child)` 组装至少一个无操作子插件并跑通 fiber 生命周期
- [ ] 「契约台账」覆盖 `docs/cordis-api/*` 关键 API 与 monorepo 源码面，逐条标注「已核实/待核实」

**Verification:**
- [ ] `pnpm build` 退出 0
- [ ] `node theory-envelope-check.mjs` 仍退出 0（未被本任务破坏）

**Dependencies:** None　**Files:** `package.json`、`pnpm-workspace.yaml`、`app/`、`packages/*/package.json`、`docs/contract-ledger.md`　**Scope:** M

---

## Task 2: evidence-model 证据链数据结构 + 内容寻址

**Description:** 实现 `EvidenceEntry` 与 `EvidenceChain`：append-only、Merkle 内容寻址 `root()`、`append()` 只追加。

**Acceptance criteria:**
- [ ] `append(entry)` 返回新链实例，不改旧链（不可逆改）
- [ ] `root()` 内容寻址：同序条目 byte 级同根，篡改任一条目根变化
- [ ] `EvidenceEntry` 含 `verdict/evidence/confidence/channel/prev/payload` 全字段

**Verification:**
- [ ] `pnpm test -- evidence-model` 通过；T3「篡改可检」反例测试通过

**Dependencies:** Task 1　**Files:** `packages/evidence-model/src/*`、`tests/evidence-model/*`　**Scope:** M

---

## Task 3: evidence-model 归一化 canon + verify（A9）

**Description:** 实现 `canon`（键序不敏感规范序列化）与 `verify()`（链完整性 + 签名校验）；入链载荷剔除运行期可变字段（时间戳/临时路径/耗时/未归一化原始证据串）。

**Acceptance criteria:**
- [ ] `canon` 对同一内容不同书写顺序产出同一字节串（键序不敏感）
- [ ] 载荷 `Payload` 不含任何运行期可变字段（A9）
- [ ] `verify()` 检出任意链条目篡改或签名失效

**Verification:**
- [ ] `pnpm test -- evidence-model`：canon 键序反例测试 + 重放 `root()` 一致测试通过

**Dependencies:** Task 2　**Files:** `packages/evidence-model/src/canon.ts`、`src/verify.ts`、`tests/evidence-model/*`　**Scope:** M

---

## Task 4: assertion 判定接口 + verdict + 证据字段（A10）

**Description:** 实现 `Assertion.judge(obs, expected, ctx) → VerdictRecord`：纯函数、`Verdict` 枚举、证据来源 + 可信级字段非空。

**Acceptance criteria:**
- [ ] `judge` 同输入同输出（A1 纯函数，无时间/随机/外部状态）
- [ ] `Verdict` 覆盖 `pass/fail/skip/error/inconclusive`，无隐式通过
- [ ] 每条 `VerdictRecord` 的 `evidence` 非空且可定位（A10）

**Verification:**
- [ ] `pnpm test -- assertion`：纯函数幂等测试 + 缺证据即判不合格测试通过

**Dependencies:** Task 1　**Files:** `packages/assertion/src/*`、`tests/assertion/*`　**Scope:** M

---

## Task 5: host-adapter 接口 + 子进程档参考实现（A7）

**Description:** 定义 `HostAdapter/HostHandle` 契约，实现子进程档（`spawn→load→drive→inspect→dispose`），Fiber 状态机驱动，`dispose` 后 `DISPOSED` 不可重启。

**Acceptance criteria:**
- [ ] `load→drive→inspect→dispose` 严格按 Fiber 状态机（PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED）
- [ ] 子进程崩溃/泄漏不拖垮平台进程
- [ ] `vm` 档显式标注「仅行为隔离，非安全边界」（A7），越界场景拒退

**Verification:**
- [ ] `pnpm test -- host-adapter`：状态机越界测试 + 子进程崩溃隔离测试通过

**Dependencies:** Task 1　**Files:** `packages/host-adapter/src/*`、`tests/host-adapter/*`　**Scope:** L（拆为两段：接口 + 子进程档）

---

### Checkpoint: M1 内核闭环
- [ ] 单插件跑通「探测→判定→入链→出报告」
- [ ] T3 篡改可检 + 同 B 重放一致实测通过
- [ ] **Review with human before proceeding**

---

## Task 6: capability-probe 三探头 + 四态（A2/T1）

**Description:** 实现三探头（宿主/环境/插件自述）→ 能力矩阵，四态 `present/absent/undetectable/claimed-unverified`；分档分层（宿主=缓存+指纹、环境=每次、自述=跟版本）。

**Acceptance criteria:**
- [ ] 四态语义正确：「探不到」不得报 `present`（A2）
- [ ] 能力缺失/未验证 ⇒ 下游判定打 `skip/inconclusive`，不产生假 pass/fail（T1）
- [ ] 环境探头带「每次测 + 轻量指纹」（A3）

**Verification:**
- [ ] `pnpm test -- capability-probe`：四态分割 + 无假判定反例测试通过

**Dependencies:** Task 5　**Files:** `packages/capability-probe/src/*`、`tests/capability-probe/*`　**Scope:** M

---

## Task 7: orchestrator-core 组合图 + valid(G)

**Description:** 实现 `CompositionGraph` 与 `valid(G)`：无环 + I/O 类型 + 隔离档约束；同档直连、跨档仅序列化桥。

**Acceptance criteria:**
- [ ] `valid(G)` 拒绝含环图（T2 前提）
- [ ] 类型不匹配、隔离档越界被拒绝
- [ ] 组合图节点确定性字段齐全（A8）

**Verification:**
- [ ] `pnpm test -- orchestrator-core`：含环/类型/隔离档三类拒绝测试通过

**Dependencies:** Task 2, 5, 6　**Files:** `packages/orchestrator-core/src/graph.ts`、`tests/orchestrator-core/*`　**Scope:** M

---

## Task 8: orchestrator-core 执行调度（拓序+分发+收集）

**Description:** 实现 `run(RunSpec)`：拓序 → 分发到宿主 → 收集判定 → 沉淀证据链；同规格+同种子 ⇒ 同执行计划。

**Acceptance criteria:**
- [ ] 同 RunSpec + 同 seed 产生逐字节相同执行计划（A8）
- [ ] 分发严格符合隔离档
- [ ] 判定收集按拓序入证据链，无遗漏

**Verification:**
- [ ] `pnpm test -- orchestrator-core`：确定性重放测试通过

**Dependencies:** Task 7　**Files:** `packages/orchestrator-core/src/scheduler.ts`　**Scope:** M

---

### Checkpoint: M2 编排与调度
- [ ] 组合图合法执行
- [ ] T1（无假判定）/ T2（确定性）实测通过
- [ ] **Review with human before proceeding**

---

## Task 9: worker-host-runtime 三档隔离 + 租约（A4）

**Description:** 实现三档隔离执行后端 + 租约；A4 信道清单（共享内存/模块级可变/文件/端口/网络/环境变量/缓存）须为空；同档并发各占独立实例。

**Acceptance criteria:**
- [ ] 跨档只经序列化消息桥，无写共享（A4）
- [ ] 同档并发实例互不干扰（引理 2.3 实测面）
- [ ] 租约 = 资源占位非权限，TTL 到期回收留痕（§15.6）

**Verification:**
- [ ] `pnpm test -- worker-host-runtime`：A4 信道逐一断言 + 并发交错测试 + 租约回收测试通过

**Dependencies:** Task 5　**Files:** `packages/worker-host-runtime/src/*`、`tests/worker-host-runtime/*`　**Scope:** L（拆：隔离 / 租约）

---

## Task 10: tool-spec 工具规范 + SDK/适配器

**Description:** 实现 `ToolManifest` 协议内核 + TS `TestTool` SDK 主路径 + 协议兜底适配器。

**Acceptance criteria:**
- [ ] manifest 字段齐全（id/version/io/isolationTier/deterministic/sideEffects/timeout/verdictSchema）
- [ ] 组合内核仅凭 manifest 即可做类型/隔离档静态校验
- [ ] SDK 主路径与协议适配器可互换（同一工具两种路径同结论）

**Verification:**
- [ ] `pnpm test -- tool-spec`：manifest 校验 + 双路径一致性测试通过

**Dependencies:** Task 7　**Files:** `packages/tool-spec/src/*`、`tests/tool-spec/*`　**Scope:** M

---

## Task 11: suggester-human 建议器 + 人工把关（A6）

**Description:** 实现规则引擎建议器（留 AI 插槽）+ 人工把关；候选必过 `valid(G)` + 人工确认才铸成规格；模型版本化可替换。

**Acceptance criteria:**
- [ ] 建议器输出标记「不受信」，未过 `valid(G)` 或未人工确认不可进入执行（A6）
- [ ] 运行时建议器不改变内核（类型层禁运行时注入）
- [ ] 模型替换走版本化 diff，旧版可回滚（§9 版本化替换 B）

**Verification:**
- [ ] `pnpm test -- suggester-human`：未确认候选被拒 + 模型回滚测试通过

**Dependencies:** Task 7　**Files:** `packages/suggester-human/src/*`、`tests/suggester-human/*`　**Scope:** M

---

### Checkpoint: M3 组合
- [ ] 候选→静态校验→人工确认→铸成规格全链
- [ ] A6 实测通过
- [ ] **Review with human before proceeding**

---

## Task 12: dual-entry 本地自检 + 市场门禁（T4）

**Description:** 实现本地自检与市场门禁两个入口，复用同一证据链与面孔；同规格同结论。

**Acceptance criteria:**
- [ ] 同一规格在双入口得到同结论（T4/D2）
- [ ] 市场门禁证据链不可篡改、可审计、可追责
- [ ] dry-run 可预测（§10）

**Verification:**
- [ ] `pnpm test -- dual-entry`：双入口一致性测试通过

**Dependencies:** Task 8, 10, 11　**Files:** `packages/dual-entry/src/*`、`tests/dual-entry/*`　**Scope:** M

---

### Checkpoint: M4 双入口
- [ ] 双入口同结论，T4 实测通过
- [ ] **Review with human before proceeding**

---

## Task 13: 判定·复核·终裁 + 可异议（§15.3）

**Description:** `assertion` 补「复核义务」与「终裁位」两角色；申诉口可触发 → 复核链 → 追加入证据链。

**Acceptance criteria:**
- [ ] 复核不一致 → 终裁裁决并 append-only 留痕（§15.3 终裁留痕）
- [ ] 每个 fail 可被异议，申诉入口可触发且处置入链可核（§15.3 可异议检测点三合取）
- [ ] 复核/终裁的「确认/推翻」事件写入证据链（为 Task 16 通道可信度供样本）

**Verification:**
- [ ] `pnpm test -- governance`：复核/终裁/申诉三路测试通过

**Dependencies:** Task 4, 8　**Files:** `packages/assertion/src/governance.ts`、`tests/governance/*`　**Scope:** M

---

## Task 14: 免闸留痕 + 单向性 + 冗余不可遗忘（T5）

**Description:** evidence-model / orchestrator-core 落地三不变量：免跑层/场景必带「谁判+命中判据」；面孔是权威链纯函数；双副本 + 不可遗忘类目只追加不删。

**Acceptance criteria:**
- [ ] 免跑记录「免跑依据」字段非空可对应判据（§15.3 免闸留痕）
- [ ] 面孔重算与已发风貌 byte 一致，拒绝反写（单向性）
- [ ] 不可遗忘类目写操作被拒（只 append）+ 双副本校验和可核（T5 无静默跳过）

**Verification:**
- [ ] `pnpm test -- governance`：免跑/单向/冗余三类反例测试 + T5 报告分割测试通过

**Dependencies:** Task 13　**Files:** `packages/evidence-model/src/faces.ts`、`packages/orchestrator-core/src/waiver.ts`　**Scope:** M

---

## Task 15: 递归截断 + 租约回收 + 学习闭环（§15.6）

**Description:** 落三机制：`inconclusive` 附深度计数（≤3 层）；租约占用→到期→回收状态机；断言规则被推翻→记录→修正→版本化→回链。

**Acceptance criteria:**
- [ ] 递归追溯深度超 3 层仍不确定 → `inconclusive` + 留痕停止（递归截断）
- [ ] 租约到期未回收 → 判 FAIL（租约回收）
- [ ] 断言规则失败→修正产生版本化记录并回链（学习闭环，追加不改历史）

**Verification:**
- [ ] `pnpm test -- governance`：三机制反例测试通过

**Dependencies:** Task 14　**Files:** `packages/assertion/src/recursion.ts`、`packages/worker-host-runtime/src/lease.ts`　**Scope:** M

---

## Task 16: 通道可信度 + 对抗集（§15.7 / F14 F17）

**Description:** 判定通道维护可信度（复核确认/终裁推翻为贝叶斯样本）；维护已知恶意/违规注入集，100% 检出，漏检即 FAIL。

**Acceptance criteria:**
- [ ] 可信级 = 静态证据分级 × 通道历史命中率两维合成写入 verdict（F14）
- [ ] 通道可信度可由证据链重算复核；零样本判「未验证」
- [ ] 对抗集（违规插件/伪造证据/越权/隔离逃逸）100% 检出，漏检即 FAIL（F17）

**Verification:**
- [ ] `pnpm test:adversarial` 全检出；可信度重算测试通过

**Dependencies:** Task 13, 15　**Files:** `packages/assertion/src/credibility.ts`、`tests/adversarial/*`　**Scope:** M

---

### Checkpoint: M5 治理面
- [ ] §15.3 五条不变量检测点可证伪
- [ ] T5 实测通过
- [ ] §6 十项治理机制各有实现点 + 检测点
- [ ] **Review with human before proceeding**

---

## Task 17: 机检 + 信封校验 + 对抗集全检出（收紧）

**Description:** 实现期内同步维护 `theory-model-check.mjs`（模型变化时）；确保 `theory-envelope-check.mjs` 常绿；对抗集纳入 CI 门禁。

**Acceptance criteria:**
- [ ] `node theory-envelope-check.mjs` 退出 0
- [ ] `node theory-model-check.mjs` 通过（形式自洽 + 变异全检出）
- [ ] T1–T5 各有至少一条实测证据写回证据链

**Verification:**
- [ ] `node theory-envelope-check.mjs`、`node theory-model-check.mjs`、`pnpm test`、`pnpm test:adversarial` 全绿

**Dependencies:** Task 16　**Files:** 机检/信封脚本、CI 配置　**Scope:** M

---

### Checkpoint: Complete
- [ ] `node theory-envelope-check.mjs` 退出 0
- [ ] `node theory-model-check.mjs` 通过
- [ ] T1–T5 实测证据写回证据链
- [ ] 十项治理机制无「有名无实」
- [ ] Ready for review