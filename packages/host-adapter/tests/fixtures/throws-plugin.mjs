// 抛错插件：装载期同步抛错（worker 可捕获 → 报告 failed）
export function apply() {
  throw new Error('boom')
}