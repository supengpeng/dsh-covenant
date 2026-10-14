// 噪声插件：装载期向 stdout 写内容（用于验证 worker 把 PUT 输出重定向到 stderr、保护控制信道）
export function apply() {
  process.stdout.write('PUT-noise\n')
  return () => {}
}