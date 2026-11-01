import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyDeposit, tronHexToBase58 } from './address.ts'

describe('addresses', () => {
  it('encodes the well-known TRON USDT contract', () => {
    assert.equal(tronHexToBase58('41a614f803b6fd780986a42c78ec9c7f77e6ded13c'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    assert.equal(tronHexToBase58('a614f803b6fd780986a42c78ec9c7f77e6ded13c'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
  })

  it('tells a txid from an address', () => {
    assert.equal(classifyDeposit('tron', 'ab'.repeat(32)), 'tx')
    assert.equal(classifyDeposit('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), 'address')
    assert.equal(classifyDeposit('ethereum', `0x${'ab'.repeat(32)}`), 'tx')
    assert.equal(classifyDeposit('ethereum', `0x${'cd'.repeat(20)}`), 'address')
    assert.equal(classifyDeposit('tron', '0xabc'), null)
  })
})
