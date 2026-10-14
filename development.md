# DSH 插件测试平台 — 开发文档

> **状态**：规格稿（待评审）
> **派生自**：[architecture.md](./architecture.md)、[architecture.html](./architecture.html)、[theory-proof.md](./theory-proof.md)
> **性质**：本文档是「开发规格」，不是「实现记录」。所有接口均为 **TypeScript 示意契约**，非可编译代码；接口书写统一采用 `// spec（示意）` 标注。规格真源以 architecture.md 正文与 theory-proof.md 形式定义（`G`、`valid(G)`、`V`、`s` 等）为准，架构图只作可视化交叉参照。

---

## 0. 能力地图（模块 · 依赖 · 施工顺序）

9 个模块来自 [architecture.md §7](./architecture.md)，依赖方向单向、无环（「依赖只指向内核」）。

| 模块 id | 职责 | 依赖 | 对应 architecture.md |
|---|---|---|---|
| `orchestrator-core` | 声明式组合图解析 + 执行调度 | evidence-model、host-adapter、capability-probe | §7-1、§9.1 |
| `evidence-model` | 签名 JSON 证据链 + 面孔派生 | assertion（判定来源） | §7-8、§11 |
| `host-adapter` | 三档隔离宿主抽象（vm/子进程/容器） | worker-host-runtime | §7-2、§8.1 |
| `assertion` | 独立判：观测 → verdict + 证据 + 可信级 | — | §7-3、§8.2 |
| `capability-probe` | 三探头 → 能力矩阵（四态） | host-adapter | §7-4、§8.3 |
| `tool-spec` | 工具规范 + SDK 主路径 + 协议兜底 | — | §7-5 |
| `suggester-human` | 组合建议器（规则先行，留 AI 插槽）+ 人工把关 | orchestrator-core | §7-6、§9.2/§9.3 |
| `worker-host-runtime` | 三档执行环境、装载/驱动 PUT | host-adapter | §7-7、§5.3 |
| `dual-entry` | 本地自检 + 市场门禁（同规格同结论） | 全部内核 | §7-9、§10 |

**施工顺序**（依赖驱动，稳定内核优先）：

```
evidence-model → assertion → host-adapter → capability-probe
                            ↘
   orchestrator-core ← (evidence-model, host-adapter, capability-probe)
                            ↘
   worker-host-runtime → tool-spec → suggester-human → dual-entry
   （治理面 §15 是横切层，随各模块的行进逐项接入，见 §6）
```

---

## 1. 目标与成功标准

**目标**：把一个「验证其它 DSH 插件」的元插件，按 §5.1 形态（对外单插件、对内若干 Cordis 子插件 / package，各自独立 fiber 生命周期与版本）实现出来；实现后，theory-proof.md 的五条定理结论（T1–T5）能被真实代码复现，而不是停留在设计层。

**成功标准（可测，逐条见 §10）**：实现满足符合性义务 A0–A10（§4），并且平台跑起来后能通过 T1–T5 的验收（§7）。不是"能跑"，而是"跑出来的判定有据、可重放、可检篡改、可异议、无静默跳过"。

---

## 2. 假设与范围（先对齐，再动工）

以下假设均从架构/理论文档显式读出，非我杜撰；如有出入，停下改文档再动工：

1. 运行时是 **TypeScript + Node**，插件体系是 **Cordis**（`apply(ctx)` 形态；`ctx.effect/plugin/on/provide/inject/extend/isolate/intercept`；`ctx.tools.register`；Fiber 状态机 `PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED`，可 ↘`FAILED`）。
2. 根插件用 `ctx.plugin(child)` 组装内部 9 个子插件；每个子插件独立版本、独立证据。
3. **参考实现先做本地子进程档**（§8.1 决定），`vm` 档复用 `ctx.dynamicCordisRunner` / `ctx.cordisInspect` 行为面；容器/远端为后续档。
4. **建议器先规则引擎、留 AI 插槽**（§9.2 决定），运行时建议器不改内核（A6）。
5. theory-proof 是**半形式化**：不是 Coq/Lean 级机器可验证证明；机检脚本只证「形式定义内部自洽 + 错误模型被检出」。
6. 本规格关注**开发实现**，不新增设计决策；F14（通道可信度）、F17（对抗集）已在 §15.7 定型，本文档只落实现点。

