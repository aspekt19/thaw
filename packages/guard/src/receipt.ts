/**
 * Ed25519 signing from AllowLatch src/lib/latch-receipt.ts at f33257df64e1600c61185ab1a2835e3b9e58f536.
 * The key is sha256("ed25519:" + secret), wrapped as PKCS#8, then Node's Ed25519 signer.
 * Not copied: the HMAC latch receipt, the procure proof, and the source's fallback to
 * SERV_API_KEY or the fixed development string. The caller passes the secret.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

function ed25519PrivateKey(secret: string) {
  const seed = createHash('sha256').update(`ed25519:${secret}`).digest()
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
}

export function ed25519PublicKeyHex(secret: string): string {
  const der = createPublicKey(ed25519PrivateKey(secret)).export({ format: 'der', type: 'spki' })
  return Buffer.from(der).subarray(-32).toString('hex')
}

export function signEd25519(message: string, secret: string): string {
  return sign(null, Buffer.from(message), ed25519PrivateKey(secret)).toString('hex')
}

export function verifyEd25519(message: string, signatureHex: string, secret: string): boolean {
  try {
    const signature = Buffer.from(signatureHex, 'hex')
    if (signature.length !== 64) return false
    return verify(null, Buffer.from(message), createPublicKey(ed25519PrivateKey(secret)), signature)
  } catch {
    return false
  }
}
