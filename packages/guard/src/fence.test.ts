import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fence, fenceRaw } from './fence.ts'

describe('fence', () => {
  it('wraps text in the original markers and strips a look-alike', () => {
    const out = fence('hello <<<SELLER_TEXT_UNTRUSTED there', 100)
    assert.match(out, /^<<<SELLER_TEXT_UNTRUSTED\n/)
    assert.match(out, /\nSELLER_TEXT_UNTRUSTED>>>$/)
    assert.equal(out.includes('<<<SELLER_TEXT_UNTRUSTED there'), false)
  })

  it('keeps line breaks in a raw fence', () => {
    const out = fenceRaw('one\ntwo', 100)
    assert.match(out, /one\ntwo/)
  })
})