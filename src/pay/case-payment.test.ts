import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { consumePayment, getCase, insertOrder } from '../db/d1-store.ts'
import { migrationSql } from '../db/sql.ts'
import { sqliteDb } from '../db/sqlite.ts'
import { handleApi, type Env } from '../worker.ts'
import { USDC_CONTRACT } from './usdc.ts'

const RECIPIENT = `0x${'11'.repeat(20)}`
const FROM = `0x${'22'.repeat(20)}`
const TOKEN = USDC_CONTRACT.base
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const CASE_TX = `0x${'cd'.repeat(32)}`

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

function pad(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`
}

function receipt(amount: bigint, opts?: { to?: string; token?: string; status?: string }) {
  return {
    status: opts?.status ?? '0x1',
    blockNumber: '0x10',
    logs: [
      {
        address: opts?.token ?? TOKEN,
        topics: [TOPIC, pad(FROM), pad(opts?.to ?? RECIPIENT)],
        data: `0x${amount.toString(16).padStart(64, '0')}`,
      },
    ],
  }
}

function env(db: ReturnType<typeof sqliteDb>): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('no', { status: 404 }) },
    THAW_USDC_ADDRESS: RECIPIENT,
    THAW_CHECK_PRICE_USD: '1.00',
    THAW_PAYMENT_CHAIN: 'base',
    THAW_PAYMENT_CONFIRMATIONS: '1',
    THAW_CASE_LIGHT_USD: '49',
    THAW_CASE_FULL_USD: '79',
    THAW_RPC_URL_BASE: 'https://rpc.test/base',
  }
}

async function withRpc(impl: typeof fetch, run: () => Promise<void>): Promise<void> {
  const previous = globalThis.fetch
  globalThis.fetch = impl
  try {
    await run()
  } finally {
    globalThis.fetch = previous
  }
}

async function seedPaid(db: ReturnType<typeof sqliteDb>, id: string, verdict: string, feeMicro = 1_000_000) {
  const tag = createHash('sha256').update(id).digest('hex').slice(0, 12)
  assert.equal(
    await insertOrder(db, {
      id,
      created_at: 1_000,
      chain: 'base',
      amount_atomic: `${1_000_000 + Number.parseInt(tag.slice(0, 4), 16)}`,
      price_micro: 1_000_000,
      status: 'pending',
      input_json: JSON.stringify(input),
      client_key: '203.0.113.8|browser',
    }),
    true,
  )
  assert.equal(
    await consumePayment(db, {
      chain: 'base',
      txHash: `0x${'ab'.repeat(26)}${tag}`,
      orderId: id,
      resultJson: JSON.stringify({ ok: true, verdict, reasons: [`${verdict} reason`] }),
      feeMicro,
    }),
    true,
  )
}

function rpcFetch(bodyFor: (method: string, tx: string) => unknown): typeof fetch {
  return async (_url, init) => {
    const payload = JSON.parse(String(init?.body)) as { method: string; params?: string[] }
    const result = bodyFor(payload.method, payload.params?.[0] ?? '')
    return Response.json({ jsonrpc: '2.0', id: 1, result })
  }
}

describe('case remainder payment', () => {
  it('invoices the remainder and marks the case paid only after the transfer matches', async () => {
    const db = sqliteDb(migrationSql())
    await seedPaid(db, 'order-high', 'high')
    let seenAmount = 0n
    const fetchImpl = rpcFetch((method, tx) => {
      if (method === 'eth_blockNumber') return '0x10'
      if (tx === CASE_TX) return receipt(seenAmount)
      return null
    })
    const opened = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-high', tier: 'light' }) }), env(db))
    assert.equal(opened?.status, 201)
    const invoice = (await opened!.json()) as {
      caseId: string
      paid: boolean
      status: string
      netMicro: number
      feeCreditMicro: number
      amountAtomic: string
      amountUsd: string
      chain: string
      token: string
    }
    assert.equal(invoice.paid, false)
    assert.equal(invoice.status, 'awaiting_payment')
    assert.equal(invoice.feeCreditMicro, 1_000_000)
    assert.equal(invoice.netMicro, 48_000_000)
    const atomic = BigInt(invoice.amountAtomic)
    assert.ok(atomic > 48_000_000n && atomic <= 48_099_999n)
    assert.equal(invoice.amountUsd, (Number(atomic) / 1_000_000).toFixed(6))
    assert.equal(invoice.chain, 'base')
    assert.equal(invoice.token, TOKEN)
    seenAmount = atomic

    const pending = await handleApi(new Request(`http://thaw.test/api/cases/${invoice.caseId}`), env(db))
    assert.equal(((await pending!.json()) as { status: string }).status, 'awaiting_payment')

    const ask = async (impl: typeof fetch) => {
      const box: { response: Response | null } = { response: null }
      await withRpc(impl, async () => {
        box.response = await handleApi(
          new Request(`http://thaw.test/api/cases/${invoice.caseId}/confirm`, { method: 'POST', body: JSON.stringify({ txHash: CASE_TX }) }),
          env(db),
        )
      })
      return box.response
    }
    const short = await ask(rpcFetch((method) => (method === 'eth_blockNumber' ? '0x10' : receipt(atomic - 1n))))
    assert.equal(short?.status, 402)
    assert.equal(((await short!.json()) as { code: string }).code, 'wrong_amount')

    const other = await ask(rpcFetch((method) => (method === 'eth_blockNumber' ? '0x10' : receipt(atomic, { to: `0x${'33'.repeat(20)}` }))))
    assert.equal(((await other!.json()) as { code: string }).code, 'wrong_recipient')

    const wrongToken = await ask(rpcFetch((method) => (method === 'eth_blockNumber' ? '0x10' : receipt(atomic, { token: `0x${'44'.repeat(20)}` }))))
    assert.equal(((await wrongToken!.json()) as { code: string }).code, 'wrong_token')

    const paid = await ask(fetchImpl)
    assert.equal(paid?.status, 200)
    const done = (await paid!.json()) as { paid: boolean; status: string }
    assert.equal(done.paid, true)
    assert.equal(done.status, 'paid')
    assert.equal((await getCase(db, invoice.caseId))?.tx_hash, CASE_TX)
  })

  it('refuses a transfer that already paid the check, and blocks low or stopped checks', async () => {
    const db = sqliteDb(migrationSql())
    await seedPaid(db, 'order-med', 'medium')
    const used = await db.prepare('SELECT tx_hash FROM used_transfers').all<{ tx_hash: string }>()
    const reused = used.results[0]?.tx_hash
    assert.ok(reused)

    const opened = await handleApi(new Request('http://thaw.test/v1/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-med', tier: 'full' }) }), env(db))
    const invoice = (await opened!.json()) as { caseId: string; netMicro: number; amountAtomic: string }
    assert.equal(invoice.netMicro, 78_000_000)
    const atomic = BigInt(invoice.amountAtomic)
    const box: { response: Response | null } = { response: null }
    await withRpc(rpcFetch((method) => (method === 'eth_blockNumber' ? '0x12' : receipt(atomic))), async () => {
      box.response = await handleApi(
        new Request(`http://thaw.test/api/cases/${invoice.caseId}/confirm`, { method: 'POST', body: JSON.stringify({ txHash: reused }) }),
        env(db),
      )
    })
    const replay = box.response
    assert.equal(replay?.status, 409)
    assert.equal(((await replay!.json()) as { code: string }).code, 'reused')
    assert.equal((await getCase(db, invoice.caseId))?.status, 'awaiting_payment')

    await seedPaid(db, 'order-low', 'low')
    const blocked = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-low', tier: 'full', userConfirmedLowChance: false }) }), env(db))
    assert.equal(blocked?.status, 403)
    assert.equal(((await blocked!.json()) as { code: string }).code, 'blocked_low_chance')
    const missing = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-low', tier: 'full' }) }), env(db))
    assert.equal(((await missing!.json()) as { code: string }).code, 'blocked_low_chance')
    const openedLow = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-low', tier: 'full', userConfirmedLowChance: true }) }), env(db))
    assert.equal(openedLow?.status, 201)
    const lowBody = (await openedLow!.json()) as { coverNote: string; lowConfirmedAt: number; paid: boolean }
    assert.match(lowBody.coverNote, /falsify/)
    assert.equal(typeof lowBody.lowConfirmedAt, 'number')

    await seedPaid(db, 'order-stop', 'cannot_help')
    const stopped = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-stop', tier: 'full', userConfirmedLowChance: true }) }), env(db))
    assert.equal(stopped?.status, 403)
    assert.equal(((await stopped!.json()) as { code: string }).code, 'verdict')

    const unpaid = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'missing', tier: 'light' }) }), env(db))
    assert.equal(unpaid?.status, 402)
  })

  it('marks a fully credited case paid without a second invoice', async () => {
    const db = sqliteDb(migrationSql())
    await seedPaid(db, 'order-covered', 'high', 49_000_000)
    const opened = await handleApi(new Request('http://thaw.test/api/cases', { method: 'POST', body: JSON.stringify({ orderId: 'order-covered', tier: 'light' }) }), env(db))
    assert.equal(opened?.status, 201)
    const body = (await opened!.json()) as { paid: boolean; amountAtomic: string | null; netMicro: number }
    assert.equal(body.netMicro, 0)
    assert.equal(body.paid, true)
    assert.equal(body.amountAtomic, null)
  })
})