---

## 3. 技术栈与实现前置

### 3.1 契约真源（先锁定）

- Cordis 插件契约真源：`docs/cordis-api/*`（由 `gen-cordis-catalog.ts` 自 `vendor/cordis/src/*` 生成）。**实现前对 DSH monorepo 源码面逐条核实**（这是 theory-proof B2 风险 + 回执"§五.2"唯一未决项）。
- 版本锁定：DSH / cordis 版本写死进 `theory-proof.md` 附录 C 锚定的版本（§15.5 版本锚定）。

### 3.2 目录结构（package 边界）

```
dsh-covenant/
├─ packages/
│  ├─ orchestrator-core/      # 编排内核
│  ├─ evidence-model/         # 结果与证据模型
│  ├─ host-adapter/           # 宿主适配器 SPI + 注册表
│  ├─ assertion/              # 断言 SPI
│  ├─ capability-probe/       # 能力探测器 SPI
│  ├─ tool-spec/              # 工具规范 + SDK + 适配器
│  ├─ suggester-human/        # 组合建议器 + 人工把关
│  ├─ worker-host-runtime/    # 隔离工作宿主运行时
│  └─ dual-entry/             # 对外双入口
├─ app/                       # 根插件（用 ctx.plugin 组装上述子插件）
├─ architecture.md / theory-proof.md / development.md
├─ theory-model-check.mjs / theory-envelope-check.mjs   # 机检 + 信封校验
└─ reviews/                   # 评审 + 回执
```

### 3.3 命令

```bash
# 机检（证明形式定义自洽 + 错误模型全检出）
node theory-model-check.mjs
# 信封校验（文件哈希 / 版本 / §引用一致）
node theory-envelope-check.mjs
# （实现期内补）构建 / 单测 / 集成 / 对抗集
pnpm build && pnpm test && pnpm test:adversarial
```

### 3.4 接口书写约定与代码风格

所有模块接口用 TS 示意，顶部标 `// spec（示意）`。示例（宿主适配器）：

```ts
// spec（示意，非编译代码）
export type IsolationTier = 'vm' | 'subprocess' | 'container';

export interface HostHandle {
  load(plugin: Put, ctx: HostCtx): Promise<LoadedHandle>;
  drive(loaded: LoadedHandle, op: DriveOp): Promise<DriveResult>;
  inspect(loaded: LoadedHandle): Promise<Inspection>;
  dispose(loaded: LoadedHandle): Promise<void>;   // 必须走到 DISPOSED，不可重启
}

export interface HostAdapter {
  readonly tier: IsolationTier;
  spawn(spec: HostSpec): Promise<HostHandle>;
}
```

命名：模块 id kebab-case（见 §0）；接口 `PascalCase`；判定相关类型统一 `Verdict`（`pass | fail | skip | error | inconclusive`）。

---

## 4. 符合性义务 A0–A10（编码纪律 / 边界）

theory-proof.md 的结论**只有实现满足 A1–A10 才成立**；A0 是「结论可传递到代码」的前置。下表把每个 A 转成本规格的**强制纪律**（Always 级）：

| 假设 | 性质 | 实现义务（必须做到） |
|---|---|---|
| **A0 符合性义务** | 义务性 | 逐条实现并自证满足 A1–A10；不满足则不得宣称继承理论结论 |
| **A1 判定纯函数·能力全域** | 设计约束 | `assertion.judge(obs, spec, ctx) → VerdictRecord` 必须是无时间/随机/外部状态的纯函数；能力矩阵 cover 必需能力域 |
| **A2 探头保真** | 脆 | `present/absent` 必须来自客观探测，不得把「探不到」报成 `present`；否则打 `skip` |
| **A3 环境可固定** | 脆 | 每次运行生成可复现环境快照 `B`（版本矩阵/种子/顺序/调度）；环境漂移用「能力每次测 + 轻量指纹」探测 |
| **A4 零共享可变状态** | 设计约束 | 平台与被测件、并发节点之间无可写共享；**信道清单须为空**（共享内存/模块级可变态/文件/端口/网络/环境变量/缓存）；同档并发各占独立宿主实例（§9） |
| **A5 密码学与规范化** | 标准假设+设计义务 | `H` 抗碰撞、签名不可伪造；`canon` 载荷域单射 + 键序不敏感 |
| **A6 建议器离线** | 流程约束 | 仅「离线更新 + 人工确认」的版本化模型进入内核；运行时建议器只读不改 |
| **A7 非对抗故障模型** | 范围限制 | `node:vm` 只当行为隔离用，**不得宣称安全隔离**；对抗场景必需子进程/容器档 |
| **A8 节点确定性** | 设计约束 | 组合图节点在固定 `B` 下是输入与 `B` 的确定性函数；随机全部由 `B` 种子驱动 |
| **A9 载荷归一化** | 设计义务 | 入链载荷 = `(判定, B)` 的确定性函数；时间戳/临时路径/耗时/未归一化原始证据串**不入载荷** |
| **A10 证据字段存在** | 设计义务 | 每条判定记录必带「证据来源 + 可信级」字段 |

