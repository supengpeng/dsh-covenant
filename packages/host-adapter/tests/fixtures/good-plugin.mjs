// 良好被测插件（ESM）：加载即返回 disposer，不产生副作用
export function apply(ctx) {
  ctx.effect(() => () => {})
  return () => {}
}