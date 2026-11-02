export const MCP_TOOLS = ['check_chance', 'thaw_open_case', 'thaw_get_case'] as const

export type McpToolName = (typeof MCP_TOOLS)[number]

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, x-api-key, x-case-token, mcp-session-id, mcp-protocol-version',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value)
  const type = headers.get('content-type') ?? ''
  if (type.includes('text/event-stream') && !/charset=/i.test(type)) headers.set('content-type', 'text/event-stream; charset=utf-8')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function mcpDescription(origin: string): Record<string, unknown> {
  return {
    name: 'thaw',
    description: 'Document preparation for an exchange hold. The chance check is from $1 and is credited toward the case. A light file is 49 USD and a full file is 79 USD. We do not promise that a withdrawal will be released.',
    transport: 'streamable-http',
    endpoint: `${origin}/mcp`,
    tools: [
      { name: 'check_chance', price: 'from $1, credited toward the case', steps: ['Call without orderId to get an invoice.', 'Pay the amount on the invoice.', 'Call again with orderId and txHash.'] },
      { name: 'thaw_open_case', price: 'Light 49 USD or Full 79 USD, minus the check', steps: ['Ask the human before paying.', 'Call with orderId and tier.', 'Call again with caseId and txHash.'] },
      { name: 'thaw_get_case', auth: 'case token from thaw_open_case, as Authorization Bearer or the caseToken field' },
    ],
  }
}

export function toolError(error: string, hint: string, nextAction: string): string {
  return JSON.stringify({ error, hint, next_action: nextAction })
}

export function nextActionFor(code: string | undefined): string {
  if (code === 'payment_not_configured' || code === 'payment_disabled') return 'Payment is off on this server. Do not send USDC. Ask the operator to turn payment on.'
  if (code === 'payment_required') return 'Create the invoice with check_chance, send the exact amount, then call check_chance again with orderId and txHash.'
  if (code === 'case_token') return 'Call thaw_get_case with the caseToken returned when the case was opened.'
  if (code === 'unpaid') return 'Pay the chance check before opening a case.'
  if (code === 'blocked_low_chance') return 'Ask the human to confirm they still want the file, then set userConfirmedLowChance to true.'
  return 'Read the error and fix the arguments. Do not invent a payment or a promise of release.'
}

/** Reads the JSON-RPC body before the MCP transport so unknown tools fail with a next step. */
export function earlyToolProblem(body: string): { id: unknown; text: string } | null {
  let message: { id?: unknown; method?: string; params?: { name?: string } }
  try {
    message = JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }
  } catch {
    return null
  }
  if (message.method !== 'tools/call') return null
  const name = message.params?.name
  if (typeof name === 'string' && (MCP_TOOLS as readonly string[]).includes(name)) return null
  return {
    id: message.id ?? null,
    text: toolError('unknown_tool', `Unknown tool ${name ?? ''}.`, 'Use check_chance, thaw_open_case, or thaw_get_case.'),
  }
}

export function rpcToolResult(id: unknown, text: string, isError: boolean): Response {
  return withCors(Response.json({
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }], isError },
  }))
}
