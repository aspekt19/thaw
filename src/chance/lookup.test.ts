import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lookupFirstHop, tronPace } from './lookup.ts'

describe('tron lookup', () => {
  it('retries 429 without an API key and keeps the hop amount and time', async () => {
    const saved = { gapMs: tronPace.gapMs, backoffMs: [...tronPace.backoffMs] }
    tronPace.gapMs = 0
    tronPace.backoffMs = [0, 0]
    const tx = 'ab'.repeat(32)
    const sender = `T${'1'.repeat(33)}`
    const receiver = `T${'2'.repeat(33)}`
    const hop = `T${'3'.repeat(33)}`
    const calls: string[] = []
    let events = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      assert.equal((init?.headers as Headers | undefined)?.get('TRON-PRO-API-KEY') ?? null, null)
      if (url.includes('/events')) {
        events += 1
        if (events === 1) return new Response('{}', { status: 429 })
        return Response.json({
          data: [{
            event_name: 'Transfer',
            transaction_id: tx,
            block_timestamp: Date.parse('2026-06-02T00:00:00Z'),
            contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            result: { from: sender, to: receiver, value: '328200000' },
          }],
        })
      }
      if (url.includes(receiver)) return Response.json({ data: [] })
      return Response.json({
        data: [{
          transaction_id: 'cd'.repeat(32),
          from: hop,
          to: sender,
          value: '9000000',
          type: 'Transfer',
          block_timestamp: Date.parse('2026-05-20T00:00:00Z'),
          token_info: { symbol: 'USDT', decimals: 6, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
        }],
      })
    }
    try {
      const hopResult = await lookupFirstHop({ chain: 'tron', deposit: tx, amount: '328.2', asset: 'USDT', date: '2026-06-02' }, fetchImpl, {})
      assert.equal(hopResult.firstHopOk, true)
      assert.equal(hopResult.sender, sender)
      assert.equal(hopResult.depositRaw, '328200000')
      assert.equal(hopResult.depositTimeMs, Date.parse('2026-06-02T00:00:00Z'))
      assert.equal(hopResult.hopTransfers[0]?.address, hop)
      assert.equal(hopResult.hopTransfers[0]?.raw, '9000000')
      assert.equal(hopResult.hopTransfers[0]?.timeMs, Date.parse('2026-05-20T00:00:00Z'))
      assert.ok(calls.filter((url) => url.includes('/events')).length >= 2)
    } finally {
      tronPace.gapMs = saved.gapMs
      tronPace.backoffMs = saved.backoffMs
    }
  })
})
