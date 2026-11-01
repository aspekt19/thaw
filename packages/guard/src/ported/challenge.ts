/**
 * Reads every offer in a seller's live 402 payment request and turns its amount into dollars with the right
 * decimals for its asset. The guard compares these numbers with the catalog price and the pinned payee.
 *
 * Decimals: USDC/USDC.e and the Tempo stablecoins use 6, the BNB Chain stablecoins use 18, Stripe amounts are
 * cents. For an asset AllowLatch does not know, it assumes 6 (or fewer, if the seller says so). Guessing too few
 * decimals makes a price look bigger, never smaller, so a wrong guess can only refuse a purchase, not let one by.
 */

export const SIX_DECIMAL_ASSETS = new Set(
  [
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC (Base)
    'epjfwdd5aufqssqem2qn1xzybapc8g4wegggkzwytdt1v', // USDC (Solana)
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC (Polygon)
    '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', // USDC (Avalanche)
    '0x7ab6f3ed87c42ef0adb67ed95090f8bf5240149e', // USDC.e (Kite)
    '0x20c000000000000000000000b9537d11c60e8b50', // Tempo stablecoin
    '0x20c0000000000000000000000000000000000000', // Tempo pathUSD
    '0x3600000000000000000000000000000000000000', // Arc USDC
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC (Arbitrum)
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC (Optimism)
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (Ethereum)
    '0xceba9300f2b948710d2653dd7b07f33a8b32118c', // USDC (Celo)
    '0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392', // USDC (Sei)
    '0x754704bc059f8c67012fed69bc8a327a5aafb603', // USDC (Monad)
    '31566704', // USDC (Algorand ASA)
  ].map((a) => a.toLowerCase())
)

/** Stellar assets (classic and their Soroban contracts) always use 7 decimals. */
export const SEVEN_DECIMAL_ASSETS = new Set(
  [
    'ccw67tszv3sss2hxmbq5jfgckjnxkzm7uquwuzputhxstzleo7sjmi75', // USDC (Stellar, Soroban contract)
  ].map((a) => a.toLowerCase())
)

export const EIGHTEEN_DECIMAL_ASSETS = new Set(
  [
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC (BNB Chain)
    '0x55d398326f99059ff775485246999027b3197955', // USDT (BNB Chain)
    '0xce24439f2d9c6a2289f741120fe202248b666666', // U (BNB Chain)
    '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', // USD1 (BNB Chain)
  ].map((a) => a.toLowerCase())
)

export type ChallengeOffer = {
  scheme: string | null
  network: string | null
  asset: string | null
  payTo: string | null
  /** Amount exactly as the seller wrote it. */
  amountRaw: string | null
  /** In dollars, decimals applied. For "upto" this is the most the seller may take. */
  amountUsd: number | null
  decimals: number | null
  /** Where the decimals came from: the asset list, cents (Stripe), a decimal string, or a guess. */
  decimalsFrom: 'known_asset' | 'cents' | 'decimal_string' | 'assumed_6' | 'seller_said_fewer' | 'unreadable'
  /** True for "upto" offers: the seller may take less, never more than amountUsd. */
  variable: boolean
  /** Host named in this offer's `resource` field, if any. */
  resourceHost: string | null
}

export type Challenge = {
  offers: ChallengeOffer[]
  /** Hosts the payment request says it is for (v2 top-level resource, v1 per-offer resource). */
  resourceHosts: string[]
  /** Highest dollar amount any offer asks for (null if none could be read). */
  maxUsd: number | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)

export function hostOf(u: unknown): string | null {
  const s = typeof u === 'string' ? u : u && typeof u === 'object' ? str((u as Record<string, unknown>).url) : null
  if (!s) return null
  try {
    return new URL(s).hostname.toLowerCase().replace(/\.$/, '') || null
  } catch {
    return null
  }
}

/** EVM addresses compare lowercased; other address formats (Solana) are case-sensitive and kept as written. */
export function normalizeAddress(a: string | null | undefined): string | null {
  if (!a) return null
  const s = a.trim()
  if (!s) return null
  return /^0x[0-9a-fA-F]+$/.test(s) ? s.toLowerCase() : s
}

/** The EVM zero address or the Solana system program: money sent there is gone. */
export function isZeroAddress(a: string | null | undefined): boolean {
  const s = normalizeAddress(a)
  if (!s) return false
  return /^0x0+$/.test(s) || s === '11111111111111111111111111111111'
}

