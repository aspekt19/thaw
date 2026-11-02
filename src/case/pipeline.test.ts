import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runPaidCase } from './pipeline.ts'
import type { KiteExecutor } from '../kite/executor.ts'
import { migrationSql } from '../db/sql.ts'
import { sqliteDb } from '../db/sqlite.ts'
import { insertSpend, spentMicro } from '../db/d1-store.ts'

describe('paid case pipeline', () => {
  it('pauses AML when the session is missing and does not invent a payment', async () => {
    const work = await runPaidCase(sample(), {
      ...deps(),
      sessionId: undefined,
      executor: { kind: 'mock', async execute() { throw new Error('should not pay') } },
    })
    assert.equal(work.stage, 'waiting_kite')
    assert.equal(work.waitReason, 'session_missing')
    assert.equal(work.screened, 0)
    assert.match(work.trigger.text, /do not promise/i)
  })

  it('stops at the $3 case cap and logs the spend', async () => {
    const db = sqliteDb(migrationSql())
    const paid: KiteExecutor = {
      kind: 'mock',
      async execute() {
        return { ok: true, status: 200, body: { verdict: 'pass' }, amountMicro: 200_000 }
      },
    }
    const work = await runPaidCase(sample(), {
      ...deps(),
      executor: paid,
      caseSpentMicro: 3_000_000,
      recordSpend: (row) => insertSpend(db, row),
    })
    assert.equal(work.stage, 'waiting_kite')
    assert.equal(work.waitReason, 'over_case_cap')
    assert.equal(await spentMicro(db, { caseId: 'case-1' }), 0)
  })
})

function sample() {
  return {
    caseId: 'case-1',
    tier: 'light' as const,
    exchange: 'binance',
    chain: 'ethereum' as const,
    deposit: `0x${'ab'.repeat(32)}`,
    amount: '10.5',
    asset: 'USDT',
    date: '2026-11-01',
    depositTimeMs: Date.parse('2026-11-01T00:00:00Z'),
    transfers: [
      { address: `0x${'11'.repeat(20)}`, raw: '100', timeMs: Date.parse('2026-10-20T00:00:00Z'), chain: 'ethereum' as const },
    ],
  }
}

function deps() {
  return {
    now: () => Date.parse('2026-11-02T00:00:00Z'),
    kiteEnabled: true,
    sessionId: 'sess-1' as string | undefined,
    sessionExpiresAt: null,
    dailyCapMicro: 10_000_000,
    caseSpentMicro: 0,
    daySpentMicro: 0,
    serv: null,
    recordSpend: async () => undefined,
  }
}
