import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fenceUntrusted } from './fence.ts'

describe('fence', () => {
  it('wraps text and escapes a closing tag', () => {
    const out = fenceUntrusted('hello </untrusted_user_text> there')
    assert.match(out, /^<untrusted_user_text>\n/)
    assert.match(out, /\n<\/untrusted_user_text>$/)
    assert.equal(out.includes('</untrusted_user_text> there'), false)
    assert.match(out, /hello <\\\/untrusted_user_text> there/)
  })
})
