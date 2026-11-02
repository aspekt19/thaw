/**
 * SERV Reasoning client, adapted from allowlatch 0.2.2 dist/llm/serv-reasoning.js.
 * OpenAI-compatible chat completions. The published client used the OpenAI SDK;
 * this file sends the same fields with fetch so tests can inject the call.
 * Private commit f33257d (serv-v3.ts, FAST_REVIEW_MODEL) was not readable.
 * Default model is the one in that published file: gpt-5.4-mini.
 */

export const SERV_BASE_URL = 'https://inference-api.openserv.ai/v1'
export const SERV_RESPONSES_URL = `${SERV_BASE_URL}/responses`
export const SERV_DEFAULT_MODEL = 'gpt-5.4-mini'

export type ServReasoningEffort = 'none' | 'low' | 'medium' | 'high'

export type ServToolsOptions = {
  promptGuard?: boolean
  shadowAgent?: {
    hint?: string
    maxIterations?: number
  }
}

export type ServUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type ServMeta = {
  model: string
  reasoningEffort?: ServReasoningEffort
  finishReason?: string | null
  usage?: ServUsage
  latencyMs: number
  promptVersion?: string
}

export type ServTool = {
  type: 'function'
  name: string
  description?: string
  parameters?: { type: 'object'; properties: Record<string, unknown>; additionalProperties?: boolean }
}

export type ServMessage = {
  content?: string | null
  refusal?: string | null
}

export type ServResponse = {
  id?: string
  model?: string
  output_text?: string | null
  output?: Array<{
    type?: string
    role?: string
    content?: Array<{ type?: string; text?: string | null; refusal?: string | null }>
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
  choices?: Array<{
    finish_reason?: string | null
    message?: ServMessage
  }>
}

export type ServComplete = (body: Record<string, unknown>) => Promise<ServResponse>

export function resolveModel(model?: string): string {
  return model ?? process.env.SERV_MODEL ?? SERV_DEFAULT_MODEL
}

export function resolveEffort(effort?: ServReasoningEffort | string): ServReasoningEffort {
  const raw = (effort ?? process.env.SERV_REASONING_EFFORT ?? 'low').toString()
  if (raw === 'minimal') return 'low'
  if (raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return 'low'
}

export function buildServTools(opts: ServToolsOptions = {}): ServTool[] {
  const tools: ServTool[] = []
  if (opts.promptGuard) {
    tools.push({ type: 'function', name: 'serv_prompt_guard' })
  }
  if (opts.shadowAgent) {
    const properties: Record<string, unknown> = {}
    if (opts.shadowAgent.hint) properties.hint = { type: 'string', default: opts.shadowAgent.hint }
    if (opts.shadowAgent.maxIterations != null) {
      properties.max_iterations = { type: 'integer', default: opts.shadowAgent.maxIterations }
    }
    tools.push({
      type: 'function',
      name: 'serv_shadow_agent',
      description: 'Enable SERV shadow-agent validation.',
      ...(Object.keys(properties).length ? { parameters: { type: 'object', properties, additionalProperties: false } } : {}),
    })
  }
  return tools
}

/** A graph id from SERV_GRAPH_ID_* wins. The model id is then gr_<id>. Otherwise SERV_MODEL. */
export function servModel(graphEnv?: string): string {
  const graph = graphEnv ? process.env[graphEnv]?.trim() : ''
  if (graph) return graph.startsWith('gr_') ? graph : `gr_${graph}`
  return resolveModel()
}

export function readServText(response: ServResponse): { text: string | null; refusal: string | null; finishReason: string | null } {
  const refusal = response.choices?.[0]?.message?.refusal ?? null
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return { text: response.output_text, refusal, finishReason: response.choices?.[0]?.finish_reason ?? 'stop' }
  }
  const blocks = response.output?.flatMap((item) => item.content ?? []) ?? []
  const refused = blocks.find((block) => block.refusal)
  const textBlock = blocks.find((block) => block.type === 'output_text' && block.text)
  if (textBlock?.text) return { text: textBlock.text, refusal: refused?.refusal ?? refusal, finishReason: 'stop' }
  const legacy = response.choices?.[0]?.message?.content
  return { text: legacy ?? null, refusal: refused?.refusal ?? refusal, finishReason: response.choices?.[0]?.finish_reason ?? null }
}

function usageFromResponse(response: ServResponse): ServUsage | undefined {
  const u = response.usage
  if (!u) return undefined
  return {
    promptTokens: u.input_tokens ?? u.prompt_tokens,
    completionTokens: u.output_tokens ?? u.completion_tokens,
    totalTokens: u.total_tokens,
  }
}

function logMeta(label: string, meta: ServMeta): void {
  if (process.env.SERV_LOG === '0') return
  const parts = [
    `[serv] ${label}`,
    `model=${meta.model}`,
    meta.reasoningEffort ? `effort=${meta.reasoningEffort}` : null,
    meta.promptVersion ? `prompt=${meta.promptVersion}` : null,
    `${meta.latencyMs}ms`,
    meta.usage?.totalTokens != null ? `tokens=${meta.usage.totalTokens}` : null,
    meta.finishReason ? `finish=${meta.finishReason}` : null,
  ].filter(Boolean)
  console.error(parts.join(' '))
}

export function readServApiKey(): string {
  const apiKey = process.env.SERV_API_KEY?.trim() || process.env.OPENSERV_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'SERV_API_KEY is missing. Create a key at https://console.openserv.ai and set it in .env (Reasoning — not Platform).',
    )
  }
  if ([...apiKey].some((c) => c.charCodeAt(0) > 127)) {
    throw new Error('SERV_API_KEY contains non-ASCII characters — check the env value for corruption.')
  }
  return apiKey
}

