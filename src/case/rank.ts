export const RANK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
export const CHECK_TOP = 20
export const LIGHT_DEEP = 3
export const FULL_DEEP = 10

export type RankedTransfer = {
  address: string
  raw: string
  timeMs: number | null
  chain: 'tron' | 'ethereum' | 'arbitrum' | 'base'
}

export type RankedAddress = RankedTransfer & { deep: boolean; evm: boolean }

export function rankCounterparties(rows: RankedTransfer[], depositTimeMs: number | null, tier: 'light' | 'full'): RankedAddress[] {
  const windowed = rows.filter((row) => {
    if (depositTimeMs == null || row.timeMs == null) return true
    const age = depositTimeMs - row.timeMs
    return age >= 0 && age <= RANK_WINDOW_MS
  })
  const sorted = [...windowed].sort((a, b) => {
    const left = BigInt(a.raw || '0')
    const right = BigInt(b.raw || '0')
    if (left === right) return 0
    return left > right ? -1 : 1
  })
  const seen = new Set<string>()
  const top: RankedTransfer[] = []
  for (const row of sorted) {
    const key = row.chain === 'tron' ? row.address : row.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    top.push(row)
    if (top.length === CHECK_TOP) break
  }
  const deepCount = tier === 'full' ? FULL_DEEP : LIGHT_DEEP
  return top.map((row, index) => ({
    ...row,
    deep: index < deepCount,
    evm: row.chain !== 'tron',
  }))
}
