// 违规插件（对抗样本 A1）：装载期抛出异常，平台必须检出并标记 FAILED
export function apply() {
  throw new Error('violating plugin refuses to load correctly')
}