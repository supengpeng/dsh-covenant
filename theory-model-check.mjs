#!/usr/bin/env node
// theory-model-check.mjs — 可执行模型自检（对 architecture.md 的抽象形式模型 M）
//
// 诚实边界（必读）：
//   * 本脚本检查的是本文"形式化定义"的自洽性、双实现一致性与若干必要性反例；
//     它 **不读取 architecture.md 文本**，也 **不是 M 的实现**。
//   * 每部分都标注类别：
//       definitional = 定义自洽复核（有反证子检查才算有齿，否则不能单独当证据）
//       teeth        = 含"错误模型必须被检出"的反证
//       partial      = 部分方向有齿、部分方向由构造保证
//   * 引理 2.3（并发可交换）本身 **无机检**：无实现可测并发语义；P2 只给出
//     "违反 A4 时会怎样"的必要性反例，并在输出中显式如此标注。
//
// 全域确定性：无网络、无时间、无随机源（伪随机用固定种子 LCG）。
// 用法：node theory-model-check.mjs   （通过退出码 0，失败退出码 1）
import { createHash } from 'node:crypto'

const sha = (s) => createHash('sha256').update(s).digest('hex')
let cases = 0
const fails = []
const parts = []

function part(name, kind, fn) {
  cases = 0
  const before = fails.length
  fn()
  parts.push({ name, kind, cases, failed: fails.length - before })
  if (fails.length > before) throw new Error(`part failed: ${name}`)
}
function assert(cond, msg) {
  cases++
  if (!cond) fails.push(msg)
}
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s / 4294967296
  }
}
function shuffle(arr, seed) {
  const r = lcg(seed)
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ══ P1 能力四态与判定纪律（architecture.md §8.3 / §4 判定精确·最小信任）══
// 类别：definitional + teeth（含错误模型必须被检出的反证）
const CAP = ['VERIFIED_PRESENT', 'VERIFIED_ABSENT', 'UNDETECTABLE', 'DECLARED_ONLY']

function capState(probe, declared) {
  if (probe === 'present') return 'VERIFIED_PRESENT'
  if (probe === 'absent') return 'VERIFIED_ABSENT'
  return declared ? 'DECLARED_ONLY' : 'UNDETECTABLE'
}
// 违反「最小信任」的错误实现：插件自述优先
function wrongCapState(probe, declared) {
  if (declared) return 'VERIFIED_PRESENT'
  return capState(probe, declared)
}
function minimalTrustOk(probe, declared, state) {
  return state !== 'VERIFIED_PRESENT' || probe === 'present'
}
// ρ 的分支守卫表（与 case 实现相互独立，用于检查守卫是否分割输入空间）
const GUARDS = [
  (x) => x.err === true,
  (x) => x.err === false && x.states.includes('VERIFIED_ABSENT'),
  (x) => x.err === false && x.states.some((s) => s === 'UNDETECTABLE' || s === 'DECLARED_ONLY'),
  (x) => x.err === false && x.states.every((s) => s === 'VERIFIED_PRESENT'),
]
const GUARD_VERDICT = ['error', 'skip', 'inconclusive', 'compare']

function guardHits(x, guards = GUARDS) {
  const hits = []
  guards.forEach((g, i) => {
    if (g(x)) hits.push(i)
  })
  return hits
}
function verdictFor(states, err, outcome) {
  if (err) return 'error'
  if (states.includes('VERIFIED_ABSENT')) return 'skip'
  if (states.some((s) => s === 'UNDETECTABLE' || s === 'DECLARED_ONLY')) return 'inconclusive'
  return outcome === 'ok' ? 'pass' : 'fail'
}
// 违反「无假判定」的错误实现：把「仅声明未验证」当成已存在
function wrongVerdictFor(states, err, outcome) {
  return verdictFor(
    states.map((s) => (s === 'DECLARED_ONLY' ? 'VERIFIED_PRESENT' : s)),
    err,
    outcome,
  )
}
function noFalseVerdict(states, err, v) {
  return !(v === 'pass' || v === 'fail') || (err === false && states.every((s) => s === 'VERIFIED_PRESENT'))
}
function subsets(arr) {
  const out = []
  for (let m = 0; m < 2 ** arr.length; m++) out.push(arr.filter((_, i) => (m >> i) & 1))
  return out
}

function p1() {
  // 1a 四态映射全域（6 组合）且像类恰为四态
  const combos = []
  for (const probe of ['present', 'absent', 'failed'])
    for (const declared of [true, false]) combos.push([probe, declared])
  for (const [p, d] of combos) assert(CAP.includes(capState(p, d)), `非四态输出: ${p}/${d}`)
  assert(new Set(combos.map(([p, d]) => capState(p, d))).size === 4, '四态像类应为 4')
  // 1b 最小信任：真实实现通过，错误实现必须被检出（teeth）
  for (const [p, d] of combos)
    assert(minimalTrustOk(p, d, capState(p, d)), `最小信任被真实实现违反: ${p}/${d}`)
  assert(
    combos.some(([p, d]) => !minimalTrustOk(p, d, wrongCapState(p, d))),
    '最小信任检查无齿: 错误实现未被检出',
  )
  // 1c 守卫链穷尽性 + 首选命中语义：ρ 是"按序取首个命中"的优先链，不是互斥分割
  const allStates = subsets(CAP)
  for (const err of [false, true])
    for (const states of allStates) {
      const x = { err, states }
      const hits = guardHits(x)
      assert(hits.length >= 1, `守卫链非穷尽（该输入无任何分支）: ${err}/${states.join('+') || '∅'}`)
      const first = GUARD_VERDICT[hits[0]]
      const v = verdictFor(states, err, 'ok')
      assert(first === 'compare' ? v === 'pass' || v === 'fail' : first === v, `首选守卫与判定实现不一致: ${err}/${states.join('+') || '∅'} → ${v}`)
    }
  // 优先级是显式选择（architecture.md 未规定 A 与 U/D 并存时的先后）：
  // 断言"已探测不存在"先于"不可探测/仅声明"，即取 skip 而非 inconclusive
  assert(verdictFor(['VERIFIED_ABSENT', 'UNDETECTABLE'], false, 'ok') === 'skip', '优先级约定: A 应先于 U/D')
  assert(verdictFor(['VERIFIED_ABSENT', 'DECLARED_ONLY'], false, 'ok') === 'skip', '优先级约定: A 应先于 D')
  // 1d 守卫链有齿：留空（非穷尽）必须被检出
  const gap = GUARDS.map((g, i) =>
    i === 2 ? (x) => x.err === false && x.states.includes('UNDETECTABLE') : g,
  )
  assert(
    allStates.some((st) => guardHits({ err: false, states: st }, gap).length === 0),
    '守卫留空未被检出（穷尽性检查无齿）',
  )
  // 1e 守卫链有齿：错误优先级（把 U/D 提到 A 之前）必须被检出
  const swappedGuards = [GUARDS[0], GUARDS[2], GUARDS[1], GUARDS[3]]
  const swappedVerdicts = ['error', 'inconclusive', 'skip', 'compare']
  const mixed = { err: false, states: ['VERIFIED_ABSENT', 'UNDETECTABLE'] }
  const firstOf = (x, guards, verdicts) => verdicts[guardHits(x, guards)[0]]
  assert(firstOf(mixed, GUARDS, GUARD_VERDICT) === 'skip', '正确优先级应取 skip')
  assert(firstOf(mixed, swappedGuards, swappedVerdicts) !== 'skip', '错误优先级未被检出（首选命中检查无齿）')
  // 1f 无假判定：真实实现通过，把「仅声明未验证」当已存在的实现必须被检出（teeth）
  for (const err of [false, true])
    for (const states of allStates)
      for (const o of ['ok', 'violated'])
        assert(noFalseVerdict(states, err, verdictFor(states, err, o)), `假判定（真实实现）: ${err}/${states.join('+') || '∅'}/${o}`)
  assert(
    allStates.some((s) => !noFalseVerdict(s, false, wrongVerdictFor(s, false, 'ok'))),
    '无假判定检查无齿: DECLARED_ONLY 被当成 PRESENT 未被检出',
  )
}

// ══ P2 组合子系统（architecture.md §9.1 / §9 末 / §4 组合可验证·确定性优先）══
// 类别：partial（无环判定与规范序为双实现一致检查；隔离档/类型为反例检查；
//             引理 2.3 本身无机检，只给"违反 A4 会怎样"的必要性反例）
const NODES = [
  { id: 'n1', tier: 'vm', out: 'obs', in: null },
  { id: 'n2', tier: 'proc', out: 'judge', in: 'obs' },
  { id: 'n3', tier: 'container', out: 'report', in: 'judge' },
  // n4 的 out === in：使 n4 的自环**只能因成环**被拒（类型与隔离档均不构成理由），
  // 从而让"自环必须被无环规则拒绝"这一断言真正可失败（见 2d 与变异体 M7）
  { id: 'n4', tier: 'vm', out: 'judge', in: 'judge' },
]
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]))
const IDS = NODES.map((n) => n.id)

