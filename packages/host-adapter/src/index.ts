import { StateError, type HostAdapter, type HostSpec } from './spi.js'
import { SubprocessHostAdapter } from './subprocess.js'
import { VmHostAdapter } from './vm.js'

export * from './spi.js'
export { A7_DISCLAIMER, VmHostAdapter } from './vm.js'
export { SubprocessHostAdapter } from './subprocess.js'

/** 注册表：按隔离档分发（§5.3）。容器/远端为后续里程碑（§8.1）。 */
export function createAdapter(spec: HostSpec): HostAdapter {
  switch (spec.tier) {
    case 'vm':
      return new VmHostAdapter()
    case 'subprocess':
      return new SubprocessHostAdapter()
    case 'container':
      throw new StateError('TIER_NOT_IMPLEMENTED', "container tier is a later milestone (architecture.md §8.1); use 'subprocess' or 'vm'")
  }
}