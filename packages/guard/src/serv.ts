/**
 * SERV Reasoning client, adapted from allowlatch 0.2.2 dist/llm/serv-reasoning.js.
 * OpenAI-compatible chat completions. The published client used the OpenAI SDK;
 * this file sends the same fields with fetch so tests can inject the call.
 * Private commit f33257d (serv-v3.ts, FAST_REVIEW_MODEL) was not readable.
 * Default model is the one in that published file: gpt-5.4-mini.
 */

export const SERV_BASE_URL = 'https://inference-api.openserv.ai/v1'
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

type Tool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: { type: 'object'; properties: Record<string, unknown> }
  }
}

export type ServMessage = {
  content?: string | null
  refusal?: string | null
}

export type ServResponse = {
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
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

export function buildServTools(opts: ServToolsOptions = {}): Tool[] {
  const tools: Tool[] = []
  if (opts.promptGuard) {
    tools.push({
      type: 'function',
      function: { name: 'serv_prompt_guard' },
    })
  }
  if (opts.shadowAgent) {
    const properties: Record<string, unknown> = {}
    if (opts.shadowAgent.hint) {
      properties.hint = { type: 'string', default: opts.shadowAgent.hint }
    }
    if (opts.shadowAgent.maxIterations != null) {
      properties.max_iterations = {
        type: 'integer',
        default: opts.shadowAgent.maxIterations,
      }
    }
    tools.push({
      type: 'function',
      function: {
        name: 'serv_shadow_agent',
        description: 'Enable SERV shadow-agent validation.',
        ...(Object.keys(properties).length
          ? { parameters: { type: 'object', properties } }
          : {}),
      },
    })
  }
  return tools
}

function usageFromResponse(response: ServResponse): ServUsage | undefined {
  const u = response.usage
  if (!u) return undefined
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
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
  const apiKey = process.env.SERV_API_KEY?.trim()
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

export function createFetchComplete(fetchImpl: typeof fetch = fetch): ServComplete {
  return async (body) => {
    const apiKey = readServApiKey()
    const response = await fetchImpl(`${SERV_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`SERV Reasoning HTTP ${response.status}`)
    }
    return (await response.json()) as ServResponse
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
  const model = resolveModel(params.model)
  const reasoningEffort = resolveEffort(params.reasoningEffort)
  const tools = buildServTools(params.servTools ?? {})
  const started = Date.now()
  const response = await complete({
    model,
    reasoning_effort: reasoningEffort,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    ...(tools.length ? { tools } : {}),
  })
  const text = response.choices?.[0]?.message?.content
  if (!text) throw new Error('Empty response from SERV Reasoning')
  const meta: ServMeta = {
    model: response.model ?? model,
    reasoningEffort,
    finishReason: response.choices?.[0]?.finish_reason,
    usage: usageFromResponse(response),
    latencyMs: Date.now() - started,
    promptVersion: params.promptVersion,
  }
  logMeta('chat', meta)
  return { text, meta }
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
  },
  complete: ServComplete = createFetchComplete(),
): Promise<{ data: T; meta: ServMeta }> {
  const model = resolveModel(params.model)
  const reasoningEffort = resolveEffort(params.reasoningEffort)
  const tools = buildServTools(params.servTools ?? {})
  const started = Date.now()
  const response = await complete({
    model,
    reasoning_effort: reasoningEffort,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: params.schemaName,
        strict: true,
        schema: params.jsonSchema,
      },
    },
    ...(tools.length ? { tools } : {}),
  })
  const choice = response.choices?.[0]
  const finishReason = choice?.finish_reason
  const refusal = choice?.message?.refusal
  if (finishReason === 'length') {
    throw new Error('SERV Reasoning response truncated (finish_reason=length)')
  }
  if (finishReason === 'content_filter') {
    throw new Error('SERV Reasoning blocked by content filter')
  }
  if (refusal) {
    throw new Error(`SERV Reasoning refused: ${refusal}`)
  }
  const text = choice?.message?.content
  if (!text) {
    throw new Error(`Empty structured response from SERV Reasoning (finish_reason=${finishReason ?? 'unknown'})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('SERV Reasoning returned non-JSON structured content')
  }
  const data = params.parse(parsed)
  const meta: ServMeta = {
    model: response.model ?? model,
    reasoningEffort,
    finishReason,
    usage: usageFromResponse(response),
    latencyMs: Date.now() - started,
    promptVersion: params.promptVersion,
  }
  logMeta(`structured:${params.schemaName}`, meta)
  return { data, meta }
}
