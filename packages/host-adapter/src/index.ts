import type { HostAdapter, HostSpec } from './spi.js'
import { SubprocessHostAdapter } from './subprocess.js'
import { VmHostAdapter } from './vm.js'
import { ContainerHostAdapter } from './container.js'

export * from './spi.js'
export { A7_DISCLAIMER, VmHostAdapter } from './vm.js'
export { SubprocessHostAdapter, WORKER_SOURCE } from './subprocess.js'
export { ContainerHostAdapter, createContainerAdapter, type ContainerAdapterOptions } from './container.js'

/** 注册表：按隔离档分发（§5.3）。container 档已实现（docker 真实容器）。 */
export function createAdapter(spec: HostSpec): HostAdapter {
  switch (spec.tier) {
    case 'vm':
      return new VmHostAdapter()
    case 'subprocess':
      return new SubprocessHostAdapter()
    case 'container':
      return new ContainerHostAdapter()
  }
}