export function normalizeNetwork(n: string | null | undefined): string | null {
  if (!n) return null
  const s = n.trim().toLowerCase()
  const map: Record<string, string> = {
    base: 'eip155:8453',
    'base-mainnet': 'eip155:8453',
    'base-sepolia': 'eip155:84532',
    polygon: 'eip155:137',
    avalanche: 'eip155:43114',
    bsc: 'eip155:56',
    bnb: 'eip155:56',
    kite: 'eip155:2366',
    tempo: 'tempo:4217',
    '4217': 'tempo:4217',
    'solana-mainnet': 'solana',
  }
  if (map[s]) return map[s]!
  if (s.startsWith('solana:5eykt4usfv8p8njdtrepy1vzqkqzkvdp')) return 'solana'
  return s
}

function decimalsFor(asset: string | null, network: string | null, extra: unknown): { decimals: number | null; from: ChallengeOffer['decimalsFrom'] } {
  const a = (asset ?? '').toLowerCase()
  const n = (network ?? '').toLowerCase()
  if (SIX_DECIMAL_ASSETS.has(a)) return { decimals: 6, from: 'known_asset' }
  if (EIGHTEEN_DECIMAL_ASSETS.has(a)) return { decimals: 18, from: 'known_asset' }
  if (SEVEN_DECIMAL_ASSETS.has(a)) return { decimals: 7, from: 'known_asset' }
  if (n === 'stripe' || n.startsWith('stripe') || a === 'usd') return { decimals: 2, from: 'cents' }
  const said = extra && typeof extra === 'object' ? (extra as Record<string, unknown>).decimals : undefined
  const d = typeof said === 'number' ? said : typeof said === 'string' && /^\d+$/.test(said) ? Number(said) : null
  // Unknown asset: never trust more than 6 decimals from the seller (more decimals = a smaller-looking price).
  if (d != null && Number.isInteger(d) && d >= 0 && d < 6) return { decimals: d, from: 'seller_said_fewer' }
  return { decimals: 6, from: 'assumed_6' }
}

export function offerFromRaw(a: Record<string, unknown>): ChallengeOffer {
  const scheme = str(a.scheme)
  const network = str(a.network)
  const asset = str(a.asset)
  const payTo = str(a.payTo) ?? str(a.recipient)
  // v2 "amount"; v1 "maxAmountRequired". For "upto" both are the most the seller may take.
  const amountRaw = str(a.amount) ?? str(a.maxAmountRequired) ?? str(a.maxAmount)
  const variable = (scheme ?? '').toLowerCase() === 'upto'
  const resourceHost = hostOf(a.resource)
  if (amountRaw == null) return { scheme, network, asset, payTo, amountRaw, amountUsd: null, decimals: null, decimalsFrom: 'unreadable', variable, resourceHost }
  if (!/^\d+$/.test(amountRaw)) {
    const n = Number(amountRaw)
    return { scheme, network, asset, payTo, amountRaw, amountUsd: Number.isFinite(n) && n >= 0 ? n : null, decimals: null, decimalsFrom: Number.isFinite(n) ? 'decimal_string' : 'unreadable', variable, resourceHost }
  }
  const { decimals, from } = decimalsFor(asset, network, a.extra)
  const usd = decimals == null ? null : atomicToDecimal(amountRaw, decimals)
  return { scheme, network, asset, payTo, amountRaw, amountUsd: usd, decimals, decimalsFrom: from, variable, resourceHost }
}

/** Exact-enough conversion of an integer string with `decimals` places (BigInt so 18-decimal amounts stay exact). */
export function atomicToDecimal(raw: string, decimals: number): number {
  const big = BigInt(raw)
  const unit = 10n ** BigInt(decimals)
  const whole = big / unit
  const frac = big % unit
  return Number(whole) + Number(frac) / Number(unit)
}

/** Every offer of a decoded x402 payment request (the `raw` from parsePaymentRequest). */
export function challengeFromRaw(raw: Record<string, unknown> | null | undefined): Challenge {
  const accepts = raw && Array.isArray(raw.accepts) ? (raw.accepts as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
  const offers = accepts.slice(0, 20).map(offerFromRaw)
  const hosts = new Set<string>()
  const top = raw ? hostOf(raw.resource) : null
  if (top) hosts.add(top)
  for (const o of offers) if (o.resourceHost) hosts.add(o.resourceHost)
  const amounts = offers.map((o) => o.amountUsd).filter((n): n is number => n != null && Number.isFinite(n))
  return { offers, resourceHosts: [...hosts], maxUsd: amounts.length ? Math.max(...amounts) : null }
}