**Boundaries（Ask first / Never）**：变更数据库 schema（Ask）；新增依赖（Ask）；提交密钥、改 vendor 目录、删失败测试（Never）；对 `FiberState` 增状态或允许 `DISPOSED` 重启（Never，§15.8 硬契约）。

---

## 5. 模块规格

> 每模块五段：**职责 / 公开接口 / 数据结构 / 不变式 / 验收门**。接口均 `// spec（示意）`。

### 5.1 `orchestrator-core` — 编排内核

- **职责**：解析声明式组合图 `G` → 校验 `valid(G)` → 拓序 → 分发到宿主执行 → 收集判定沉淀进证据链。是「什么才叫合法组合」与「到底执行了什么」的唯一真相源。
- **接口**：
  ```ts
  // spec（示意）
  interface Orchestrator {
    run(spec: RunSpec): Promise<EvidenceChain>;
  }
  interface RunSpec {
    matrix: Matrix;            // 插件×版本×环境×宿主适配器
    scenarios: Scenario[];     // 组合图节点实例
    seed: string;              // 驱动 A8 的确定性种子
  }
  ```
- **数据结构**：`CompositionGraph { nodes: NodeSpec[]; edges: Edge[] }`；`NodeSpec { ioType; isolationTier; deterministic }`；`valid(G)` 判无环 + 类型 + 隔离档。
- **不变式**：无环（T2 前提）；同种子同规格 ⇒ 同执行计划（A8）；只同档直连，跨档走序列化桥（§9）。
- **依赖**：`evidence-model`、`host-adapter`、`capability-probe`。
- **验收门**：`valid(G)` 对含环图拒绝；同规格+同种子产生逐字节相同的执行计划；分发严格符合隔离档。

### 5.2 `evidence-model` — 结果与证据模型

- **职责**：append-only、内容寻址、签名的证据链；自证据链纯函数派生出三种面孔（HTML/JUnit/TAP）。
- **接口**：
  ```ts
  // spec（示意）
  interface EvidenceChain {
    append(entry: EvidenceEntry): EvidenceChain;   // 只追加，不可逆改
    root(): Hash;                                   // 内容寻址根
    verify(): boolean;                              // 链完整性 + 签名校验
    render(face: 'html' | 'junit' | 'tap'): string; // 纯函数面孔
  }
  interface EvidenceEntry {
    verdict: Verdict;
    evidence: string;        // A10：证据来源非空
    confidence: Confidence;
    channel: string;         // 判定通道（§15.7 通道可信度样本源）
    prev: Hash;
    payload: Payload;        // A9：归一化载荷，不含运行期可变字段
  }
  ```
- **数据结构**：Merkle 式链 + 「本地 + 只读归档」双副本；不可遗忘类目（被推翻判定/覆盖缺口/免闸记录/终裁记录）只追加不删（§15.3）。
- **不变式**：append-only；面孔是权威链的纯函数、禁止反写；纠正靠追加（§15.3 单向性）。
- **依赖**：`assertion`（判定来源）。
- **验收门**：T3——篡改任意条目使 `verify()` 失败；同 `B` 重放 `root()` 逐字节一致（A9）；面孔重算与已发面孔一致。

### 5.3 `host-adapter` — 宿主适配器 SPI

