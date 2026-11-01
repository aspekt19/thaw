/**
 * Steps 3 and 4: check the seller's answer after paying, and fix small flaws without inventing anything.
 * The promised shape comes from the seller's own 402 (bazaar output example or schema, or accepts[].outputSchema),
 * never from the answer itself. With no promise the shape is "unverified" (a warning, not a pass).
 */
import { detectInjection, normalizeUntrusted, parseDirtyNumber, unwrapJsonText } from './text-checks.ts'
import { servInjectionCheck } from '../serv-injection.ts'
import { strictest, type GuardFinding, type ServSignal, type Severity } from './types.ts'

/** From AllowLatch src/guard/reputation.ts. The reputation store itself is not copied. */
export type Outcome =
  | 'pass'
  | 'repaired'
  | 'shape_unverified'
  | 'shape_fail'
  | 'empty'
  | 'http_error'
  | 'injection'
  | 'timeout'
  | 'price_above_catalog'
  | 'payee_changed'
  | 'challenge_host_mismatch'
  | 'payee_unverified'

export type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema | JsonSchema[]
  enum?: unknown[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  [k: string]: unknown
}

export type ExpectedShape = {
  source: 'bazaar_schema' | 'bazaar_example' | 'accepts_output_schema' | null
  schema: JsonSchema | null
  example: unknown
  /** True when the schema has no required fields: almost any object passes it. */
  loose: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function looksLikeSchema(v: unknown): v is JsonSchema {
  return isObj(v) && (typeof v.type === 'string' || Array.isArray(v.type) || isObj(v.properties) || Array.isArray(v.anyOf) || Array.isArray(v.oneOf))
}

/** What the seller promised to return, read from its live 402 payment request. */
export function expectedShapeFrom402(req: Record<string, unknown> | null | undefined): ExpectedShape {
  const none: ExpectedShape = { source: null, schema: null, example: undefined, loose: true }
  if (!isObj(req)) return none
  let schema: JsonSchema | null = null
  let example: unknown = undefined
  let source: ExpectedShape['source'] = null
  const ext = isObj(req.extensions) ? req.extensions : null
  const baz = ext && isObj(ext.bazaar) ? ext.bazaar : null
  if (baz) {
    const out = isObj(baz.info) && isObj(baz.info.output) ? baz.info.output : null
    if (out && 'example' in out && out.example !== undefined && out.example !== null) {
      example = out.example
      source = 'bazaar_example'
    }
    const bs = isObj(baz.schema) && isObj(baz.schema.properties) ? baz.schema.properties.output : null
    const exSchema = isObj(bs) && isObj(bs.properties) ? bs.properties.example : null
    if (looksLikeSchema(exSchema)) {
      schema = exSchema
      source = 'bazaar_schema'
    }
  }
  if (!schema) {
    const accepts = Array.isArray(req.accepts) ? (req.accepts as unknown[]) : []
    for (const a of accepts) {
      if (!isObj(a)) continue
      const os = a.outputSchema
      const cand = isObj(os) && looksLikeSchema(os.output) ? os.output : looksLikeSchema(os) && !('input' in (os as object)) ? os : null
      if (cand) {
        schema = cand as JsonSchema
        source = 'accepts_output_schema'
        break
      }
    }
  }
  if (!schema && example === undefined) return none
  const loose = schema ? !(Array.isArray(schema.required) && schema.required.length > 0) && schema.additionalProperties !== false : false
  return { source, schema, example, loose }
}

/* ---------------- minimal JSON-schema check ---------------- */

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function typeOk(v: unknown, t: string): boolean {
  const actual = typeOf(v)
  if (t === 'number') return actual === 'number' || actual === 'integer'
  return actual === t
}

/** Checks type, required, properties, additionalProperties:false, items, enum, anyOf/oneOf. Unknown keywords pass. */
export function validateSchema(value: unknown, schema: JsonSchema, path = '$', depth = 0, out: string[] = []): string[] {
  if (out.length >= 20 || depth > 12 || !isObj(schema)) return out
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const opts = (schema.anyOf ?? schema.oneOf) as JsonSchema[]
    if (opts.length && !opts.some((s) => validateSchema(value, s, path, depth + 1, []).length === 0)) out.push(`${path} matches none of the promised shapes`)
    return out
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => typeOk(value, t))) {
      out.push(`${path} should be ${types.join(' or ')}, got ${typeOf(value)}`)
      return out
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) out.push(`${path} is not one of the promised values`)
  if (isObj(value)) {
    for (const r of schema.required ?? []) if (!(r in value)) out.push(`${path}.${r} is missing`)
    const props = schema.properties ?? {}
    for (const [k, sub] of Object.entries(props)) if (k in value) validateSchema(value[k], sub, `${path}.${k}`, depth + 1, out)
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) out.push(`${path}.${k} was not promised`)
    }
  } else if (Array.isArray(value) && schema.items && !Array.isArray(schema.items)) {
    value.slice(0, 50).forEach((item, i) => validateSchema(item, schema.items as JsonSchema, `${path}[${i}]`, depth + 1, out))
  }
  return out
}

