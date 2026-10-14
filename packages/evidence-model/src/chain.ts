import type { Verdict, VerdictRecord } from '@dsh-covenant/assertion'
import { canon } from './canon.js'
import { signRoot, sha256Hex, verifyRoot, type Hash } from './crypto.js'

/**
 * 证据链（theory-proof.md 定义 3.1 / development.md §5.2 / architecture.md §11）。
 *
 * 链构造：l_0 = H(GENESIS ‖ canon(B))，h_i = H(canon(p_i))，l_i = H(l_{i-1} ‖ h_i)，
 * root = l_n，σ = Sign(root)。append-only：`append` 返回新链、不改旧链（不可逆改）；
 * 签名只在最终 `seal`（root 变化会失效旧签名，故 `append` 丢弃签名）。
 */

const GENESIS_TAG = 'dsh-covenant/genesis/v1'

/** 绑定元组 B（theory-proof §1.1 / architecture §11 绑定项）。 */
export interface Binding {
  readonly envSnapshot: string
  readonly toolVersion: string
  readonly modelVersion: string
  readonly seed: string
  readonly executionOrder: readonly string[]
}

/** 入链载荷 p_i（A9：判定的确定性投影，不含运行期可变字段；canon 在哈希时强制 JSON 边界）。 */
export interface Payload {
  readonly verdict: Verdict
  readonly confidence: { readonly score: number; readonly basis: string }
  readonly channel: string
  readonly detail?: unknown
}

/** 证据条目（§5.2：verdict/evidence/confidence/channel/prev/payload）。 */
export interface EvidenceEntry {
  readonly verdict: Verdict
  /** 原始证据（A9：不进载荷、不参与哈希；供面孔渲染与审计定位）。 */
  readonly evidence: string
  readonly confidence: Payload['confidence']
  readonly channel: string
  /** l_{i-1}（去规范化指针，供 `verify` 做链接审计）。 */
  readonly prev: Hash
  readonly payload: Payload
}

export type Face = 'html' | 'junit' | 'tap'

export interface BucketCounts {
  pass: number
  fail: number
  skip: number
  error: number
  inconclusive: number
}

export class EvidenceChain {
  static genesis(binding: Binding, publicKeyPem: string | null = null): EvidenceChain {
    return new EvidenceChain(binding, [], publicKeyPem, null)
  }

  private constructor(
    readonly binding: Binding,
    readonly entries: readonly EvidenceEntry[],
    readonly publicKeyPem: string | null,
    readonly signature: string | null,
  ) {}

  /** 只追加：返回新链实例，不改旧链；root 变化故签名复位为 null。 */
  append(entry: Omit<EvidenceEntry, 'prev'>): EvidenceChain {
    const entryWithPrev: EvidenceEntry = { ...entry, prev: this.root() }
    return new EvidenceChain(this.binding, [...this.entries, entryWithPrev], this.publicKeyPem, null)
  }

  /** 对当前 root 签名（仅在最终链上调用；未带公钥则抛错）。 */
  seal(privateKeyPem: string): EvidenceChain {
    if (!this.publicKeyPem) {
      throw new Error('cannot seal: chain has no public key — create genesis with a keypair')
    }
    return new EvidenceChain(this.binding, this.entries, this.publicKeyPem, signRoot(this.root(), privateKeyPem))
  }

  /** 重建/归档用：以显式签名构造链（如从存储加载已发链；亦用于测试重放签名以验篡改）。 */
  withSignature(signature: string | null): EvidenceChain {
    return new EvidenceChain(this.binding, this.entries, this.publicKeyPem, signature)
  }

  /** 内容寻址根（纯函数：由 B 与 payload 序列重算）。 */
  root(): Hash {
    let l = genesisLink(this.binding)
    for (const e of this.entries) l = link(l, e.payload)
    return l
  }

  /**
   * 链完整性 + 签名校验：
   *  1. 逐条重算 l_{i-1} 并核对 `entry.prev`（链接一致，审计去规范化指针）；
   *  2. 对最终 root 校验签名 σ（缺签名/缺公钥 → false）。
   */
  verify(): boolean {
    if (this.signature == null || this.publicKeyPem == null) return false
    let l = genesisLink(this.binding)
    for (const e of this.entries) {
      if (e.prev !== l) return false
      l = link(l, e.payload)
    }
    return verifyRoot(l, this.signature, this.publicKeyPem)
  }

  /** 五桶分割计数（theory-proof.md T5 / 定义 5.1）。 */
  summary(): BucketCounts {
    const counts: BucketCounts = { pass: 0, fail: 0, skip: 0, error: 0, inconclusive: 0 }
    for (const e of this.entries) counts[e.payload.verdict] += 1
    return counts
  }
}

export function genesisLink(b: Binding): Hash {
  return sha256Hex(`${GENESIS_TAG}|${canon(b)}`)
}

export function link(prev: Hash, payload: Payload): Hash {
  return sha256Hex(prev + sha256Hex(canon(payload)))
}

/** 由判定记录构造一条证据条目（payload 取 verdict/confidence/channel 的归一化投影 + 可选 detail）。 */
export function entryFrom(record: VerdictRecord, detail?: unknown): Omit<EvidenceEntry, 'prev'> {
  const payload: Payload = {
    verdict: record.verdict,
    confidence: record.confidence,
    channel: record.channel,
    ...(detail === undefined ? {} : { detail }),
  }
  return {
    verdict: record.verdict,
    evidence: record.evidence,
    confidence: record.confidence,
    channel: record.channel,
    payload,
  }
}