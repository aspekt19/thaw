import type { AsyncLimitStore } from '../chance/limits.ts'
import type { SqlDb } from './sql.ts'

export function d1LimitStore(db: SqlDb): AsyncLimitStore {
  return {
    async readCache<T>(key: string, now: number): Promise<T | null> {
      const row = await db.prepare('SELECT body, expires_at FROM chance_cache WHERE cache_key = ?').bind(key).first<{ body: string; expires_at: number }>()
      if (!row) return null
      if (row.expires_at <= now) {
        await db.prepare('DELETE FROM chance_cache WHERE cache_key = ?').bind(key).run()
        return null
      }
      return JSON.parse(row.body) as T
    },
    async writeCache(key, value, now, ttlMs) {
      await db
        .prepare(
          'INSERT INTO chance_cache (cache_key, expires_at, body) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET expires_at = excluded.expires_at, body = excluded.body',
        )
        .bind(key, now + ttlMs, JSON.stringify(value))
        .run()
    },
    async takeUserSlot(key, day, limit) {
      const row = await db
        .prepare(
          'INSERT INTO daily_counters (day, bucket, count) VALUES (?, ?, 1) ON CONFLICT(day, bucket) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count',
        )
        .bind(day, key, limit)
        .first<{ count: number }>()
      return Boolean(row)
    },
    async giveBackSlot(key) {
      const day = key.slice(0, 10)
      await db.prepare('UPDATE daily_counters SET count = count - 1 WHERE day = ? AND bucket = ? AND count > 0').bind(day, key).run()
    },
    async reserveSpend(day, micro, capMicro) {
      if (micro <= 0) return true
      const row = await db
        .prepare(
          'INSERT INTO spend_days (day, micro) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET micro = micro + ? WHERE micro + ? <= ? RETURNING micro',
        )
        .bind(day, micro, micro, micro, capMicro)
        .first<{ micro: number }>()
      return Boolean(row)
    },
  }
}

export type OrderRow = {
  id: string
  created_at: number
  chain: string
  amount_atomic: string
  price_micro: number
  status: string
  input_json: string
  client_key: string
  tx_hash: string | null
  result_json: string | null
  fee_credit_micro: number
}

