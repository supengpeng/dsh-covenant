import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'

/** 内容寻址哈希（SHA-256，64 位十六进制）——theory-proof.md A5「H」。 */
export type Hash = string

export function sha256Hex(data: string): Hash {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

/** Ed25519 密钥对（A5「签名不可伪造」；公开/私钥 PEM）。 */
export interface CovenantKeyPair {
  readonly publicKeyPem: string
  readonly privateKeyPem: string
}

export function generateKeyPair(): CovenantKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

/** σ = Sign(root)：对 32 字节 root 哈希签名（Ed25519 内部再哈希消息）。 */
export function signRoot(root: Hash, privateKeyPem: string): string {
  const sig = nodeSign(null, Buffer.from(root, 'hex'), privateKeyPem)
  return sig.toString('base64')
}

/** 校验 σ（校验失败/参数非法一律返回 false，不抛出越界）。 */
export function verifyRoot(root: Hash, signatureB64: string, publicKeyPem: string): boolean {
  try {
    return nodeVerify(null, Buffer.from(root, 'hex'), publicKeyPem, Buffer.from(signatureB64, 'base64'))
  } catch {
    return false
  }
}