// 独立实现 #1：Kahn + 字典序 tie-break（规范序）
function canonicalOrder(ids, edges) {
  const indeg = new Map(ids.map((n) => [n, 0]))
  const adj = new Map(ids.map((n) => [n, []]))
  for (const e of edges) {
    adj.get(e.from).push(e.to)
    indeg.set(e.to, indeg.get(e.to) + 1)
  }
  const ready = ids.filter((n) => indeg.get(n) === 0).sort()
  const out = []
  while (ready.length) {
    const n = ready.shift()
    out.push(n)
    for (const m of adj.get(n)) {
      indeg.set(m, indeg.get(m) - 1)
      if (indeg.get(m) === 0) {
        ready.push(m)
        ready.sort()
      }
    }
  }
  return { order: out, acyclic: out.length === ids.length }
}
// 独立实现 #2：三色 DFS 环检测（与 Kahn 完全不同的算法，用于交叉验证）
// 同时返回访问节点数，供"节点覆盖数"独立交叉核对（不再用 x===x 的自比较）
function hasCycleDFS(ids, edges) {
  const adj = new Map(ids.map((i) => [i, []]))
  for (const e of edges) adj.get(e.from).push(e.to)
  const color = new Map(ids.map((i) => [i, 0])) // 0=白 1=灰 2=黑
  let cyclic = false
  let visited = 0
  const dfs = (u) => {
    color.set(u, 1)
    visited++
    for (const v of adj.get(u)) {
      if (color.get(v) === 1) {
        cyclic = true
        return
      }
      if (color.get(v) === 0) {
        dfs(v)
        if (cyclic) return
      }
    }
    color.set(u, 2)
  }
  for (const i of ids) {
    if (color.get(i) === 0) {
      dfs(i)
      if (cyclic) break
    }
  }
  return { cyclic, visited }
}
// 定义 2.1 的独立求值（实现 A）：读 NODES 表
function validByDefinition(ids, edges) {
  const noCycle = !hasCycleDFS(ids, edges).cyclic
  const isolationOk = edges.every((e) => byId[e.from].tier === byId[e.to].tier || e.bridge === true)
  const typeOk = edges.every((e) => byId[e.from].out === byId[e.to].in)
  return { valid: noCycle && isolationOk && typeOk, noCycle, isolationOk, typeOk }
}
// 独立求值（实现 B）：从"规格字符串"另行解析一张节点表，再用 DFS 判环。
// 与实现 A 相比：节点表来源与构造路径不同（隔离档/类型两个合取项是独立实现的）；
// 环判定两者共用 hasCycleDFS，故环判定另有 Kahn-vs-DFS 交叉核对（P2 2a）。
const SPEC = 'n1:vm:obs:-;n2:proc:judge:obs;n3:container:report:judge;n4:vm:judge:judge'
const SPECN = Object.fromEntries(
  SPEC.split(';').map((s) => {
    const [id, tier, out, inn] = s.split(':')
    return [id, { id, tier, out, in: inn === '-' ? null : inn }]
  }),
)
function validIndependent(ids, edges) {
  const noCycle = !hasCycleDFS(ids, edges).cyclic
  const isolationOk = edges.every((e) => SPECN[e.from].tier === SPECN[e.to].tier || e.bridge === true)
  const typeOk = edges.every((e) => SPECN[e.from].out === SPECN[e.to].in)
  return noCycle && isolationOk && typeOk
}
function graphValid(ids, edges) {
  const { order, acyclic } = canonicalOrder(ids, edges)
  const d = validByDefinition(ids, edges)
  return { order, acyclic, ...d }
}
// 键序无关的规范序列化：canon 必须对"同一对象的不同构造方式"给出同一字节串，
// 否则 T3(2)（判定一致 ⇒ root 相等）会被构造顺序破坏。
function stableCanon(v) {
  if (Array.isArray(v)) return '[' + v.map(stableCanon).join(',') + ']'
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableCanon(v[k]))
        .join(',') +
      '}'
    )
  return JSON.stringify(v)
}
// 纯节点执行器：节点值 = H(入边值 ‖ id ‖ 种子)；作为"确定性节点"的具体模型
function runPure(ids, edges, seed) {
  const { order } = canonicalOrder(ids, edges)
  const value = new Map()
  for (const n of order) {
    const ins = edges
      .filter((e) => e.to === n)
      .map((e) => value.get(e.from))
      .sort()
    value.set(n, sha(ins.join('|') + '#' + n + '#' + seed))
  }
  return order.map((n) => value.get(n))
}

