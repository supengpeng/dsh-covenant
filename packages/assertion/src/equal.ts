/**
 * 确定性深比较（A1 纯函数，无时间/随机/外部状态）。
 *
 * 只对 JSON 类数据给出稳定语义：primitive 用 `Object.is`（`NaN` 自等、`+0`/`-0` 不等），
 * 数组序敏感，普通对象键序不敏感。Date/RegExp/Map/Set/TypedArray 按值语义处理；
 * 其余对象退化为引用比较（同引用才相等），保证函数从不抛出、从不依外部状态。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, new Set())
}

function equal(a: unknown, b: unknown, seen: Set<[object, object]>): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const left = a as object
  const right = b as object
  // 环引用守卫（确定性：按已见对剪枝）
  for (const [x, y] of seen) if ((x === left && y === right) || (x === right && y === left)) return true
  seen.add([left, right])

  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) if (!equal(left[i], right[i], seen)) return false
    return true
  }

  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (left instanceof RegExp && right instanceof RegExp) return left.source === right.source && left.flags === right.flags
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false
    for (const [k, v] of left) if (!right.has(k) || !equal(v, right.get(k), seen)) return false
    return true
  }
  if (left instanceof Set && right instanceof Set) {
    if (left.size !== right.size) return false
    for (const item of left) {
      let found = false
      for (const other of right) if (equal(item, other, seen)) { found = true; break }
      if (!found) return false
    }
    return true
  }
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
    return typedArraysEqual(left as ArrayBufferView, right as ArrayBufferView)
  }

  const lk = Object.keys(left)
  const rk = Object.keys(right)
  if (lk.length !== rk.length) return false
  for (const k of lk) {
    if (!Object.prototype.hasOwnProperty.call(right, k)) return false
    if (!equal((left as Record<string, unknown>)[k], (right as Record<string, unknown>)[k], seen)) return false
  }
  return true
}

function typedArraysEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.constructor !== b.constructor) return false
  if (a.byteLength !== b.byteLength) return false
  const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false
  return true
}