/**
 * 规范化序列化 canon（theory-proof.md A5/A9）。
 *
 * 契约：
 *  - 键序不敏感：同一对象不同书写顺序 → 同一字节串（对对象键排序）。
 *  - 载荷域单射：类型带标签、数组序敏感、`-0` 归一为 `0`、非有限数与非 JSON 值一律拒绝，
 *    从而把运行期可变/非规范化内容挡在入链哈希边界之外（A9 边界强制）。
 */
export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export class CanonError extends TypeError {
  override readonly name = 'CanonError'
}

export function canon(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number': {
      if (!Number.isFinite(value)) throw new CanonError(`non-finite number in payload: ${String(value)}`)
      const n = Object.is(value, -0) ? 0 : value
      return String(n)
    }
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`
      const proto: unknown = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonError(`non-plain object in payload: ${Object.prototype.toString.call(value)}`)
      }
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(record[k])}`).join(',')}}`
    }
    default:
      throw new CanonError(`non-JSON value in payload: ${typeof value}`)
  }
}