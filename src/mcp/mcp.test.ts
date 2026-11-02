import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { migrationSql } from '../db/sql.ts'
import { sqliteDb } from '../db/sqlite.ts'
import { mcpFetch } from './server.ts'
import type { Env } from '../worker.ts'

function env(): Env {
  return {
    DB: sqliteDb(migrationSql()),
    ASSETS: { fetch: async () => new Response('no', { status: 404 }) },
    THAW_USDC_ADDRESS: '',
    THAW_CHECK_PRICE_USD: '1.00',
  }
}

const ctx = { waitUntil() {} }

describe('MCP endpoint', () => {
  it('describes the server on GET and rejects an unknown tool before the transport', async () => {
    const described = await mcpFetch(new Request('https://thaw.local/mcp'), env(), ctx)
    assert.equal(described.status, 200)
    const body = (await described.json()) as { tools: Array<{ name: string }> }
    assert.deepEqual(body.tools.map((tool) => tool.name), ['check_chance', 'thaw_open_case', 'thaw_get_case'])
    assert.equal(described.headers.get('access-control-allow-headers')?.includes('x-api-key'), true)

    const unknown = await mcpFetch(new Request('https://thaw.local/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } }),
    }), env(), ctx)
    const error = (await unknown.json()) as { result: { isError: boolean; content: Array<{ text: string }> } }
    assert.equal(error.result.isError, true)
    assert.match(error.result.content[0]?.text ?? '', /unknown_tool/)
    assert.match(error.result.content[0]?.text ?? '', /next_action/)
  })

  it('refuses a paid tool while the USDC address is empty', async () => {
    const response = await mcpFetch(new Request('https://thaw.local/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ignored', 'x-api-key': 'ignored' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_chance', arguments: { notice: 'source of funds' } } }),
    }), env(), ctx)
    const body = (await response.json()) as { result: { isError: boolean; content: Array<{ text: string }> } }
    assert.equal(body.result.isError, true)
    assert.match(body.result.content[0]?.text ?? '', /payment_disabled/)
    assert.match(body.result.content[0]?.text ?? '', /Do not send USDC/)
  })
})
