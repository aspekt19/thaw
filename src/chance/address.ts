import { createHash } from 'node:crypto'
import type { Chain } from './constants.ts'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58(buf: Buffer): string {
  let n = BigInt(`0x${buf.toString('hex')}`)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const byte of buf) {
    if (byte === 0) out = `1${out}`
    else break
  }
  return out
}

/** 20-byte hex (with or without 0x) or 21-byte hex starting with 41. */
export function tronHexToBase58(hex: string): string {
  let h = hex.trim().replace(/^0x/i, '')
  if (h.length === 40) h = `41${h}`
  if (!/^[0-9a-fA-F]{42}$/.test(h)) {
    throw new Error('TRON address hex is not 20 or 21 bytes')
  }
  const payload = Buffer.from(h, 'hex')
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest()
    .subarray(0, 4)
  return base58(Buffer.concat([payload, checksum]))
}

export function normalizeTronAddress(value: string): string | null {
  const trimmed = value.trim()
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) return trimmed
  try {
    return tronHexToBase58(trimmed)
  } catch {
    return null
  }
}

export type DepositKind = 'address' | 'tx'

export function classifyDeposit(chain: Chain, value: string): DepositKind | null {
  const trimmed = value.trim()
  if (chain === 'tron') {
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) return 'address'
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return 'tx'
    return null
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return 'address'
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return 'tx'
  return null
}

export function sameAddress(chain: Chain, a: string, b: string): boolean {
  if (chain === 'tron') return a === b
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Public explorers. Base uses basescan.org.
 * Ethereum, Arbitrum, and TRON use the matching public sites.
 */
export function explorerUrl(chain: Chain, kind: DepositKind, value: string): string {
  const id = value.trim()
  if (chain === 'base') return kind === 'tx' ? `https://basescan.org/tx/${id}` : `https://basescan.org/address/${id}`
  if (chain === 'arbitrum') return kind === 'tx' ? `https://arbiscan.io/tx/${id}` : `https://arbiscan.io/address/${id}`
  if (chain === 'ethereum') return kind === 'tx' ? `https://etherscan.io/tx/${id}` : `https://etherscan.io/address/${id}`
  return kind === 'tx' ? `https://tronscan.org/#/transaction/${id}` : `https://tronscan.org/#/address/${id}`
}
