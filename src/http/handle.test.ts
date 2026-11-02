import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleRequest } from './handle.ts'
import { PAID_PATH_PRICE_USD } from '../chance/constants.ts'
import { asAsyncStore, createStore } from '../chance/limits.ts'
import type { ChanceDeps } from '../chance/check.ts'

function deps(): ChanceDeps {
  return {
    now: () => Date.parse('2026-11-01T12:00:00.000Z'),
    fetch: async () => new Response('{}', { status: 500 }),
    serv: null,
    banlist: {
      enabled: false,
      billedMicroPerAddress: 0,
      quotedMicroPerAddress: 0,
      check: async () => {
        throw new Error('off')
      },
    },
    store: asAsyncStore(createStore()),
    limits: { dailyChecks: 3, spendCapMicro: 5_000_000, cacheTtlMs: 1000 },
    captchaRequired: false,
    verifyCaptcha: async () => true,
    paidPathEnabled: false,
    paidPathPriceUsd: PAID_PATH_PRICE_USD,
    id: () => 'id-1',
    burst: () => ({ ok: true }),
  }
}

const body = {
  exchange: 'okx',
  notice: 'source of funds review',
  amount: '10',
  asset: 'USDT',
  chain: 'tron',
  deposit: 'aa'.repeat(32),
  date: '2026-11-01',
  origin: 'unknown',
  priorRefusal: false,
}

describe('HTTP check', () => {
  it('rejects a secret field and accepts a form post', async () => {
    const secret = await handleRequest(
      new Request('http://local/api/check-chance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, privateKey: 'no' }),
      }),
      deps(),
    )
    assert.equal(secret.status, 400)
    const secretBody = (await secret.json()) as { error: string }
    assert.match(secretBody.error, /private key/i)

    const form = new URLSearchParams({
      exchange: 'okx',
      notice: 'source of funds review',
      amount: '10',
      asset: 'USDT',
      chain: 'tron',
      deposit: 'aa'.repeat(32),
      date: '2026-11-01',
      origin: 'unknown',
    })
    const response = await handleRequest(
      new Request('http://local/api/check-chance', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-vercel-forwarded-for': '198.51.100.4',
        },
        body: form,
      }),
      deps(),
    )
    assert.equal(response.status, 200)
    const payload = (await response.json()) as { ok: boolean; verdict: string }
    assert.equal(payload.ok, true)
    assert.equal(payload.verdict, 'medium')
  })

  it('rejects a non-POST', async () => {
    const response = await handleRequest(new Request('http://local/api/check-chance'), deps())
    assert.equal(response.status, 405)
  })
})
