/** Product numbers from the Thaw plan. Not catalog prices. */

export const DEFAULT_DAILY_CHECKS = 3
export const DEFAULT_SPEND_CAP_USD = 5
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** Agent path above the free limit. Stub, off unless THAW_PAID_PATH_ENABLED=1. */
export const PAID_PATH_PRICE_USD = 0.1
/**
 * USDTBanList published price for POST /x402/check.
 * Source: https://usdtbanlist.com/x402 read on 2026-11-01.
 * The live client does not pay, so this is a quote, not a charge.
 */
export const BANLIST_QUOTE_MICRO_USD = 1_000
export const USD_MICRO = 1_000_000

export const EXCHANGES = [
  'binance',
  'coinbase',
  'bybit',
  'okx',
  'kucoin',
  'kraken',
  'crypto_com',
  'other',
] as const

export const CHAINS = ['tron', 'ethereum', 'arbitrum', 'base'] as const

export const ORIGINS = [
  'exchange_purchase',
  'p2p',
  'otc',
  'salary',
  'mining_staking',
  'defi_airdrop',
  'goods_services',
  'transfer_person',
  'unknown',
] as const

export const CATEGORIES = [
  'law_enforcement',
  'sanctions',
  'theft',
  'final_closure',
  'source_of_funds',
  'additional_verification',
  'edd',
  'travel_rule',
  't_plus_n',
  'risk_control',
  'unknown',
] as const

export const STOP_CATEGORIES = ['law_enforcement', 'sanctions', 'theft', 'final_closure'] as const

export const ORDINARY_CATEGORIES = [
  'source_of_funds',
  'additional_verification',
  'edd',
  'travel_rule',
  't_plus_n',
  'risk_control',
] as const

/** Chain ids already used for payment (Base 8453) and for the Etherscan v2 `chainid` query. */
export const EVM_CHAIN_IDS: Record<'ethereum' | 'arbitrum' | 'base', string> = {
  ethereum: '1',
  arbitrum: '42161',
  base: '8453',
}

export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type Exchange = (typeof EXCHANGES)[number]
export type Chain = (typeof CHAINS)[number]
export type Origin = (typeof ORIGINS)[number]
export type Category = (typeof CATEGORIES)[number]
export type Verdict = 'high' | 'medium' | 'low' | 'cannot_help'

export function formatUsd(micro: number): string {
  const sign = micro < 0 ? '-' : ''
  const v = Math.abs(Math.trunc(micro))
  const whole = Math.floor(v / USD_MICRO)
  const frac = String(v % USD_MICRO)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`
}

export function usdToMicro(usd: number): number {
  return Math.round(usd * USD_MICRO)
}
