/**
 * In-memory daily spend ledger from AllowLatch src/guard/store.ts (MemoryKv and reserveSpendWithin)
 * at f33257df64e1600c61185ab1a2835e3b9e58f536.
 * Not copied: the Turso backend and the locked JSON-file backend.
 */

export class GuardStoreError extends Error {}

export type SpendLimits = {
  dailyUsd: number
  endpointDailyUsd?: number | null
}

export type SpendTotals = { totalUsd: number; byEndpoint: Record<string, number> }

export type ReserveResult = { ok: true } | { ok: false; rule: 'over_daily' | 'over_endpoint_daily'; spent: SpendTotals }

export type SpendRow = {
  id: string
  owner: string
  day: string
  endpoint: string
  seller: string
  amountUsd: number
  status: 'reserved' | 'paid' | 'released' | 'unknown'
  at: number
}

const EPS = 1e-9

function totalsOf(rows: SpendRow[], excludeId?: string): SpendTotals {
  const byEndpoint: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    if (r.status === 'released' || r.id === excludeId) continue
    total += r.amountUsd
    byEndpoint[r.endpoint] = (byEndpoint[r.endpoint] ?? 0) + r.amountUsd
  }
  for (const k of Object.keys(byEndpoint)) byEndpoint[k] = Math.round(byEndpoint[k]! * 1e6) / 1e6
  return { totalUsd: Math.round(total * 1e6) / 1e6, byEndpoint }
}

function wouldExceed(spent: SpendTotals, row: SpendRow, limits: SpendLimits): ReserveResult {
  if (spent.totalUsd + row.amountUsd > limits.dailyUsd + EPS) return { ok: false, rule: 'over_daily', spent }
  if (limits.endpointDailyUsd != null && (spent.byEndpoint[row.endpoint] ?? 0) + row.amountUsd > limits.endpointDailyUsd + EPS)
    return { ok: false, rule: 'over_endpoint_daily', spent }
  return { ok: true }
}

/** Calendar day in Europe/Istanbul (UTC+3, no DST): the daily limit resets at local midnight. */
export function dayKey(at: number = Date.now()): string {
  return new Date(at + 3 * 3600_000).toISOString().slice(0, 10)
}

const spendKey = (owner: string, day: string, id: string) => `${owner}|${day}|${id}`

export class MemorySpendLedger {
  private m = new Map<string, string>()

  private reserveNow(row: SpendRow, limits: SpendLimits): ReserveResult {
    const p = `spend\u0000${row.owner}|${row.day}|`
    const rows: SpendRow[] = []
    for (const [k, v] of this.m) if (k.startsWith(p)) rows.push(JSON.parse(v) as SpendRow)
    const r = wouldExceed(totalsOf(rows, row.id), row, limits)
    if (r.ok) this.m.set(`spend\u0000${spendKey(row.owner, row.day, row.id)}`, JSON.stringify(row))
    return r
  }

  async reserveSpendWithin(
    row: Omit<SpendRow, 'status' | 'day' | 'at'> & { at?: number },
    limits: SpendLimits,
  ): Promise<{ ok: true; row: SpendRow } | { ok: false; rule: 'over_daily' | 'over_endpoint_daily'; spent: SpendTotals }> {
    const at = row.at ?? Date.now()
    const full: SpendRow = { ...row, amountUsd: Math.round(row.amountUsd * 1e6) / 1e6, day: dayKey(at), at, status: 'reserved' }
    const r = this.reserveNow(full, limits)
    return r.ok ? { ok: true, row: full } : r
  }

  async spentToday(owner: string, at: number = Date.now()): Promise<SpendTotals> {
    const day = dayKey(at)
    const p = `spend\u0000${owner}|${day}|`
    const rows: SpendRow[] = []
    for (const [k, v] of this.m) if (k.startsWith(p)) rows.push(JSON.parse(v) as SpendRow)
    return totalsOf(rows)
  }
}
