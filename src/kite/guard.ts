import { endpointMatches, normalizeEndpoint, parseEndpointPattern } from '@thaw/guard'

/** Five AML sellers from the 2026-11-02 Kite catalog. Prices are not shown in the UI. */
export const AML_ENDPOINTS = [
  { id: 'lionx', method: 'GET', url: 'https://lionx402.com/api/x402/wallet-screen-json' },
  { id: 'anchor', method: 'POST', url: 'https://api.anchor-x402.com/v1/screen' },
  { id: 'eagle', method: 'POST', url: 'https://eagle.quickai.build/check' },
  { id: 'atlas', method: 'GET', url: 'https://wallet-sanctions.use.x402atlas.com/check' },
  { id: 'arkham', method: 'POST', url: 'https://api.arkm.com/x402/intelligence/address' },
] as const

/** Last catalog quotes in USDC micro units, used only to reserve spend before a call. Not for display. */
export const LAST_KNOWN_QUOTE_MICRO: Record<(typeof AML_ENDPOINTS)[number]['id'], number> = {
  lionx: 1_000,
  anchor: 5_000,
  eagle: 5_000,
  atlas: 10_000,
  arkham: 200_000,
}

export const CASE_CAP_MICRO = 3_000_000
export const TX_CAP_MICRO = 250_000
export const DEFAULT_DAILY_CAP_MICRO = 10_000_000

const ALLOWED = AML_ENDPOINTS.map((item) => parseEndpointPattern(`${item.method} ${item.url}`))

export type KiteDeny =
  | 'kite_off'
  | 'session_missing'
  | 'session_expired'
  | 'endpoint_denied'
  | 'price_unknown'
  | 'over_tx_cap'
  | 'over_case_cap'
  | 'over_daily_cap'

export function endpointAllowed(method: string, url: string): boolean {
  const actual = normalizeEndpoint(method, url)
  if (!actual) return false
  return ALLOWED.some((pattern) => (pattern ? endpointMatches(pattern, actual) : false))
}

/**
 * Our guard. Kite sessions only carry a per-payment max, a total, and an expiry.
 * They do not enforce this allowlist, the $3 case cap, or the daily cap.
 * Payment always names a session id. Account allowance is not a path here.
 */
export function assessKitePayment(input: {
  enabled: boolean
  sessionId: string | undefined
  sessionExpiresAt: number | null
  now: number
  method: string
  url: string
  quotedMicro: number | null
  caseSpentMicro: number
  daySpentMicro: number
  dailyCapMicro: number
}): { ok: true } | { ok: false; code: KiteDeny } {
  if (!input.enabled) return { ok: false, code: 'kite_off' }
  if (!input.sessionId?.trim()) return { ok: false, code: 'session_missing' }
  if (input.sessionExpiresAt != null && input.now >= input.sessionExpiresAt) return { ok: false, code: 'session_expired' }
  if (!endpointAllowed(input.method, input.url)) return { ok: false, code: 'endpoint_denied' }
  if (input.quotedMicro == null || !Number.isInteger(input.quotedMicro) || input.quotedMicro < 0) return { ok: false, code: 'price_unknown' }
  if (input.quotedMicro > TX_CAP_MICRO) return { ok: false, code: 'over_tx_cap' }
  if (input.caseSpentMicro + input.quotedMicro > CASE_CAP_MICRO) return { ok: false, code: 'over_case_cap' }
  if (input.daySpentMicro + input.quotedMicro > input.dailyCapMicro) return { ok: false, code: 'over_daily_cap' }
  return { ok: true }
}