function p2() {
  // 2a 全 12 条有向边的 2^12 子图：Kahn 与 DFS 两种环检测必须一致
  // 前置：两张节点表（NODES 与 SPECN）必须描述同一设计事实，否则"双实现"无意义
  for (const n of NODES)
    assert(
      SPECN[n.id] && SPECN[n.id].tier === n.tier && SPECN[n.id].out === n.out && SPECN[n.id].in === n.in,
      `规格表与节点表不一致: ${n.id}`,
    )
  const dirPool = []
  // 含自环：全部 16 条有序对（4 节点 × 4，含 4 条自环）⇒ 自环的无环规则也被枚举到
  for (const u of IDS) for (const v of IDS) dirPool.push({ from: u, to: v })
  let acyclicCount = 0
  let cyclicCount = 0
  let selfLoopMasks = 0
  for (let mask = 0; mask < 2 ** dirPool.length; mask++) {
    const edges = dirPool
      .filter((_, k) => (mask >> k) & 1)
      .map((e) => ({ ...e, bridge: byId[e.from].tier !== byId[e.to].tier }))
    if (edges.some((e) => e.from === e.to)) selfLoopMasks++
    const { order, acyclic } = canonicalOrder(IDS, edges)
    const dfs = hasCycleDFS(IDS, edges)
    assert(acyclic === !dfs.cyclic, `Kahn 与 DFS 环判定不一致: ${mask}`)
    // 注：不再断言 dfs.visited === 节点数 —— 该等式在无环时由算法定义直接蕴含（空真），
    // 真正有齿的跨实现比较是上一行的"环判定一致"（变异体 M2/M7 均在此失败）。
    if (!acyclic) {
      cyclicCount++
      continue
    }
    acyclicCount++
    // 2b 规范序与输入顺序无关
    for (const seed of [1, 7, 42]) {
      const o2 = canonicalOrder(shuffle(IDS, seed), shuffle(edges, seed + 1)).order
      assert(o2.join('>') === order.join('>'), `规范序依赖输入顺序: ${mask}/${seed}`)
    }
  }
  assert(acyclicCount > 0 && cyclicCount > 0, '子图枚举未覆盖无环/含环两侧')
  assert(selfLoopMasks > 0, '子图枚举未覆盖自环')

  // 2c 隔离档约束与类型约束必须真正被行使（同档 2 边的 2^2 × 跨档 4 边的 3^4 配置）
  const sameTierPairs = [
    { from: 'n1', to: 'n4' },
    { from: 'n4', to: 'n1' },
  ]
  const crossTierPairs = [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n1' },
    { from: 'n2', to: 'n3' },
    { from: 'n3', to: 'n4' },
  ]
  let isolationDecisive = 0
  let typeDecisive = 0
  for (let ms = 0; ms < 2 ** sameTierPairs.length; ms++) {
    for (let mc = 0; mc < 3 ** crossTierPairs.length; mc++) {
      let rest = mc
      const edges = sameTierPairs
        .filter((_, k) => (ms >> k) & 1)
        .map((e) => ({ ...e, bridge: false }))
      for (const e of crossTierPairs) {
        const state = rest % 3
        rest = Math.floor(rest / 3)
        if (state === 1) edges.push({ ...e, bridge: false }) // 跨档未桥接
        if (state === 2) edges.push({ ...e, bridge: true }) // 跨档桥接
      }
      const impl = graphValid(IDS, edges)
      const def = validByDefinition(IDS, edges)
      // 只比较两种独立实现的**环判定**（Kahn vs DFS）；valid 的比较交给实现 B（SPECN 路径），
      // 因为 graphValid 就是委托 validByDefinition 的，直接比 valid 会是自比较（评审 F2）
      assert(impl.acyclic === def.noCycle, `环判定两种实现不一致: ${ms}/${mc}`)
      assert(impl.valid === validIndependent(IDS, edges), `谓词实现与独立实现 B 不一致: ${ms}/${mc}`)
      if (def.noCycle && !def.isolationOk) isolationDecisive++
      if (def.noCycle && def.isolationOk && !def.typeOk) typeDecisive++
    }
  }
  assert(isolationDecisive > 0, '隔离档约束未被行使（无未桥接跨档反例）')
  assert(typeDecisive > 0, '类型约束未被行使（无类型不符反例）')

  // 2d 显式反例：成环 / 未桥接跨档 / 类型不符 / 自环建议 必须非法
  const cyc = [
    { from: 'n1', to: 'n2', bridge: true },
    { from: 'n2', to: 'n1', bridge: true },
  ]
  assert(!graphValid(IDS, cyc).valid && hasCycleDFS(IDS, cyc).cyclic, '成环图必须被判有环且非法')
  const unbridged = [{ from: 'n1', to: 'n2', bridge: false }]
  const ub = validByDefinition(IDS, unbridged)
  assert(ub.noCycle && !ub.isolationOk && !ub.valid, '跨档未桥接必须非法（且因隔离档而非环）')
  const typeMismatch = [{ from: 'n3', to: 'n4', bridge: true }] // n3.out=report ≠ n4.in=judge；跨档已桥接，故只类型不符
  const tm = validByDefinition(IDS, typeMismatch)
  assert(tm.noCycle && tm.isolationOk && !tm.typeOk && !tm.valid, '类型不符必须非法（且因类型而非环/隔离档）')
  // 自环必须**因成环**被拒：n4 的 out === in 且同档，故类型与隔离档都不构成拒绝理由
  const selfLoop = [{ from: 'n4', to: 'n4', bridge: false }]
  const sl = validByDefinition(IDS, selfLoop)
  assert(!sl.noCycle && sl.isolationOk && sl.typeOk && !sl.valid, '自环必须因成环（而非类型/隔离档）被拒')
  const selfLoop2 = [{ from: 'n2', to: 'n2', bridge: false }]
  assert(!graphValid(IDS, selfLoop2).valid, '任意自环建议必须被静态校验拒绝')
  const goodGraph = [
    { from: 'n1', to: 'n2', bridge: true }, // vm→proc 跨档桥接；obs→obs 类型匹配
    { from: 'n2', to: 'n3', bridge: true }, // proc→container 跨档桥接；judge→judge
  ]
  assert(graphValid(IDS, goodGraph).valid, '合法图应判合法')

  // 2e 节点取值不得依赖入边的列举顺序（runPure 的 .sort() 是确定性的一部分，须被行使）
  const fanIn = [
    { from: 'n1', to: 'n2', bridge: true },
    { from: 'n2', to: 'n3', bridge: true },
    { from: 'n4', to: 'n3', bridge: true }, // n3 有两条入边，用于检查入边顺序无关性
  ]
  const fanBase = runPure(IDS, fanIn, 'seed-F').join('|')
  for (const s of [3, 5])
    assert(runPure(IDS, shuffle(fanIn, s), 'seed-F').join('|') === fanBase, `节点取值依赖入边列举顺序: ${s}`)

  // 2e 必要性反例（A4、种子绑定的必要性；不是引理 2.3 的机检）
  //     (i) 同一执行器 + 两种状态存储：共享 vs 私有。比较"每节点最终读数"（与事件顺序无关，
  //         故差异只能来自共享状态本身，而不是节点名的排列）。
  const runStore = (order, store) => {
    const seen = {}
    for (const n of order) {
      store.bump(n)
      seen[n] = store.read(n)
    }
    return Object.entries(seen)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join(',')
  }
  const makeSharedStore = () => {
    let c = 0
    return { bump: () => void c++, read: () => c }
  }
  const makePrivateStore = () => {
    const m = {}
    return {
      bump: (n) => {
        m[n] = (m[n] ?? 0) + 1
      },
      read: (n) => m[n],
    }
  }
  const sharedAB = runStore(['a', 'b'], makeSharedStore())
  const sharedBA = runStore(['b', 'a'], makeSharedStore())
  assert(sharedAB !== sharedBA, 'A4 必要性反例未成立: 共享状态未导致最终读数差异')
  assert(
    runStore(['a', 'b'], makePrivateStore()) === runStore(['b', 'a'], makePrivateStore()),
    '状态分区不交时应得到相同最终读数',
  )
  //     (ii) 种子必须语义性进入随机节点输出，而非仅作为哈希盐（真实不等式）
  const draws = (seed) => {
    const r = lcg(seed)
    return [r(), r()].map((x) => Math.round(x * 1000)).join(',')
  }
  assert(draws(11) !== draws(12), '不同种子抽样应不同（种子语义性进入输出）')
  //     (iii) 必要的"演示"（非机检）：同种子/确定性函数重复求值一致；有状态执行器必然漂移
  const deterministic = () => runPure(IDS, goodGraph, 'seed-A')
  assert(deterministic().join() === deterministic().join(), '演示: 确定性节点重复执行应一致')
  let counter = 0
  const stateful = () => runPure(IDS, goodGraph, 'seed-A').map(() => ++counter).join()
  assert(stateful() !== stateful(), '演示: 有状态执行器应产生漂移（否则 A8 必要性无从体现）')
}

