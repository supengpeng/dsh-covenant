export { canon, CanonError, type JsonPrimitive, type JsonValue } from './canon.js'
export {
  generateKeyPair,
  sha256Hex,
  signRoot,
  verifyRoot,
  type CovenantKeyPair,
  type Hash,
} from './crypto.js'
export {
  EvidenceChain,
  entryFrom,
  genesisLink,
  link,
  type Binding,
  type BucketCounts,
  type EvidenceEntry,
  type Face,
  type Payload,
} from './chain.js'
export { renderFace } from './faces.js'