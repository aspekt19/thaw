import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { checkRateLimit, clientIp, clampText, resetRateBuckets } from './abuse.ts'

describe('abuse helpers', () => {
  afterEach(() => resetRateBuckets())

  it('prefers the platform-set forwarded header over a caller-supplied one', () => {
    const ip = clientIp({
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'x-vercel-forwarded-for': '5.6.7.8, 9.9.9.9',
      },
    })
    assert.equal(ip, '5.6.7.8')
  })

  it('blocks the call after the window max', () => {
    assert.equal(checkRateLimit('k', 2).ok, true)
    assert.equal(checkRateLimit('k', 2).ok, true)
    const blocked = checkRateLimit('k', 2)
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.equal(blocked.status, 429)
  })

  it('clamps long text', () => {
    const out = clampText('a'.repeat(8001))
    assert.equal(out.length, 8000)
  })
})
