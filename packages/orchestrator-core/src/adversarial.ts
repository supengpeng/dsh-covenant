/**
 * 对抗集新变种周期（architecture.md §15.7 F17；development.md §11.3 待定口径）。
 *
 * 口径（**默认值，待用户确认**）：
 *  - 周期触发 = **机检可重放**（确定性 `cycle` 参数），非真实时间 cron；
 *  - 样本来源 = **内置基础样本（`builtin:v1`）+ 确定性变种展开**：同一基础样本
 *    按 `(cycle, seed)` 做等价变形（键序扰动 / 字符串叶加噪 / 数组轮转），产出一组新变种；
 *  - 验收 = 各周期全部变种 100% 检出，漏检即 FAIL（F17）；并保证新变种真实进入
 *    （payload 随周期变化）且可重放（同 cycle+seed 字节一致）。
 *
 * 本模块是**纯函数**周期机制，不依赖任何后端；检测器由调用方注入。
 */

export type AdversarialCategory =
  | 'violating-plugin'
  | 'forge-evidence'
  | 'privilege-escalation'
  | 'isolation-escape'

export interface BaseSample {
  readonly category: AdversarialCategory
  /** 样本来源口径（如 `builtin:v1`）。 */
  readonly source: string
  readonly payload: unknown
}

export interface AdversarialSample {
  readonly id: string
  readonly category: AdversarialCategory
  readonly cycle: number
  readonly variantIndex: number
  /** 来源口径（`<source>:variant-<i>`），可审计到基础样本与变种序号。 */
  readonly source: string
  readonly payload: unknown
}

/** 字符串哈希 → 32 位无符号（做 PRNG 种子）。 */
export function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (Math.imul(h, 31) + input.charCodeAt(i)) | 0
  return h >>> 0
}

/** mulberry32 确定性 PRNG。 */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 确定性 Fisher-Yates 洗牌（保持可重放）。 */
function shuffled<T>(arr: readonly T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = a[i]!
    a[i] = a[j]!
    a[j] = t
  }
  return a
}

/**
 * 等价变形（防打补丁）：深拷贝 + 键序扰动 + 字符串叶加噪 + 数组轮转。
 * 由 `rand` 驱动，同一序列必同一结果；变形的语义等价（对检测器仍属同类威胁），
 * 仅表层 byte 不同。
 */
export function perturb(value: unknown, rand: () => number): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const arr = value.map((v) => perturb(v, rand))
    if (arr.length > 1) {
      const i = Math.floor(rand() * arr.length)
      const j = Math.floor(rand() * arr.length)
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }
  const src = value as Record<string, unknown>
  const keys = shuffled(Object.keys(src), rand)
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = src[k]
    out[k] = typeof v === 'string' ? `${v}~${Math.floor(rand() * 100000)}` : perturb(v, rand)
  }
  return out
}

/** 展开某周期全部变种（每个基础样本 `variantsPerBase` 个变种，确定性）。 */
export function samplesForCycle(
  bases: readonly BaseSample[],
  cycle: number,
  seed: string,
  variantsPerBase: number,
): AdversarialSample[] {
  const rand = mulberry32(hashSeed(`${cycle}:${seed}`))
  const out: AdversarialSample[] = []
  for (const b of bases) {
    for (let i = 0; i < variantsPerBase; i++) {
      out.push({
        id: `${b.category}:c${cycle}:v${i}`,
        category: b.category,
        cycle,
        variantIndex: i,
        source: `${b.source}:variant-${i}`,
        payload: perturb(b.payload, rand),
      })
    }
  }
  return out
}

export interface CycleVerdict {
  readonly cycle: number
  readonly total: number
  readonly detected: number
  readonly missed: readonly string[]
}

/** 跑一轮：全部样本经 `detect` 检出，返回漏检清单（漏检 > 0 ⇒ FAIL）。 */
export function verifyCycle(
  samples: readonly AdversarialSample[],
  detect: (sample: AdversarialSample) => boolean,
): CycleVerdict {
  const missed: string[] = []
  let detected = 0
  for (const s of samples) {
    if (detect(s)) detected += 1
    else missed.push(s.id)
  }
  return { cycle: samples[0]?.cycle ?? 0, total: samples.length, detected, missed }
}