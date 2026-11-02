import type { AddressLabel } from './lookup.ts'

/**
 * Public Tronscan tags. Each address is copied from a page that already prints the tag.
 * These are not deposit instructions.
 */
export const CURATED_LABELS: AddressLabel[] = [
  {
    address: 'TFTWNgDBkQ5wQoP8RXpRznnHvAVV8x5jLu',
    exchange: 'htx',
    name: 'HTX 4',
    // Tronscan prints "HTX 4" on the owner of this transfer.
    source: 'https://tronscan.org/transaction/42ed443cc9408bf12ff036e5176984024a6a871db53b7af51640f9a2dc37e233',
  },
  {
    address: 'TDToUxX8sH4z6moQpK3ZLAN24eupu2ivA4',
    exchange: 'htx',
    name: 'HTX 6',
    // Protos names this wallet as the HTX reserve that received 500M USDT from Tether; Blockworks cites the Tronscan tag "HTX 6".
    source: 'https://protos.com/htx-receives-500m-usdt-infusion-then-sends-it-away/',
  },
  {
    address: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe',
    exchange: 'binance',
    name: 'Binance-Hot 6',
    source: 'https://tronscan.org/data/analytics/account/portrait/TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe',
  },
  {
    address: 'TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf',
    exchange: 'binance',
    name: 'Binance-Hot 7',
    source: 'https://tronscan.org/data/analytics/account/portrait/TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf',
  },
  {
    address: 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G',
    exchange: 'binance',
    name: 'Binance-Hot 4',
    source: 'https://tronscan.org/data/analytics/account/portrait/TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G',
  },
  {
    address: 'TCLgK89AnXbC9rewvhNb9UgXCc2qJJpBXh',
    exchange: 'binance',
    name: 'Binance-Hot 10',
    source: 'https://tronscan.org/transaction/6ecc4d853c85f7294e6da9df88cad6bb3912f845dec2662c1a610125b0b6aa3a',
  },
]

const BY_ADDRESS = new Map(CURATED_LABELS.map((label) => [label.address, label]))

export function curatedLabel(address: string): AddressLabel | null {
  return BY_ADDRESS.get(address) ?? null
}

export function isHtxLabel(label: AddressLabel): boolean {
  return /htx|huobi/i.test(`${label.exchange} ${label.name}`)
}

/** Tronscan's public account endpoint. No key. Returns null when the tag is missing or the call fails. */
export async function tronscanLabel(address: string, fetchImpl: typeof fetch): Promise<AddressLabel | null> {
  if (!address.startsWith('T')) return null
  try {
    const response = await fetchImpl(`https://apilist.tronscan.org/api/account?address=${address}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { addressTag?: unknown }
    const tag = typeof body.addressTag === 'string' ? body.addressTag.trim() : ''
    if (!tag) return null
    const exchange = /htx|huobi/i.test(tag) ? 'htx' : /binance/i.test(tag) ? 'binance' : /bybit/i.test(tag) ? 'bybit' : /okx|okex/i.test(tag) ? 'okx' : 'other'
    return { address, exchange, name: tag, source: 'https://apilist.tronscan.org/api/account' }
  } catch {
    return null
  }
}
