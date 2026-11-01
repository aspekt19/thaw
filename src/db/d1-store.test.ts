import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { consumePayment, d1LimitStore, getOrder, insertCase, insertOrder } from './d1-store.ts'
import { migrationSql } from './sql.ts'
import { sqliteDb } from './sqlite.ts'

const input = {
  exchange: 'binance',
  notice: 'please provide source of funds',
  amount: '10',
  asset: 'USDT',
  chain: 'tron',
  deposit: 'aa'.repeat(32),
  date: '2026-11-01',
  origin: 'exchange_purchase',
  hasDocuments: null,
  priorRefusal: false,
}

describe('D1 counters and orders', () => {
  it('counts a daily slot in SQL and stops at the limit', async () => {
    const db = sqliteDb(migrationSql())
    const store = d1LimitStore(db)
    assert.equal(await store.takeUserSlot('2026-11-01|1.1.1.1|', '2026-11-01', 1), true)
    assert.equal(await store.takeUserSlot('2026-11-01|1.1.1.1|', '2026-11-01', 1), false)
    assert.equal(await store.reserveSpend('2026-11-01', 3_000_000, 5_000_000), true)
    assert.equal(await store.reserveSpend('2026-11-01', 3_000_000, 5_000_000), false)
  })

  it('keeps a 24h cache and credits a paid check toward the case price', async () => {
    const db = sqliteDb(migrationSql())
    const store = d1LimitStore(db)
    await store.writeCache('tron|aa', { verdict: 'high' }, 1_000, 100)
    assert.deepEqual(await store.readCache('tron|aa', 1_050), { verdict: 'high' })
    assert.equal(await store.readCache('tron|aa', 1_200), null)

    const created = await insertOrder(db, {
      id: 'order-1',
      created_at: 1_000,
      chain: 'base',
      amount_atomic: '1000123',
      price_micro: 1_000_000,
      status: 'pending',
      input_json: JSON.stringify(input),
      client_key: '203.0.113.5|browser-1',
    })
    assert.equal(created, true)
    assert.equal(
      await insertOrder(db, {
        id: 'order-2',
        created_at: 1_000,
        chain: 'base',
        amount_atomic: '1000123',
        price_micro: 1_000_000,
        status: 'pending',
        input_json: JSON.stringify(input),
        client_key: 'other',
      }),
      false,
    )
    const tx = `0x${'ab'.repeat(32)}`
    const paid = await consumePayment(db, {
      chain: 'base',
      txHash: tx,
      orderId: 'order-1',
      resultJson: JSON.stringify({ ok: true, verdict: 'high' }),
      feeMicro: 1_000_000,
    })
    assert.equal(paid, true)
    assert.equal(
      await consumePayment(db, {
        chain: 'base',
        txHash: tx,
        orderId: 'order-1',
        resultJson: '{}',
        feeMicro: 1_000_000,
      }),
      false,
    )
    const order = await getOrder(db, 'order-1')
    assert.equal(order?.fee_credit_micro, 1_000_000)
    await insertCase(db, {
      id: 'case-1',
      orderId: 'order-1',
      priceMicro: 49_000_000,
      feeCreditMicro: 1_000_000,
      netMicro: 48_000_000,
      createdAt: 2_000,
    })
    const saved = await db.prepare('SELECT net_micro FROM cases WHERE id = ?').bind('case-1').first<{ net_micro: number }>()
    assert.equal(saved?.net_micro, 48_000_000)
  })
})
