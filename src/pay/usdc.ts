/**
 * USDC contracts already listed as 6-decimal assets in packages/guard/src/ported/challenge.ts
 * (AllowLatch commit f33257d): Base and Arbitrum.
 * Chain ids match the Alchemy network page read on 2026-11-01.
 */
import { usdToMicro } from '../chance/constants.ts'
import { createRpc, rpcUrls, type RpcCall, type RpcChain } from '../chain/evm-rpc.ts'

export const USDC_CONTRACT: Record<'base' | 'arbitrum', string> = {
  base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  arbitrum: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
}

export const PAYMENT_CHAIN_ID: Record<'base' | 'arbitrum', number> = {
  base: 8453,
  arbitrum: 42161,
}

export type PaymentChain = 'base' | 'arbitrum'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export function parseUsdToMicro(raw: string | undefined, fallback: string): number | null {
  const text = (raw?.trim() || fallback).trim()
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  const micro = Number(whole) * 1_000_000 + Number(frac.padEnd(6, '0'))
  if (!Number.isFinite(micro)) return null
  return micro
}

/** Product decision 2026-11-01: the check costs at least $1. Default 1.00. */
export function checkPriceMicro(raw?: string): number {
  const parsed = parseUsdToMicro(raw, '1.00')
  if (parsed == null || parsed < usdToMicro(1)) {
    throw new Error('THAW_CHECK_PRICE_USD must be at least 1.00')
  }
  return parsed
}

export function paymentRpc(chain: PaymentChain, alchemyKey: string | undefined, fetchImpl: typeof fetch, overrideUrl?: string): RpcCall {
  const urls = rpcUrls(chain, { alchemyKey, overrideUrl })
  if (!urls.length) throw new Error(`No RPC URL for ${chain}`)
  return createRpc(urls, fetchImpl)
}

export type TransferCheck = {
  ok: true
  from: string
  confirmations: number
} | {
  ok: false
  reason: 'not_mined' | 'failed' | 'no_transfer' | 'wrong_token' | 'wrong_recipient' | 'wrong_amount' | 'confirmations' | 'rpc'
}

function topicAddress(topic: unknown): string | null {
  if (typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null
  return `0x${topic.slice(-40)}`.toLowerCase()
}

/**
 * Confirmations = head block minus the tx block, plus one (the block that included it counts).
 * The decision did not set a number. The default of 1 means "mined in a successful block".
 */
export async function verifyUsdcTransfer(
  call: RpcCall,
  args: { chain: PaymentChain; txHash: string; recipient: string; amountAtomic: bigint; minConfirmations: number },
): Promise<TransferCheck> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.txHash)) return { ok: false, reason: 'not_mined' }
  const recipient = args.recipient.toLowerCase()
  const token = USDC_CONTRACT[args.chain]
  let receipt: unknown
  let headHex: unknown
  try {
    receipt = await call('eth_getTransactionReceipt', [args.txHash])
    headHex = await call('eth_blockNumber', [])
  } catch {
    return { ok: false, reason: 'rpc' }
  }
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'not_mined' }
  const row = receipt as Record<string, unknown>
  if (row.status !== '0x1') return { ok: false, reason: 'failed' }
  if (!Array.isArray(row.logs)) return { ok: false, reason: 'no_transfer' }
  const hit = row.logs.find((log) => {
    if (!log || typeof log !== 'object') return false
    const entry = log as Record<string, unknown>
    if (typeof entry.address !== 'string' || entry.address.toLowerCase() !== token) return false
    const topics = Array.isArray(entry.topics) ? entry.topics : []
    if (typeof topics[0] !== 'string' || topics[0].toLowerCase() !== TRANSFER_TOPIC) return false
    if (topicAddress(topics[2]) !== recipient) return false
    if (typeof entry.data !== 'string' || !/^0x[0-9a-fA-F]+$/.test(entry.data)) return false
    return BigInt(entry.data) === args.amountAtomic
  }) as Record<string, unknown> | undefined
  if (!hit) {
    const anyToken = row.logs.some((log) => log && typeof log === 'object' && typeof (log as { address?: string }).address === 'string' && (log as { address: string }).address.toLowerCase() === token)
    if (!anyToken) return { ok: false, reason: 'wrong_token' }
    const toUs = row.logs.some((log) => {
      if (!log || typeof log !== 'object') return false
      const topics = Array.isArray((log as { topics?: unknown }).topics) ? (log as { topics: unknown[] }).topics : []
      return topicAddress(topics[2]) === recipient
    })
    return { ok: false, reason: toUs ? 'wrong_amount' : 'wrong_recipient' }
  }
  if (typeof row.blockNumber !== 'string' || typeof headHex !== 'string') return { ok: false, reason: 'confirmations' }
  const confirmations = Number(BigInt(headHex) - BigInt(row.blockNumber) + 1n)
  if (!Number.isFinite(confirmations) || confirmations < args.minConfirmations) return { ok: false, reason: 'confirmations' }
  const from = topicAddress((hit.topics as unknown[])[1])
  if (!from) return { ok: false, reason: 'no_transfer' }
  return { ok: true, from, confirmations }
}

export function isPaymentChain(value: string): value is PaymentChain {
  return value === 'base' || value === 'arbitrum'
}

export type { RpcChain }