// ══ P3 证据链（architecture.md §11 / §3 准确性）══
// 类别：partial（篡改方向双实现有齿；"判定一致 ⇒ root 相等"只在 A9 载荷归一化下成立，
//              脚本显式演示 A9 不成立时该方向会失败）
function buildChain(payloads, binding = {}) {
  const entries = []
  let head = sha('GENESIS|' + stableCanon(binding))
  payloads.forEach((p, i) => {
    const contentHash = sha(stableCanon(p))
    const link = sha(head + '|' + contentHash)
    entries.push({ i, contentHash, prev: head, link })
    head = link
  })
  return { entries, root: head }
}
// 独立实现 #2：Merkle 树（不同构造，用于交叉验证篡改检测）
function buildMerkle(payloads, binding = {}) {
  let level = [sha('GENESIS|' + stableCanon(binding))].concat(
    payloads.map((p) => sha(stableCanon(p))),
  )
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2)
      next.push(sha(level[i] + (level[i + 1] ?? level[i])))
    level = next
  }
  return level[0]
}

function p3() {
  const B1 = { env: 'env1', seed: 's1', tool: 'tool@1', model: 'model@1' }
  const payloads = [
    { node: 'cap', state: 'VERIFIED_PRESENT', evidenceClass: 'probe' },
    { node: 'assert1', verdict: 'pass', evidenceClass: 'obs' },
    { node: 'assert2', verdict: 'skip', reasonClass: 'cap-absent' },
  ]
  const good = buildChain(payloads, B1)
  const goodMerkle = buildMerkle(payloads, B1)
  // 3a 逐条篡改：两种独立构造都必须检出（有齿）
  for (let i = 0; i < payloads.length; i++) {
    const mod = payloads.map((p, j) => (j === i ? { ...p, verdict: 'fail' } : p))
    assert(buildChain(mod, B1).root !== good.root, `链式实现漏检篡改: entry ${i}`)
    assert(buildMerkle(mod, B1) !== goodMerkle, `Merkle 实现漏检篡改: entry ${i}`)
  }
  // 3b 重排/截断
  assert(buildChain([payloads[1], payloads[0], payloads[2]], B1).root !== good.root, '重排漏检')
  assert(buildChain(payloads.slice(0, 2), B1).root !== good.root, '截断漏检')
  // 3c 绑定分量（环境/种子/工具/模型）必须进入 root
  for (const [k, v] of [['env', 'env2'], ['seed', 's2'], ['tool', 'tool@2'], ['model', 'model@2']])
    assert(buildChain(payloads, { ...B1, [k]: v }).root !== good.root, `绑定分量未进入链: ${k}`)
  // 3d A9 角色演示（这才是 T3 反向成立的条件）：
  //     正向：两次"独立构造"的同判定载荷（键序不同）必须给出同一 root ⇒ 依赖 canon 键序无关；
  //     负向：同判定向量 ['pass','skip'] 但运行期证据漂移 ⇒ root 不同（即第 1 版被推翻的反例）。
  const recA = [{ node: 't0', verdict: 'pass' }, { node: 't1', verdict: 'skip' }]
  // 同一序列、同一内容，仅对象键的书写顺序不同（数组顺序是语义，不参与本实验）
  const recB = [{ verdict: 'pass', node: 't0' }, { verdict: 'skip', node: 't1' }]
  assert(stableCanon(recA) === stableCanon(recB), 'canon 应对键序不敏感')
  assert(buildChain(recA, B1).root === buildChain(recB, B1).root, 'A9 正向: 独立构造的同判定载荷 root 应相等')
  assert(JSON.stringify(recA) !== JSON.stringify(recB), '演示前提: 朴素 JSON.stringify 键序敏感（故 canon 不能直接用它的裸输出）')
  const recWith = (evidence) => [
    { node: 't0', verdict: 'pass', evidence },
    { node: 't1', verdict: 'skip', evidence: 'obs#8' },
  ]
  assert(
    buildChain(recWith('obs#7 latency=12ms'), B1).root !== buildChain(recWith('obs#7 latency=31ms'), B1).root,
    'A9 负向: 同判定但证据漂移必须改变 root',
  )
  // 演示（非有齿）：纯函数幂等——键序被 JSON 往返保留，任何纯 canon 都会通过
  assert(
    buildChain(recWith('obs#7 latency=12ms'), B1).root ===
      buildChain(JSON.parse(JSON.stringify(recWith('obs#7 latency=12ms'))), B1).root,
    '演示: 同载荷重放路径幂等（由构造保证）',
  )
}