/** Key paths to depth 3 (array items collapse to []), for comparing an answer to an example. */
export function keyPaths(v: unknown, prefix = '', depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 3) return out
  if (Array.isArray(v)) {
    if (v.length) keyPaths(v[0], `${prefix}[]`, depth + 1, out)
  } else if (isObj(v)) {
    for (const [k, sub] of Object.entries(v)) {
      const p = prefix ? `${prefix}.${k}` : k
      out.add(p)
      keyPaths(sub, p, depth + 1, out)
    }
  }
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/* ---------------- the check ---------------- */

export type ShapeStatus = 'match' | 'mismatch' | 'unverified'

export type ResponseCheck = {
  verdict: Severity
  shape: ShapeStatus
  shapeSource: ExpectedShape['source']
  problems: string[]
  findings: GuardFinding[]
  injection: { local: boolean; serv: ServSignal | null }
  outcome: Outcome
  parsed: unknown
  keyOverlap: number | null
}

function parseBody(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (isObj(v)) return Object.keys(v).length === 0
  return false
}

const ERROR_STATUS = /^(error|fail|failed|failure)$/i

function errorMarker(v: unknown, expected: ExpectedShape): string | null {
  if (!isObj(v)) return null
  const promised = new Set([...(expected.schema?.required ?? []), ...Object.keys(expected.schema?.properties ?? {}), ...(isObj(expected.example) ? Object.keys(expected.example) : [])])
  if (!promised.has('error') && v.error != null && v.error !== false && v.error !== '') return 'answer is an error message'
  if (!promised.has('errors') && Array.isArray(v.errors) && v.errors.length > 0) return 'answer is a list of errors'
  if (!promised.has('success') && v.success === false) return 'answer says success: false'
  if (!promised.has('status') && typeof v.status === 'string' && ERROR_STATUS.test(v.status)) return `answer says status: ${v.status}`
  return null
}

/** Shape-only check (no injection), used before and after repair. */
export function checkShape(value: unknown, expected: ExpectedShape): { shape: ShapeStatus; problems: string[]; overlap: number | null } {
  if (!expected.schema && expected.example === undefined) return { shape: 'unverified', problems: ['the seller published no output example or schema'], overlap: null }
  const problems: string[] = []
  let overlap: number | null = null
  if (expected.schema) problems.push(...validateSchema(value, expected.schema))
  if (expected.example !== undefined && isObj(expected.example) && isObj(value)) {
    const exKeys = keyPaths(expected.example)
    overlap = Math.round(jaccard(exKeys, keyPaths(value)) * 100) / 100
    const missingTop = Object.keys(expected.example).filter((k) => !(k in value))
    // With a schema, the schema decides; with only an example, most of its top-level fields must be there.
    if (!expected.schema && missingTop.length > Object.keys(expected.example).length / 2) problems.push(`missing most promised fields (${missingTop.slice(0, 6).join(', ')})`)
  } else if (!expected.schema && expected.example !== undefined && typeOf(expected.example) !== typeOf(value) && !(typeof expected.example === 'number' && typeof value === 'number')) {
    problems.push(`should be ${typeOf(expected.example)}, got ${typeOf(value)}`)
  }
  return { shape: problems.length ? 'mismatch' : 'match', problems, overlap }
}

