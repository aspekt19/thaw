import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRpc, rpcUrls } from '../chain/evm-rpc.ts'
import { checkPriceMicro, USDC_CONTRACT, verifyUsdcTransfer } from './usdc.ts'

const RECIPIENT = `0x${'11'.repeat(20)}`
const FROM = `0x${'22'.repeat(20)}`
const TOKEN = USDC_CONTRACT.base
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function pad(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`
}

function receipt(amount: bigint, block = '0x10') {
  return {
    status: '0x1',
    blockNumber: block,
    logs: [
      {
        address: TOKEN,
        topics: [TOPIC, pad(FROM), pad(RECIPIENT)],
        data: `0x${amount.toString(16).padStart(64, '0')}`,
      },
    ],
  }
}

describe('USDC payment check', () => {
  it('refuses a price under 1.00', () => {
    assert.throws(() => checkPriceMicro('0.50'))
    assert.equal(checkPriceMicro('1.00'), 1_000_000)
  })

  it('puts Alchemy ahead of the public Base RPC', () => {
    const urls = rpcUrls('base', { alchemyKey: 'test-key' })
    assert.equal(urls[0], 'https://base-mainnet.g.alchemy.com/v2/test-key')
    assert.equal(urls.at(-1), 'https://mainnet.base.org')
  })

  it('accepts an exact unused transfer and rejects a reused amount', async () => {
    const calls: string[] = []
    const call = async (method: string) => {
      calls.push(method)
      if (method === 'eth_getTransactionReceipt') return receipt(1_000_001n)
      if (method === 'eth_blockNumber') return '0x10'
      throw new Error(method)
    }
    const ok = await verifyUsdcTransfer(call, {
      chain: 'base',
      txHash: `0x${'ab'.repeat(32)}`,
      recipient: RECIPIENT,
      amountAtomic: 1_000_001n,
      minConfirmations: 1,
    })
    assert.equal(ok.ok, true)
    const short = await verifyUsdcTransfer(call, {
      chain: 'base',
      txHash: `0x${'ab'.repeat(32)}`,
      recipient: RECIPIENT,
      amountAtomic: 1_000_001n,
      minConfirmations: 2,
    })
    assert.equal(short.ok, false)
    if (!short.ok) assert.equal(short.reason, 'confirmations')
    assert.deepEqual(calls, ['eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getTransactionReceipt', 'eth_blockNumber'])
  })

  it('falls through to the next RPC when the first one fails', async () => {
    let seen = 0
    const fetchImpl: typeof fetch = async (url) => {
      seen += 1
      if (String(url).includes('alchemy.com')) return new Response('no', { status: 500 })
      return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' })
    }
    const call = createRpc(rpcUrls('base', { alchemyKey: 'k' }), fetchImpl)
    assert.equal(await call('eth_chainId', []), '0x1')
    assert.equal(seen, 2)
  })
})
