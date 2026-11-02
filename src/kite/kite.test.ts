import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AML_ENDPOINTS, CASE_CAP_MICRO, TX_CAP_MICRO, assessKitePayment } from './guard.ts'
import { createHttpKiteExecutor, createRunnerExecutor } from './executor.ts'

const lion = AML_ENDPOINTS[0]!

describe('kite session guard', () => {
  const base = {
    enabled: true,
    sessionId: 'sess-1',
    sessionExpiresAt: 2_000,
    now: 1_000,
    method: lion.method,
    url: lion.url,
    quotedMicro: 1_000,
    caseSpentMicro: 0,
    daySpentMicro: 0,
    dailyCapMicro: 10_000_000,
  }

  it('refuses allowance-style calls by requiring a session id', () => {
    assert.equal(assessKitePayment({ ...base, sessionId: '' }).ok, false)
    assert.equal(assessKitePayment({ ...base, sessionId: undefined }).ok, false)
  })

  it('keeps the five endpoints and the case, payment, and daily caps', () => {
    assert.equal(assessKitePayment(base).ok, true)
    assert.equal(assessKitePayment({ ...base, url: 'https://api.arkm.com/x402/transfers' }).ok, false)
    assert.equal(assessKitePayment({ ...base, quotedMicro: TX_CAP_MICRO + 1 }).ok, false)
    assert.equal(assessKitePayment({ ...base, caseSpentMicro: CASE_CAP_MICRO }).ok, false)
    assert.equal(assessKitePayment({ ...base, daySpentMicro: 10_000_000 }).ok, false)
    assert.equal(assessKitePayment({ ...base, now: 2_000 }).ok, false)
    assert.equal(assessKitePayment({ ...base, enabled: false }).ok, false)
  })

  it('does not call the network when HTTP execute is unpublished', async () => {
    const runner = await createRunnerExecutor().execute({ sessionId: 'sess-1', method: 'GET', url: lion.url, idempotencyKey: 'k' })
    assert.equal(runner.ok, false)
    if (!runner.ok) assert.equal(runner.code, 'runner_required')
    let called = 0
    const http = await createHttpKiteExecutor(async () => {
      called += 1
      return new Response('{}')
    }, undefined).execute({ sessionId: 'sess-1', method: 'GET', url: lion.url, idempotencyKey: 'k' })
    assert.equal(called, 0)
    assert.equal(http.ok, false)
  })
})
