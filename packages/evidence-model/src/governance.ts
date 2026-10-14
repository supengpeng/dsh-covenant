import { canon } from './canon.js'
import { sha256Hex, type Hash } from './crypto.js'

/**
 * 证据链治理（architecture.md §15.3「冗余与不可遗忘」；development.md Task 14）。
 *
 * - 双副本：本地 + 只读归档，各带校验和，等价性可核；
 * - 不可遗忘类目：被推翻判定 / 覆盖缺口 / 免闸记录 / 终裁记录，只追加不删。
 */

/** 不可遗忘类目（§15.3 / G7）。 */
export type UnforgottenKind = 'overturned-verdict' | 'coverage-gap' | 'waiver' | 'arbitration'

export const UNFORGOTTEN_KINDS: readonly UnforgottenKind[] = [
  'overturned-verdict',
  'coverage-gap',
  'waiver',
  'arbitration',
]

export function isUnforgotten(kind: string): boolean {
  return (UNFORGOTTEN_KINDS as readonly string[]).includes(kind)
}

/** 双副本（本地 / 只读归档）中的一份，带内容寻址校验和。 */
export interface Replica {
  readonly kind: 'local' | 'archive'
  readonly checksum: Hash
  readonly entryCount: number
}

export function replicaOf(entries: readonly unknown[], kind: 'local' | 'archive'): Replica {
  return { kind, checksum: sha256Hex(canon(entries)), entryCount: entries.length }
}

/** 校验和 + 条数等价（本地与归档一致）。 */
export function replicasEquivalent(local: Replica, archive: Replica): boolean {
  return local.checksum === archive.checksum && local.entryCount === archive.entryCount
}

/**
 * 不可遗忘账本：按类目只追加（无删除/覆盖路径），读取返回快照副本。
 */
export class UnforgottenLedger {
  private readonly byKind = new Map<UnforgottenKind, unknown[]>()

  /** 只追加。对非不可遗忘类目写操作被拒。 */
  append(kind: UnforgottenKind, record: unknown): void {
    if (!isUnforgotten(kind)) {
      throw new Error(`cannot append to non-unforgotten kind '${kind}' (只 append 类目封闭)`)
    }
    const current = this.byKind.get(kind) ?? []
    this.byKind.set(kind, [...current, record])
  }

  read(kind: UnforgottenKind): readonly unknown[] {
    return [...(this.byKind.get(kind) ?? [])]
  }

  sizes(): Readonly<Record<UnforgottenKind, number>> {
    const out = {} as Record<UnforgottenKind, number>
    for (const k of UNFORGOTTEN_KINDS) out[k] = (this.byKind.get(k) ?? []).length
    return out
  }
}