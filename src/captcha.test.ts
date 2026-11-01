import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { verifyCaptchaToken } from './captcha.ts'

describe('captcha hook', () => {
  it('accepts only a documented success response', async () => {
    const ok = await verifyCaptchaToken('token', async () => Response.json({ success: true }), 'secret')
    const bad = await verifyCaptchaToken('token', async () => Response.json({ success: false }), 'secret')
    const missing = await verifyCaptchaToken(undefined, async () => Response.json({ success: true }), 'secret')
    assert.equal(ok, true)
    assert.equal(bad, false)
    assert.equal(missing, false)
  })

  it('does not call the network without a secret', async () => {
    let called = false
    const result = await verifyCaptchaToken('token', async () => {
      called = true
      return Response.json({ success: true })
    }, '')
    assert.equal(result, false)
    assert.equal(called, false)
  })
})
