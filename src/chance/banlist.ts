import { BANLIST_QUOTE_MICRO_USD } from './constants.ts'

/**
 * USDTBanList POST /x402/check.
 * Documented at https://usdtbanlist.com/x402 (read 2026-11-01):
 * body { address }, response data.isBanned.
 * The page does not split sanctions from the Tether blacklist.
 * Payment is not implemented. A 402 is "unpaid", never "clean".
 */

export const BANLIST_CHECK_URL = 'https://mcp.usdtbanlist.com/x402/check'

export type BanHit = {
  status: 'ok' | 'unpaid' | 'unavailable'
  isBanned: boolean | null
}

export interface BanList {
  enabled: boolean
  /** Micro-USD actually reserved per address. Live client is 0: it does not pay. */
  billedMicroPerAddress: number
  /** Published quote per address. 0 when the client is off. */
  quotedMicroPerAddress: number
  check(address: string): Promise<BanHit>
}

export function disabledBanList(): BanList {
  return {
    enabled: false,
    billedMicroPerAddress: 0,
    quotedMicroPerAddress: 0,
    check: async () => {
      throw new Error('ban list is disabled')
    },
  }
}

export function liveBanList(fetchImpl: typeof fetch = fetch): BanList {
  const enabled = process.env.THAW_BANLIST_ENABLED === '1'
  if (!enabled) return disabledBanList()
  return {
    enabled: true,
    billedMicroPerAddress: 0,
    quotedMicroPerAddress: BANLIST_QUOTE_MICRO_USD,
    async check(address) {
      let response: Response
      try {
        response = await fetchImpl(BANLIST_CHECK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ address }),
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        return { status: 'unavailable', isBanned: null }
      }
      if (response.status === 402) return { status: 'unpaid', isBanned: null }
      if (!response.ok) return { status: 'unavailable', isBanned: null }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { status: 'unavailable', isBanned: null }
      }
      return parseBanBody(body)
    },
  }
}

export function parseBanBody(body: unknown): BanHit {
  if (!body || typeof body !== 'object') return { status: 'unavailable', isBanned: null }
  const row = body as Record<string, unknown>
  if (row.success !== true) return { status: 'unavailable', isBanned: null }
  const data = row.data
  if (!data || typeof data !== 'object') return { status: 'unavailable', isBanned: null }
  const isBanned = (data as Record<string, unknown>).isBanned
  if (typeof isBanned !== 'boolean') return { status: 'unavailable', isBanned: null }
  return { status: 'ok', isBanned }
}

export async function screenAddresses(client: BanList, addresses: string[]): Promise<{
  state: 'clean' | 'banned' | 'unpaid' | 'unavailable' | 'not_checked'
  checked: number
}> {
  if (!client.enabled || addresses.length === 0) {
    return { state: 'not_checked', checked: 0 }
  }
  let checked = 0
  for (const address of addresses) {
    const hit = await client.check(address)
    checked += 1
    if (hit.status === 'unpaid') return { state: 'unpaid', checked }
    if (hit.status !== 'ok' || hit.isBanned === null) return { state: 'unavailable', checked }
    if (hit.isBanned) return { state: 'banned', checked }
  }
  return { state: 'clean', checked }
}