- **职责**：把三档隔离（vm/子进程/容器）抽象为统一 `HostHandle`；配注册表按档分发。
- **接口**：见 §3.4 示例（`HostAdapter` / `HostHandle`）。
- **数据结构**：`HostSpec { tier; env; timeout; resourceBind }`（Luke含租约，见 §15.6 租约回收）。
- **不变式**：`load → drive → inspect → dispose` 严格走 Fiber 状态机；`dispose` 后 `DISPOSED` 不可重启（§15.8）；`vm` 档仅行为隔离（A7）。
- **依赖**：`worker-host-runtime`。
- **验收门**：子进程崩溃/泄漏不拖垮平台进程；`vm` 档隔离结论只适用于非对抗故障（A7 范围限制显式成文 + 测试覆盖越界即拒退）。

### 5.4 `assertion` — 断言 SPI

- **职责**：独立判，不是工具子类。把一次观测 + 期望 → `VerdictRecord`（verdict + 证据 + 可信级）。
- **接口**：
  ```ts
  // spec（示意）
  interface Assertion {
    judge(obs: Observation, expected: Spec, ctx: JudgeCtx): VerdictRecord;
  }
  interface VerdictRecord {
    verdict: Verdict;       // pass | fail | skip | error | inconclusive
    evidence: string;       // A10 非空
    confidence: Confidence;
    channel: string;        // 判定通道，供可信度更新
  }
  ```
- **数据结构**：`Observation`（探头归一化输出）；`Confidence`（单次判断内部一致性，区别于通道可信度 §15.7）。
- **不变式**：显式 `verdict` 枚举，无隐式「通过」（§4 判定精确）；`inconclusive` 附「限 3 层 + 停止猜测」（§15.6 递归截断）；每个 `fail` 可被异议（§15.3 可异议）。
- **依赖**：无（最内层）。
- **验收门**：A1 纯函数（同输入同输出）；A10 证据字段非空；每个 `fail` 及判据可被申诉方复现异议。

### 5.5 `capability-probe` — 能力探测器 SPI

- **职责**：三探头（宿主/环境/插件自述）→ 能力矩阵，四态：已探测存在 / 不存在 / 不可探测 / 仅声明未验证。分档分层：宿主=缓存+指纹、环境=每次、插件自述=跟版本。
- **接口**：
  ```ts
  // spec（示意）
  interface CapabilityProbe {
    probe(target: Target): CapabilityMatrix;
  }
  type CapabilityState = 'present' | 'absent' | 'undetectable' | 'claimed-unverified';
  interface CapabilityMatrix { [cap: string]: CapabilityState; }
  ```
- **数据结构**：`ProbeResult { probe: string; verdict: CapabilityState; decl?: string }`。
- **不变式**：能力缺失/未验证 ⇒ 判定打 `skip` 或 `inconclusive` 并附证据，绝不产生假 pass/fail（§8.3 / T1）。
- **依赖**：`host-adapter`。
- **验收门**：T1——能力四态构成分割，缺失/未验证能力不产生假判定；A2 探头保真（「探不到」不得报 `present`）。

### 5.6 `tool-spec` — 工具规范 + SDK + 适配器

- **职责**：定义工具 manifest + 协议内核；提供 TS `TestTool` SDK 作主路径、通用协议作兜底适配器。
- **接口**：
  ```ts
  // spec（示意）
  interface ToolManifest {
    id: string; version: string;
    io: IOType;              // I/O 类型，供组合图类型约束
    isolationTier: IsolationTier;
    deterministic: boolean;  // 供 A8
    sideEffects: SideEffect[];
    timeout: number;
    verdictSchema: Verdict;
  }
  ```
- **数据结构**：manifest 即协议内核；SDK 主路径 + 协议兜底两位一体。
- **不变式**：自描述完整到「组合内核无需理解工具内部」即可静态校验。
- **依赖**：无。
- **验收门**：每个工具 manifest 字段齐全；组合内核能仅凭 manifest 完成类型/隔离档校验。

### 5.7 `suggester-human` — 组合建议器 + 人工把关

