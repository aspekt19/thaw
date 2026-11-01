import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseChanceInput } from './parse.ts'

describe('chance form parse', () => {
  it('does not take an HTX link or a country from the client', () => {
    const parsed = parseChanceInput({
      exchange: 'binance',
      notice: 'please provide source of funds',
      amount: '10',
      asset: 'USDT',
      chain: 'tron',
      deposit: 'aa'.repeat(32),
      date: '2026-11-01',
      origin: 'exchange_purchase',
      htxLinked: true,
      clientCountry: 'DE',
    })
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal('htxLinked' in parsed.value, false)
    assert.equal('clientCountry' in parsed.value, false)
  })
})
