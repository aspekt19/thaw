import { createMcpHandler } from 'agents/mcp/server'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Env } from '../worker.ts'
import { earlyToolProblem, mcpDescription, nextActionFor, rpcToolResult, toolError, withCors } from './protocol.ts'

type ToolPayload = { ok?: boolean; code?: string; error?: string; orderId?: string; caseId?: string; caseToken?: string; paid?: boolean; amountAtomic?: string; amountUsd?: string; recipient?: string; stage?: string }

function textResult(payload: ToolPayload, status: number, extra?: Record<string, unknown>) {
  const failed = status >= 400 || payload.ok === false
  const body = {
    ...payload,
    ...extra,
    next_action: failed ? nextActionFor(payload.code) : extra?.next_action,
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    isError: failed,
  }
}

async function callApi(request: Request, env: Env): Promise<{ status: number; payload: ToolPayload }> {
  const { handleApi } = await import('../worker.ts')
  const response = await handleApi(request, env)
  const payload = (response ? await response.json() : { ok: false, code: 'internal', error: 'No API response.' }) as ToolPayload
  return { status: response?.status ?? 500, payload }
}

export type McpCtx = { waitUntil(promise: Promise<unknown>): void }

export function mcpFetch(request: Request, env: Env, ctx: McpCtx): Promise<Response> | Response {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }))
  if (request.method === 'GET' && !request.headers.get('accept')?.includes('text/event-stream')) {
    return withCors(Response.json(mcpDescription(url.origin)))
  }
  if (request.method === 'POST') {
    return request.clone().text().then((body) => {
      const early = earlyToolProblem(body)
      if (early) return rpcToolResult(early.id, early.text, true)
      const paidOff = !/^0x[0-9a-fA-F]{40}$/.test(env.THAW_USDC_ADDRESS?.trim() ?? '')
      if (paidOff && /"name"\s*:\s*"(check_chance|thaw_open_case)"/.test(body)) {
        let id: unknown = null
        try { id = (JSON.parse(body) as { id?: unknown }).id ?? null } catch { id = null }
        return rpcToolResult(id, toolError('payment_disabled', 'This server is not taking USDC yet.', nextActionFor('payment_disabled')), true)
      }
      const handler = createMcpHandler(() => buildServer(env), {
        route: '/mcp',
        corsOptions: {
          origin: '*',
          headers: 'content-type, accept, authorization, x-api-key, x-case-token, mcp-session-id, mcp-protocol-version',
        },
      })
      return Promise.resolve(handler(request, env, ctx as never)).then(withCors)
    })
  }
  const handler = createMcpHandler(() => buildServer(env), { route: '/mcp' })
  return Promise.resolve(handler(request, env, ctx as never)).then(withCors)
}

type ToolArgs = Record<string, unknown>
type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'thaw', version: '0.1.0' })
  const add = server.registerTool.bind(server) as (name: string, config: object, cb: (args: ToolArgs) => Promise<ToolResult>) => void
  add(
    'check_chance',
    {
      description: 'Chance check from $1, credited toward the case. Step 1 omits orderId and returns an invoice. Step 2 sends orderId and txHash. Ask the human before paying. Never promise that the exchange will release the withdrawal.',
      inputSchema: {
        orderId: z.string().optional(),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
        exchange: z.enum(['binance', 'coinbase', 'bybit', 'okx', 'kucoin', 'kraken', 'crypto_com', 'htx', 'other']).optional(),
        notice: z.string().max(8000).optional(),
        amount: z.string().optional(),
        asset: z.string().optional(),
        chain: z.enum(['tron', 'ethereum', 'arbitrum', 'base']).optional(),
        deposit: z.string().optional(),
        date: z.string().optional(),
        origin: z.string().optional(),
        fundsSources: z.array(z.string()).optional(),
        evidence: z.array(z.string()).optional(),
        holdType: z.enum(['aml', 'travel_rule', 'unknown']).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const orderId = typeof args.orderId === 'string' ? args.orderId : ''
      const txHash = typeof args.txHash === 'string' ? args.txHash : ''
      if (orderId && txHash) {
        const { status, payload } = await callApi(new Request(`https://thaw.local/api/check-orders/${orderId}/confirm`, { method: 'POST', body: JSON.stringify({ txHash }) }), env)
        return textResult(payload, status)
      }
      const { status, payload } = await callApi(new Request('https://thaw.local/api/check-orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }), env)
      return textResult(payload, status, { next_action: 'The check is from $1 and is credited toward the case. Pay the amount on the invoice, then call check_chance with orderId and txHash. Ask the human before paying.' })
    },
  )
  add(
    'thaw_open_case',
    {
      description: 'Open a light file at 49 USD or a full file at 79 USD. The paid check is credited. Ask your human before paying. Never set userConfirmedLowChance without their explicit yes. Step 2 sends caseId and txHash.',
      inputSchema: {
        orderId: z.string(),
        tier: z.enum(['light', 'full']),
        userConfirmedLowChance: z.boolean().optional(),
        caseId: z.string().optional(),
        txHash: z.string().optional(),
        caseToken: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const caseId = typeof args.caseId === 'string' ? args.caseId : ''
      const txHash = typeof args.txHash === 'string' ? args.txHash : ''
      const caseToken = typeof args.caseToken === 'string' ? args.caseToken : ''
      if (caseId && txHash) {
        const headers = new Headers({ 'content-type': 'application/json' })
        if (caseToken) headers.set('authorization', `Bearer ${caseToken}`)
        const { status, payload } = await callApi(new Request(`https://thaw.local/api/cases/${caseId}/confirm`, { method: 'POST', headers, body: JSON.stringify({ txHash }) }), env)
        return textResult(payload, status)
      }
      const { status, payload } = await callApi(new Request('https://thaw.local/api/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: args.orderId, tier: args.tier, userConfirmedLowChance: args.userConfirmedLowChance === true }),
      }), env)
      return textResult(payload, status, { next_action: 'Keep the caseToken secret. If a remainder is due, ask the human, send the exact amount, then call thaw_open_case with caseId, txHash, and caseToken.' })
    },
  )
  add(
    'thaw_get_case',
    {
      description: 'Read a case. Requires the caseToken returned when the case was opened. The appeal draft stays hidden until a reviewer marks it ready.',
      inputSchema: { caseId: z.string(), caseToken: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      const caseId = String(args.caseId ?? '')
      const caseToken = String(args.caseToken ?? '')
      const { status, payload } = await callApi(new Request(`https://thaw.local/api/cases/${caseId}`, { headers: { authorization: `Bearer ${caseToken}`, 'x-case-token': caseToken } }), env)
      return textResult(payload, status)
    },
  )
  return server
}
