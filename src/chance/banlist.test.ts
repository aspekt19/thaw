import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { liveBanList, parseBanBody } from './banlist.ts'

const PREV = process.env.THAW_BANLIST_ENABLED

afterEach(() => {
  if (PREV === undefined) delete process.env.THAW_BANLIST_ENABLED
  else process.env.THAW_BANLIST_ENABLED = PREV
})

describe('USDTBanList adapter', () => {
  it('stays off and does not call the network by default', async () => {
    delete process.env.THAW_BANLIST_ENABLED
    let called = false
    const client = liveBanList(async () => {
      called = true
      return new Response('{}')
    })
    assert.equal(client.enabled, false)
    assert.equal(client.billedMicroPerAddress, 0)
    assert.equal(called, false)
  })

  it('reads isBanned and treats HTTP 402 as unpaid', async () => {
    process.env.THAW_BANLIST_ENABLED = '1'
    const banned = parseBanBody({ success: true, data: { isBanned: true, address: 'T' } })
    assert.deepEqual(banned, { status: 'ok', isBanned: true })
    assert.equal(parseBanBody({ success: true, data: {} }).status, 'unavailable')

    const client = liveBanList(async () => new Response('', { status: 402 }))
    const hit = await client.check('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    assert.equal(hit.status, 'unpaid')
    assert.equal(hit.isBanned, null)
    assert.equal(client.billedMicroPerAddress, 0)
    assert.equal(client.quotedMicroPerAddress, 1_000)
  })
})
