/**
 * 对抗集新变种周期（architecture.md §15.7 F17）。
 *
 * 口径（**已确认**）：
 *  - 周期触发 = **真实时间 cron**（进程内调度器按 cron 表达式推进，见 `AdversarialCronRunner`）；
 *  - 样本来源 = **外部样本供给**（本地目录 + JSON manifest，见 `parseExternalSamples` /
 *    `readExternalSamplesFile`）；外部样本须带 `schemaVersion/category/source/payload`，未知类别、
 *    解析失败、空样本集均按 FAIL 处理（不静默缩水）；
 *  - 验收 = 每个 cron 触发点引入的样本 100% 检出，漏检即 FAIL（F17）。
 *
 * 下方 `perturb`/`samplesForCycle` 保留为**离线演练/确定性变种入口**（不依赖外部供给时可用），
 * 但正式周期入口是 cron + 外部样本。检测器由调用方注入（与后端解耦）。
 */

import { nextRunAfter } from './cron.js'
import { readFileSync } from 'node:fs'

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

// ---------------------------------------------------------------------------
// 外部样本供给（本地目录 + JSON manifest）
// ---------------------------------------------------------------------------

const CATEGORIES: readonly string[] = [
  'violating-plugin',
  'forge-evidence',
  'privilege-escalation',
  'isolation-escape',
]

export interface ExternalSampleSet {
  readonly schemaVersion: number
  readonly version: string
  readonly samples: readonly AdversarialSample[]
}

function isCategory(v: unknown): v is AdversarialCategory {
  return typeof v === 'string' && CATEGORIES.includes(v)
}

/**
 * 解析外部样本 JSON manifest。未知类别 / 缺失字段 / 空样本集一律抛错（不能静默缩水）。
 *
 * 期待格式：
 * ```json
 * { "schemaVersion": 1, "version": "v1", "samples": [
 *     { "id": "forge-evidence:001", "category": "forge-evidence", "source": "external:v1", "payload": {...} }
 * ] }
 * ```
 */
export function parseExternalSamples(text: string): ExternalSampleSet {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`external samples manifest is not valid JSON: ${String(err)}`)
  }
  const root = data as { schemaVersion?: unknown; version?: unknown; samples?: unknown }
  if (root.schemaVersion !== 1) throw new Error('external samples manifest: schemaVersion must be 1')
  if (typeof root.version !== 'string' || !root.version.trim()) throw new Error('external samples manifest: version must be a non-empty string')
  if (!Array.isArray(root.samples)) throw new Error('external samples manifest: samples must be an array')
  if (root.samples.length === 0) throw new Error('external samples manifest: samples must not be empty (empty set = FAIL)')

  const samples: AdversarialSample[] = root.samples.map((s, i) => {
    const o = s as { id?: unknown; category?: unknown; source?: unknown; payload?: unknown }
    if (typeof o.id !== 'string' || !o.id.trim()) throw new Error(`samples[${i}]: id must be a non-empty string`)
    if (!isCategory(o.category)) throw new Error(`samples[${i}] (${o.id}): unknown category ${JSON.stringify(o.category)}`)
    return {
      id: o.id,
      category: o.category,
      cycle: 0, // 外部样本无内部 cycle；由 scheduler 注入 cycleIndex
      variantIndex: i,
      source: typeof o.source === 'string' ? o.source : `external:${root.version}`,
      payload: o.payload,
    }
  })
  return { schemaVersion: 1, version: root.version, samples }
}

/** 读本地外部样本 manifest 文件（node:fs）。 */
export function readExternalSamplesFile(path: string): ExternalSampleSet {
  return parseExternalSamples(readFileSync(path, 'utf8'))
}

// ---------------------------------------------------------------------------
// 真实时间 cron 调度
// ---------------------------------------------------------------------------

export interface AdversarialCronRunnerOptions {
  readonly cron: string
  readonly clock?: () => Date
  /** 每个到期的 cron 触发点调用一次（cycleIndex 自 0 递增），返回该周期要检出的外部样本。 */
  readonly supplier: (cycleIndex: number) => Promise<readonly AdversarialSample[]> | readonly AdversarialSample[]
  readonly detect: (sample: AdversarialSample) => boolean
  /** 调度基线（默认 = clock() 或 now）。 */
  readonly startFrom?: Date
}

/**
 * 对抗集 cron 调度器：按真实时间 cron 推进；每到一个触发点，从外部供给引一个样本集
 * 并跑 `verifyCycle`（100% 检出，漏检即 FAIL）。用注入 clock 保证测试可无抖动推进。
 */
export class AdversarialCronRunner {
  private cursor: Date
  private cycleIndex = 0

  constructor(private readonly opts: AdversarialCronRunnerOptions) {
    this.cursor = opts.startFrom ?? opts.clock?.() ?? new Date()
  }

  /** 推进到 `now`：对每个已到期的 cron 触发点，引入外部样本集并跑一轮。 */
  async run(now?: Date): Promise<CycleVerdict[]> {
    const t = now ?? this.opts.clock?.() ?? new Date()
    const results: CycleVerdict[] = []
    let next = nextRunAfter(this.opts.cron, this.cursor)
    while (next && next.getTime() <= t.getTime()) {
      const samples = await this.opts.supplier(this.cycleIndex)
      if (samples.length === 0) {
        throw new Error(`adversarial cycle ${this.cycleIndex} supplied an empty sample set — FAIL (no samples)`)
      }
      results.push(verifyCycle(samples, this.opts.detect))
      this.cycleIndex += 1
      this.cursor = next
      next = nextRunAfter(this.opts.cron, this.cursor)
    }
    this.cursor = t
    return results
  }
}