export async function checkResponse(args: { httpStatus: number | null; bodyText: string; expected: ExpectedShape; useServ?: boolean }): Promise<ResponseCheck> {
  const findings: GuardFinding[] = []
  const problems: string[] = []
  const text = String(args.bodyText ?? '')
  // Injection is checked on the raw text, so a repair cannot strip it away and pass the answer.
  const local = detectInjection(text, false)
  if (local) findings.push({ rule: 'injection_local', severity: 'deny', by: 'allowlatch', message: 'The answer contains instructions aimed at the agent.' })
  let serv: ServSignal | null = null
  if (args.useServ !== false && text.trim()) {
    serv = await servInjectionCheck(text)
    if (serv.status === 'ok' && serv.verdict !== 'allow') findings.push({ rule: 'injection_serv', severity: serv.verdict, by: 'serv', message: `SERV: ${serv.reason || 'the answer tries to instruct the agent'}` })
  }
  const base = { shapeSource: args.expected.source, injection: { local, serv }, keyOverlap: null as number | null }
  const injected = findings.some((f) => f.rule.startsWith('injection') && f.severity === 'deny')

  if (args.httpStatus != null && (args.httpStatus < 200 || args.httpStatus >= 300)) {
    problems.push(`seller answered HTTP ${args.httpStatus}`)
    findings.push({ rule: 'response_http_error', severity: 'deny', by: 'allowlatch', message: `The seller answered HTTP ${args.httpStatus} instead of the data.` })
    return { ...base, verdict: 'deny', shape: 'mismatch', problems, findings, outcome: injected ? 'injection' : 'http_error', parsed: null }
  }
  const p = parseBody(text.trim())
  const value = p.ok ? p.value : text
  if (!text.trim() || (p.ok && isEmptyValue(p.value))) {
    problems.push('empty answer')
    findings.push({ rule: 'response_empty', severity: 'deny', by: 'allowlatch', message: 'The seller returned an empty answer.' })
    return { ...base, verdict: 'deny', shape: 'mismatch', problems, findings, outcome: 'empty', parsed: value }
  }
  const err = errorMarker(value, args.expected)
  if (err) {
    problems.push(err)
    findings.push({ rule: 'response_error_body', severity: 'deny', by: 'allowlatch', message: `The seller's ${err}.` })
    return { ...base, verdict: 'deny', shape: 'mismatch', problems, findings, outcome: injected ? 'injection' : 'http_error', parsed: value }
  }
  const promisedJson = args.expected.schema != null || (args.expected.example !== undefined && typeof args.expected.example === 'object')
  let shape: ShapeStatus
  let overlap: number | null = null
  if (!p.ok && promisedJson) {
    shape = 'mismatch'
    problems.push('answer is not JSON')
  } else {
    const s = checkShape(value, args.expected)
    shape = s.shape
    overlap = s.overlap
    problems.push(...s.problems)
  }
  if (shape === 'mismatch') findings.push({ rule: 'response_shape_mismatch', severity: 'deny', by: 'allowlatch', message: `The answer does not match what the seller promised: ${problems.slice(0, 4).join('; ')}.` })
  if (shape === 'unverified') findings.push({ rule: 'response_shape_unverified', severity: 'warn', by: 'allowlatch', message: 'The seller published no output example or schema, so the shape could not be checked.' })
  if (shape === 'match' && args.expected.loose) findings.push({ rule: 'response_promise_loose', severity: 'warn', by: 'allowlatch', message: 'The seller’s promised schema has no required fields, so almost any object passes it.' })
  const verdict = strictest(findings.map((f) => f.severity))
  const outcome: Outcome = injected ? 'injection' : shape === 'mismatch' ? 'shape_fail' : shape === 'unverified' ? 'shape_unverified' : 'pass'
  return { ...base, verdict, shape, problems, findings, outcome, parsed: value, keyOverlap: overlap }
}

/* ---------------- step 4: repair without inventing ---------------- */

export type RepairChange = { field: string; before: unknown; after: unknown; rule: string }

function clip(v: unknown): unknown {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s != null && s.length > 200 ? `${s.slice(0, 200)}…` : v
}