export async function insertOrder(db: SqlDb, row: Omit<OrderRow, 'tx_hash' | 'result_json' | 'fee_credit_micro'>): Promise<boolean> {
  try {
    await db
      .prepare(
        'INSERT INTO check_orders (id, created_at, chain, amount_atomic, price_micro, status, input_json, client_key, fee_credit_micro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      )
      .bind(row.id, row.created_at, row.chain, row.amount_atomic, row.price_micro, row.status, row.input_json, row.client_key)
      .run()
    return true
  } catch {
    return false
  }
}

/** Replaces the stored check result after the person answers a follow-up on the result screen. */
export async function updatePaidResult(db: SqlDb, orderId: string, resultJson: string): Promise<boolean> {
  const saved = await db
    .prepare("UPDATE check_orders SET result_json = ? WHERE id = ? AND status = 'paid'")
    .bind(resultJson, orderId)
    .run()
  return (saved.meta?.changes ?? 0) > 0
}

export async function getOrder(db: SqlDb, id: string): Promise<OrderRow | null> {
  return db.prepare('SELECT * FROM check_orders WHERE id = ?').bind(id).first<OrderRow>()
}

/** Marks the transfer used and the order paid in one batch. False if the transfer was already used. */
export async function consumePayment(db: SqlDb, args: { chain: string; txHash: string; orderId: string; resultJson: string; feeMicro: number }): Promise<boolean> {
  try {
    await db.batch([
      db.prepare('INSERT INTO used_transfers (chain, tx_hash, order_id) VALUES (?, ?, ?)').bind(args.chain, args.txHash.toLowerCase(), args.orderId),
      db
        .prepare(
          "UPDATE check_orders SET status = 'paid', tx_hash = ?, result_json = ?, fee_credit_micro = ? WHERE id = ? AND status = 'pending'",
        )
        .bind(args.txHash.toLowerCase(), args.resultJson, args.feeMicro, args.orderId),
    ])
    const row = await getOrder(db, args.orderId)
    return row?.status === 'paid'
  } catch {
    return false
  }
}

export type CaseRow = {
  id: string
  order_id: string
  price_micro: number
  fee_credit_micro: number
  net_micro: number
  created_at: number
  status: string
  tier: string | null
  chain: string | null
  amount_atomic: string | null
  tx_hash: string | null
  low_confirmed_at: number | null
  case_token_hash: string | null
  stage: string
  work_json: string | null
}

export async function insertCase(
  db: SqlDb,
  row: { id: string; orderId: string; priceMicro: number; feeCreditMicro: number; netMicro: number; createdAt: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO cases (id, order_id, price_micro, fee_credit_micro, net_micro, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.orderId, row.priceMicro, row.feeCreditMicro, row.netMicro, row.createdAt)
    .run()
}

export async function getCase(db: SqlDb, id: string): Promise<CaseRow | null> {
  return db.prepare('SELECT * FROM cases WHERE id = ?').bind(id).first<CaseRow>()
}

export async function getCaseForOrder(db: SqlDb, orderId: string): Promise<CaseRow | null> {
  return db.prepare('SELECT * FROM cases WHERE order_id = ? ORDER BY created_at DESC').bind(orderId).first<CaseRow>()
}

/** False when the open amount is already taken by another unpaid case. */
export async function insertCaseInvoice(
  db: SqlDb,
  row: {
    id: string
    orderId: string
    tier: string
    priceMicro: number
    feeCreditMicro: number
    netMicro: number
    createdAt: number
    status: 'awaiting_payment' | 'paid'
    chain: string | null
    amountAtomic: string | null
    lowConfirmedAt: number | null
  },
): Promise<boolean> {
  try {
    await db
      .prepare(
        'INSERT INTO cases (id, order_id, price_micro, fee_credit_micro, net_micro, created_at, status, tier, chain, amount_atomic, low_confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        row.id,
        row.orderId,
        row.priceMicro,
        row.feeCreditMicro,
        row.netMicro,
        row.createdAt,
        row.status,
        row.tier,
        row.chain,
        row.amountAtomic,
        row.lowConfirmedAt,
      )
      .run()
    return true
  } catch {
    return false
  }
}

/** Marks the transfer used and the case paid. False if that transfer was already used. */
export async function consumeCasePayment(db: SqlDb, args: { chain: string; txHash: string; orderId: string; caseId: string }): Promise<boolean> {
  try {
    await db.batch([
      db
        .prepare('INSERT INTO used_transfers (chain, tx_hash, order_id, case_id) VALUES (?, ?, ?, ?)')
        .bind(args.chain, args.txHash.toLowerCase(), args.orderId, args.caseId),
      db
        .prepare("UPDATE cases SET status = 'paid', tx_hash = ? WHERE id = ? AND status = 'awaiting_payment'")
        .bind(args.txHash.toLowerCase(), args.caseId),
    ])
    const row = await getCase(db, args.caseId)
    return row?.status === 'paid'
  } catch {
    return false
  }
}

export async function setCaseToken(db: SqlDb, id: string, hash: string): Promise<void> {
  await db.prepare('UPDATE cases SET case_token_hash = ? WHERE id = ? AND case_token_hash IS NULL').bind(hash, id).run()
}

export async function saveCaseWork(db: SqlDb, id: string, stage: string, workJson: string): Promise<void> {
  await db.prepare('UPDATE cases SET stage = ?, work_json = ? WHERE id = ?').bind(stage, workJson, id).run()
}

export async function spentMicro(db: SqlDb, where: { caseId?: string; since?: number }): Promise<number> {
  const row = where.caseId
    ? await db.prepare("SELECT COALESCE(SUM(amount_micro), 0) AS micro FROM case_spend WHERE case_id = ? AND outcome = 'paid'").bind(where.caseId).first<{ micro: number }>()
    : await db.prepare("SELECT COALESCE(SUM(amount_micro), 0) AS micro FROM case_spend WHERE created_at >= ? AND outcome = 'paid'").bind(where.since ?? 0).first<{ micro: number }>()
  return Number(row?.micro ?? 0)
}

export async function insertSpend(db: SqlDb, row: { caseId: string; source: string; endpoint: string; amountMicro: number; idempotencyKey: string; outcome: string; createdAt: number }): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO case_spend (id, case_id, source, endpoint, amount_micro, idempotency_key, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.idempotencyKey, row.caseId, row.source, row.endpoint, row.amountMicro, row.idempotencyKey, row.outcome, row.createdAt)
      .run()
  } catch {
    // The same check was already logged.
  }
}