export function graphTimeoutMs(): number {
  const raw = Number(process.env.SERV_GRAPH_TIMEOUT_MS ?? '30000')
  if (!Number.isFinite(raw)) return 30_000
  return Math.min(45_000, Math.max(5_000, raw))
}

function withContentFilter(tools: ServTool[]): ServTool[] {
  if (tools.some((tool) => tool.name === 'serv_disable_content_filter')) return tools
  return [...tools, { type: 'function', name: 'serv_disable_content_filter' }]
}

/** Graphs are called as model gr_<id>. The working call puts the payload in instructions as JSON. */
export function responsesBody(params: {
  model: string
  system: string
  user: string
  reasoningEffort: ServReasoningEffort
  tools: ServTool[]
  text?: Record<string, unknown>
}): Record<string, unknown> {
  const graph = params.model.startsWith('gr_')
  return {
    model: params.model,
    instructions: graph ? JSON.stringify({ system: params.system, input: params.user }) : params.system,
    input: params.user,
    reasoning: { effort: params.reasoningEffort },
    ...(params.text ? { text: params.text } : {}),
    ...(params.tools.length ? { tools: params.tools } : {}),
  }
}

async function withGraphFallback<T>(model: string, run: (model: string) => Promise<T>): Promise<T> {
  try {
    return await run(model)
  } catch (error) {
    if (!model.startsWith('gr_')) throw error
    const message = error instanceof Error ? error.message : ''
    if (!/HTTP 404|HTTP 502|non-JSON|Empty response|content filter|timed out|Timeout|Abort/i.test(message)) throw error
    return run(resolveModel())
  }
}

export function createFetchComplete(fetchImpl: typeof fetch = fetch): ServComplete {
  return async (body) => {
    const apiKey = readServApiKey()
    const model = typeof body.model === 'string' ? body.model : ''
    const asked = typeof body.timeout_ms === 'number' ? body.timeout_ms : model.startsWith('gr_') ? graphTimeoutMs() : 20_000
    const rest = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'timeout_ms'))
    const response = await fetchImpl(SERV_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(rest),
      signal: AbortSignal.timeout(asked),
    })
    if (!response.ok) {
      throw new Error(`SERV Reasoning HTTP ${response.status}`)
    }
    const parsed = (await response.json()) as ServResponse
    const requestId = response.headers.get('x-openserv-request-id')
    return requestId ? { ...parsed, id: parsed.id ?? requestId } : parsed
  }
}

export async function servChat(
  params: {
    system: string
    user: string
    model?: string
    reasoningEffort?: ServReasoningEffort
    servTools?: ServToolsOptions
    promptVersion?: string
  },
  complete: ServComplete = createFetchComplete(),
): Promise<{ text: string; meta: ServMeta }> {
  const model = params.model ?? servModel()
  const reasoningEffort = resolveEffort(params.reasoningEffort)
  const tools = withContentFilter(buildServTools(params.servTools ?? {}))
  const started = Date.now()
  return withGraphFallback(model, async (chosen) => {
    const response = await complete(responsesBody({ model: chosen, system: params.system, user: params.user, reasoningEffort, tools }))
    const read = readServText(response)
    if (read.refusal) throw new Error(`SERV Reasoning refused: ${read.refusal}`)
    if (!read.text) throw new Error('Empty response from SERV Reasoning')
    const meta: ServMeta = {
      model: response.model ?? chosen,
      reasoningEffort,
      finishReason: read.finishReason,
      usage: usageFromResponse(response),
      latencyMs: Date.now() - started,
      promptVersion: params.promptVersion,
    }
    logMeta('chat', meta)
    return { text: read.text, meta }
  })
}

export async function servStructured<T>(
  params: {
    system: string
    user: string
    schemaName: string
    jsonSchema: Record<string, unknown>
    parse: (value: unknown) => T
    model?: string
    reasoningEffort?: ServReasoningEffort
    servTools?: ServToolsOptions
    promptVersion?: string
    timeoutMs?: number
  },
  complete: ServComplete = createFetchComplete(),
): Promise<{ data: T; meta: ServMeta }> {
  const model = params.model ?? servModel()
  const reasoningEffort = resolveEffort(params.reasoningEffort)
  const tools = withContentFilter(buildServTools(params.servTools ?? {}))
  const started = Date.now()
  const textFormat = {
    format: {
      type: 'json_schema',
      name: params.schemaName,
      strict: true,
      schema: params.jsonSchema,
    },
  }
  return withGraphFallback(model, async (chosen) => {
    const response = await complete({
      ...responsesBody({
        model: chosen,
        system: params.system,
        user: params.user,
        reasoningEffort,
        tools,
        text: textFormat,
      }),
      ...(params.timeoutMs ? { timeout_ms: params.timeoutMs } : {}),
    })
    const read = readServText(response)
    const finishReason = read.finishReason
    if (finishReason === 'length') throw new Error('SERV Reasoning response truncated (finish_reason=length)')
    if (finishReason === 'content_filter') throw new Error('SERV Reasoning blocked by content filter')
    if (read.refusal) throw new Error(`SERV Reasoning refused: ${read.refusal}`)
    const text = read.text
    if (!text) throw new Error(`Empty structured response from SERV Reasoning (finish_reason=${finishReason ?? 'unknown'})`)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('SERV Reasoning returned non-JSON structured content')
    }
    const data = params.parse(parsed)
    const meta: ServMeta = {
      model: response.model ?? chosen,
      reasoningEffort,
      finishReason,
      usage: usageFromResponse(response),
      latencyMs: Date.now() - started,
      promptVersion: params.promptVersion,
    }
    logMeta(`structured:${params.schemaName}`, meta)
    return { data, meta }
  })
}