// ══ P4 完整性：五桶分割（architecture.md §4 完整性可验证 / 规格先行）══
// 类别：partial（否定方向即"静默丢弃/重复/缺证据必须被检出"有齿；正方向由构造保证）
const BUCKETS = ['pass', 'fail', 'skip', 'error', 'inconclusive']
function bucketize(requiredSet, verdictOf) {
  const b = Object.fromEntries(BUCKETS.map((k) => [k, []]))
  for (const id of requiredSet) {
    const v = verdictOf(id)
    b[v].push({
      id,
      verdict: v,
      evidence: v === 'skip' || v === 'inconclusive' ? `reason:${id}` : `obs:${id}`,
    })
  }
  return b
}
function complete(requiredSet, buckets) {
  // 定义 5.1：R 是集合 ⇒ 入参先按集合语义去重（重复 id 不是"额外条目"）
  const R = [...new Set(requiredSet)]
  const seen = []
  for (const k of BUCKETS) for (const e of buckets[k]) seen.push(e.id)
  const uniq = new Set(seen)
  if (uniq.size !== seen.length) return false // 重复归属
  if (seen.length !== R.length) return false // 缺条目或多出外来条目
  for (const id of R) if (!uniq.has(id)) return false // 外来 id 顶替必需 id
  return buckets.skip.concat(buckets.inconclusive).every((e) => typeof e.evidence === 'string' && e.evidence.length > 0)
}

