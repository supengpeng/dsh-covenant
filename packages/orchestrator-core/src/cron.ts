/**
 * 最小 5 字段 cron 解析（分 时 日 月 周），用于对抗集真实时间调度。
 * 支持 `*`、数值、步进（斜杠间隔）、逗号列表、`a-b` 范围。
 *
 * 简化与边界（诚实标注）：
 *  - `dom`（日）与 `dow`（周）按 **AND** 语义处理；标准 Vixie cron 在二者都受限时是 OR，
 *    本实现不涉及这类表达式，故不做 OR；
 *  - `dow` 0 与 7 均视为周日；
 *  - 无真实时间/时区知识：`Date` 用本地时区，逐分钟扫描计算下一触发。
 */

type CronField = string[]

function parseField(field: string): boolean {
  return field !== ''
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true
  for (const raw of field.split(',')) {
    let base = raw
    let step = 1
    if (raw.includes('/')) {
      const [b, s] = raw.split('/') as [string, string]
      base = b ?? ''
      step = Number(s)
      if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${raw}`)
    }
    if (base === '*') {
      if ((value - min) % step === 0) return true
      continue
    }
    if (base.includes('-')) {
      const [a, b] = base.split('-') as [string, string]
      const lo = Number(a)
      const hi = Number(b)
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`invalid cron range: ${raw}`)
      if (value >= lo && value <= hi && (value - lo) % step === 0) return true
      continue
    }
    const n = Number(base)
    if (!Number.isInteger(n)) throw new Error(`invalid cron value: ${raw}`)
    if (n === value) return true
  }
  return false
}

export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`invalid cron expression (expected 5 fields): ${expr}`)
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  void [minute, hour, dom, month, dow].forEach(parseField)
  const m = date.getMonth() + 1
  let w = date.getDay() // 0=Sun
  const dowNorm = w === 0 ? 7 : w
  return (
    fieldMatches(minute, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dom, date.getDate(), 1, 31) &&
    fieldMatches(month, m, 1, 12) &&
    fieldMatches(dow, dowNorm, 0, 7)
  )
}

/** 从 from 之后的下一个 cron 触发时刻（逐分钟扫描，找不到返回 null）。 */
export function nextRunAfter(expr: string, from: Date, limitMinutes = 366 * 24 * 60): Date | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`invalid cron expression (expected 5 fields): ${expr}`)
  // 先做一次校验，确保表达式合法（否则每个字段抛错的时机错乱）
  cronMatches(expr, from)

  let t = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0)
  for (let i = 0; i < limitMinutes; i++) {
    if (cronMatchesFields(fields as [string, string, string, string, string], t)) return t
    t = new Date(t.getTime() + 60_000)
  }
  return null
}

function cronMatchesFields(fields: [string, string, string, string, string], date: Date): boolean {
  const [minute, hour, dom, month, dow] = fields
  const m = date.getMonth() + 1
  const w = date.getDay()
  const dowNorm = w === 0 ? 7 : w
  return (
    fieldMatches(minute, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dom, date.getDate(), 1, 31) &&
    fieldMatches(month, m, 1, 12) &&
    fieldMatches(dow, dowNorm, 0, 7)
  )
}