- **职责**：建议器产出候选组合（规则引擎先行、留 AI 插槽），输出不受信；人工把关采纳/拒绝/修正。
- **接口**：
  ```ts
  // spec（示意）
  interface Suggester { suggest(catalog: ToolCatalog): Candidate[]; }  // 不受信输出
  interface HumanGateway { decide(candidate: Candidate): Decision; }  // 采纳/拒绝/修正
  ```
- **数据结构**：`Candidate { graph: CompositionGraph; rationale: string }`；`Decision` 记录作未来训练原料。
- **不变式**：候选必过内核 `valid(G)` + 人工确认才铸成规格（§9.2/§9.3）；A6 运行时建议器不改内核；模型版本化可替换（§9 版本化替换 B）。
- **依赖**：`orchestrator-core`。
- **验收门**：未经 `valid(G)` 或人工确认的候选无法进入执行；模型替换走版本化 diff、旧版可回滚。

### 5.8 `worker-host-runtime` — 隔离工作宿主运行时

- **职责**：三档执行环境，装载/驱动被测插件（PUT），隔离档感知；并发实例各自独立。
- **接口**：由 `host-adapter` 的 `HostHandle` 驱动（本模块是 `host-adapter` 的实现后端）。
- **数据结构**：`WorkerInstance { tier; lease: Lease; state: FiberState }`（租约见 §15.6）。
- **不变式**：A4——跨档只经序列化消息桥、禁止共享可变状态；同档并发各占独立实例（§9 同档并发隔离）；租约=资源占位非权限，TTL 到期回收（§15.6 租约回收）。
- **依赖**：`host-adapter`。
- **验收门**：A4 信道清单为空（对 6 类信道逐一断言无写路径）；多并发用例结果不受交错影响（引理 2.3 的实测面）。

### 5.9 `dual-entry` — 对外双入口

- **职责**：本地自检（单插件、交互式）与市场门禁（批量、多插件组合、周期扫描、可审计追责）。
- **接口**：
  ```ts
  // spec（示意）
  interface DualEntry {
    selfCheck(target: Target): Report;      // 本地
    gate(targets: Target[]): GateReport;    // 市场门禁
  }
  ```
- **数据结构**：`Report` 复用 `EvidenceChain` + 面孔（HTML 等）；`GateReport` 含不可篡改、可审计证据链。
- **不变式**：同规格同结论（D2 / T4）；dry-run 可预测；市场门禁结果可追责。
- **依赖**：全部内核。
- **验收门**：T4——同一规格在双入口得到同结论；门禁报告的判定可逐条追溯到证据链。

---

## 6. 治理面横切实现（architecture.md §15）

治理面不是第 10 个模块，而是横切层，各实现点随上表模块接入：

| 治理机制 | 实现点 | 接入模块 | 检测点（可证伪） |
|---|---|---|---|
| 判定·复核·终裁 | `assertion` 补「复核义务」+「终裁位」角色 | assertion / orchestrator-core | 复核/终裁路径可触发并留痕 |
| 可异议 | 申诉口 → 复核链 → 入证据链 | dual-entry（申诉方口径） | 申诉入口可触发、处置入链可核 |
| 免闸留痕 | 运行清单「免跑依据」字段 | orchestrator-core / evidence-model | 免跑层/场景必带「谁判 + 命中判据」 |
| 单向性 | 面孔是权威链纯函数 | evidence-model | 面孔重算一致、拒绝反写 |
| 冗余/不可遗忘 | 双副本 + 只追加类目 | evidence-model | 副本校验和、写操作被拒 |
| 递归截断 | verdict `inconclusive` 附深度计数（≤3） | assertion | 深度超限但未停 → FAIL |
| 租约回收 | 资源占位 + TTL + 回收留痕 | worker-host-runtime | 到期未回收 → FAIL |
| 学习闭环 | 断言规则被推翻→记录→修正→版本化→回链 | assertion / suggester-human | 失败→修正产生版本化记录 |
| 通道可信度 | 判定通道后缀命中率（复核确认/终裁推翻为样本） | assertion / evidence-model | 可由证据链重算；零样本判「未验证」 |
| 对抗集 | 已知恶意/违规注入 100% 检出 | orchestrator-core / dual-entry | 漏检即 FAIL（§15.7 / F17） |

---

## 7. 验收与门禁