function p4() {
  const required = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']
  const rule = (id) => BUCKETS[Number(id.slice(1)) % BUCKETS.length]
  for (let mask = 0; mask < 2 ** required.length; mask++) {
    const subset = required.filter((_, i) => (mask >> i) & 1)
    const b = bucketize(subset, rule)
    assert(complete(subset, b), `合法桶应判完整: ${mask}`)
    for (const id of subset) {
      const dropOne = JSON.parse(JSON.stringify(b))
      for (const k of BUCKETS) dropOne[k] = dropOne[k].filter((e) => e.id !== id)
      assert(!complete(subset, dropOne), `静默丢弃未检出: ${mask}/${id}`)
    }
    const dup = JSON.parse(JSON.stringify(b))
    const anyBucket = BUCKETS.find((k) => dup[k].length)
    if (anyBucket) {
      dup[anyBucket].push({ ...dup[anyBucket][0] })
      assert(!complete(subset, dup), `重复归属未检出: ${mask}`)
    }
    const noEvidence = JSON.parse(JSON.stringify(b))
    const soft = noEvidence.skip.concat(noEvidence.inconclusive)
    if (soft.length) {
      soft[0].evidence = ''
      assert(!complete(subset, noEvidence), `软判定缺证据未检出: ${mask}`)
    }
  }
  // 应跑清单是集合（去重）：R 含重复 id 时仍应判完整（若 complete 不去重，此断言会失败）
  assert(complete(['c1', 'c1'], bucketize(['c1'], rule)), 'R 按集合语义应判完整（重复 id 应被去重）')
  // 多出外来条目 / 外来 id 顶替必需 id 必须被检出（分别行使长度守卫与成员守卫）
  const extra = JSON.parse(JSON.stringify(bucketize(['c1', 'c2'], rule)))
  extra.pass.push({ id: 'cX', verdict: 'pass', evidence: 'obs:cX' })
  assert(!complete(['c1', 'c2'], extra), '多出外来条目未检出')
  const foreign = JSON.parse(JSON.stringify(bucketize(['c1', 'c2'], rule)))
  for (const k of BUCKETS) foreign[k] = foreign[k].map((e) => (e.id === 'c2' ? { ...e, id: 'cX' } : e))
  assert(!complete(['c1', 'c2'], foreign), '外来 id 顶替必需 id 未检出')
  // 能力缺失项必须全部入账为 skip
  const caps = ['vm', 'proc', 'container']
  for (let m = 0; m < 2 ** 3; m++) {
    const plan = caps.filter((_, i) => (m >> i) & 1)
    const b = bucketize(plan, () => 'skip')
    assert(complete(plan, b) && b.skip.length === plan.length, `能力缺失项未全部入账: ${m}`)
  }
}

