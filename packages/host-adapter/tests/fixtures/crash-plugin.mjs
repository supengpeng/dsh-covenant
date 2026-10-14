// 崩溃插件：装载期硬退出（process.exit 不可捕获），用于验证「崩溃不拖垮平台」
export function apply() {
  process.exit(3)
}