### 7.1 定理复现（T1–T5 → 实现后必须成立的命题）

| 定理 | 命题 | 对应验收模块 |
|---|---|---|
| T1 | 能力四态构成分割，缺失/未验证能力不产生假判定 | capability-probe |
| T2 | 合法组合图执行与判定确定 | orchestrator-core |
| T3 | 证据链可检篡改，A9 下可重放 | evidence-model |
| T4 | 同规格双入口同结论 | dual-entry |
| T5 | 报告完整：无静默跳过 | evidence-model / orchestrator-core |

### 7.2 机检门禁（已有/待补）

- `theory-model-check.mjs`：证明形式定义内部自洽 + 9 变异体全检出（实现期若逻辑变化，同步维护模型）。
- `theory-envelope-check.mjs`：信封层哈希/版本/§引用一致（每次改 architecture.md / theory-proof.md 后必跑）。
- **待补**：`pnpm test`（各模块验收门转成单测/集成测试）；对抗集全检出（§15.7 F17）。

### 7.3 边界（theory-proof §0.1 证明强度）

机检**不能**证明 M 正确，只能证「形式定义自洽 + 错误模型被检出」；T4 与引理 2.3 无独立机检；实现性质（性能/安全/通用/扩展）非理论证明目标。开发时不得把「机检通过」误宣传为「实现正确」。

---

## 8. 里程碑与分阶段

| 阶段 | 交付切片 | 通过判据 |
|---|---|---|
| M1 内核闭环 | evidence-model + assertion + host-adapter（子进程档） | 能单插件跑通「探测→判定→入链→出报告」，T3 实测 |
| M2 编排与调度 | orchestrator-core + capability-probe | 组合图合法执行，T1/T2 实测 |
| M3 组合子系统 | worker-host-runtime + tool-spec + suggester-human | 候选→静态校验→人工确认→铸成规格，A6 实测 |
| M4 双入口 | dual-entry | 本地 + 门禁同结论，T4 实测 |
| M5 治理面收口 | §15 十项机制接入 | §15.3 检测点可证伪，T5 实测 |
| M6 信封+对抗 | 机检、信封校验、对抗集 | `node theory-envelope-check.mjs` 通过；对抗集 100% 检出 |

每阶段结束前：跑机检 + 信封校验 + 该阶段验收门，产出证据链留档。

---

## 9. 风险与待核项（收编 architecture.md §14）

1. `node:vm` 非安全边界（A7）：对抗场景只能子进程/容器，不得偷懒降档。
2. `cordis-host-runner` 等契约未逐行核实（B2）：实现前对 monorepo 源码面逐条对齐（回执 §五.2）。
3. 缓存漏判（B3/风险 3）：A3 环境漂移需「每次测 + 指纹」兜底。
4. 建议器离线（B4/风险 4）：运行时改内核的路径必须在类型层被禁。
5. `A9` 载荷归一化：反例已存在，实现顺序上把 `canon` 键序不敏感 + 载荷剔除可变字段做进证据模型第一阶段。

---

## 10. 成功标准（可测）

- [ ] `node theory-envelope-check.mjs` 退出码 0（信封层自洽）。
- [ ] `node theory-model-check.mjs` 通过（形式自洽 + 变异全检出）。
- [ ] 每个模块的「验收门」（§5.x）有对应单测/集成测试，且全绿。
- [ ] T1–T5 在实现后各有至少一条实测证据，并写回证据链。
- [ ] §15.3 五条不变量的「检测点」各有可构造必失败的反例测试。
- [ ] 治理面十项机制（§6）各项有实现点 + 检测点，无「有名无实」。

---

## 11. 开放问题（需拍板）

1. 是否把 `development.md` 纳入 `theory-envelope-check.mjs` 的 §引用校验（本轮未做，因它不改变架构/理论哈希链）。
2. 容器/远端档（§8.1 的后续档）是否纳入 M1–M6，还是作为后续独立里程碑（本规格默认排除，仅子进程 + vm 档）。
3. F17 对抗集的「新变种周期」频率与对抗样本来源，需在 M6 定具体口径。
4. `gen_html.mjs` / `.archify` / `.review-findings-*` 等工作文件是否入库或加 `.gitignore`（当前保持不入库）。