// ══ 运行 ══
let ok = true
try {
  part('P1 能力四态与判定纪律', 'definitional+teeth', p1)
  part('P2 组合图可校验性与确定性', 'partial', p2)
  part('P3 证据链篡改检测与重放', 'partial', p3)
  part('P4 完整性五桶分割', 'partial', p4)
} catch (e) {
  ok = false
  console.error(`\n✗ ${e.message}`)
}
console.log('theory-model-check — architecture.md 抽象模型自检')
console.log(`node ${process.version}`)
for (const p of parts) console.log(`  ${p.failed === 0 ? '✓' : '✗'} ${p.name}  [${p.kind}]  (cases=${p.cases}, failed=${p.failed})`)
console.log('  注: 引理 2.3（并发可交换）本身无机检；P2 只含"违反 A4 会怎样"的必要性反例。')
console.log('  注: T3 的"判定一致 ⇒ root 相等"方向依赖 A9（载荷归一化），由 P3 3d 显式演示。')
if (fails.length) {
  console.log(`\n${fails.length} failed check(s):`)
  for (const f of fails.slice(0, 20)) console.log('  - ' + f)
}
const total = parts.reduce((s, p) => s + p.cases, 0)
console.log(`\n${ok && fails.length === 0 ? 'PASS' : 'FAIL'} — total cases=${total}`)
process.exit(ok && fails.length === 0 ? 0 : 1)