function coerce(value: unknown, schema: JsonSchema | undefined, path: string, log: RepairChange[], depth = 0): unknown {
  if (!schema || depth > 10) return value
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : []
  if (types.length && !types.some((t) => typeOk(value, t))) {
    if ((types.includes('number') || types.includes('integer')) && typeof value === 'string') {
      const n = parseDirtyNumber(value, path)
      if (n != null && (!types.includes('integer') || types.includes('number') || Number.isInteger(n))) {
        log.push({ field: path, before: clip(value), after: n, rule: 'number_from_text' })
        return n
      }
    }
    if (types.includes('string') && (typeof value === 'number' || typeof value === 'boolean')) {
      log.push({ field: path, before: value, after: String(value), rule: 'text_from_scalar' })
      return String(value)
    }
    if (types.includes('boolean') && typeof value === 'string' && /^(true|false)$/i.test(value.trim())) {
      const b = value.trim().toLowerCase() === 'true'
      log.push({ field: path, before: value, after: b, rule: 'boolean_from_text' })
      return b
    }
    return value
  }
  if (isObj(value) && schema.properties) {
    const out: Record<string, unknown> = { ...value }
    // Same field under a different letter case: rename, never create.
    for (const k of Object.keys(schema.properties)) {
      if (k in out) continue
      const alt = Object.keys(out).filter((x) => x.toLowerCase().replace(/[_-]/g, '') === k.toLowerCase().replace(/[_-]/g, '') && !(x in (schema.properties as object)))
      if (alt.length === 1) {
        out[k] = out[alt[0] as string]
        delete out[alt[0] as string]
        log.push({ field: `${path}.${k}`, before: `key "${alt[0]}"`, after: `key "${k}"`, rule: 'rename_key_case' })
      }
    }
    for (const [k, sub] of Object.entries(schema.properties)) if (k in out) out[k] = coerce(out[k], sub, `${path}.${k}`, log, depth + 1)
    return out
  }
  if (Array.isArray(value) && schema.items && !Array.isArray(schema.items)) return value.map((x, i) => coerce(x, schema.items as JsonSchema, `${path}[${i}]`, log, depth + 1))
  return value
}

export type RepairResult = { repaired: boolean; bodyText: string; value: unknown; log: RepairChange[] }

/**
 * Fixes only what is already there: JSON wrapped in prose or fences, a single {data: …} envelope, numbers sent as text,
 * key letter case. A missing field stays missing. Returns repaired:false when nothing could be changed.
 */
export function repairResponse(bodyText: string, expected: ExpectedShape): RepairResult {
  const log: RepairChange[] = []
  let text = String(bodyText ?? '')
  let p = parseBody(text.trim())
  if (!p.ok) {
    const u = unwrapJsonText(text)
    if (u.modified) {
      const q = parseBody(u.text)
      if (q.ok) {
        log.push({ field: '$', before: clip(text), after: clip(u.text), rule: `unwrap_json (${u.salvageReasons.join(', ')})` })
        text = u.text
        p = q
      }
    }
  }
  if (!p.ok) return { repaired: false, bodyText: bodyText, value: bodyText, log: [] }
  let value = p.value
  if (expected.schema) {
    if (isObj(value) && Object.keys(value).length === 1) {
      const [k, inner] = Object.entries(value)[0] as [string, unknown]
      const innerFixed = coerce(inner, expected.schema, '$', [])
      if (['data', 'result', 'results', 'response', 'payload'].includes(k) && validateSchema(value, expected.schema).length > 0 && validateSchema(innerFixed, expected.schema).length === 0) {
        log.push({ field: '$', before: `{${k}: …}`, after: '…', rule: 'unwrap_envelope' })
        value = inner
      }
    }
    value = coerce(value, expected.schema, '$', log)
  }
  if (!log.length) return { repaired: false, bodyText, value: p.value, log: [] }
  return { repaired: true, bodyText: JSON.stringify(value), value, log }
}

/** Safe text for logs: never the whole untrusted answer. */
export function previewUntrusted(text: string, n = 160): string {
  return normalizeUntrusted(text).slice(0, n)
}
