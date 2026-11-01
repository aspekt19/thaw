/**
 * Abuse helpers adapted from allowlatch 0.2.2 dist/http/abuse-guard.js
 * (published package, gitHead b191b6ad). Not from private commit f33257d.
 * Origins and env names point at Thaw. The rate-limit window is still 60 seconds.
 * In-memory buckets are per process, same limitation as the original.
 */

export const MAX_BODY_BYTES = 256_000
const MAX_BODY_CHARS = 48_000
const MAX_TEXT_CHARS = 8_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX_DEFAULT = Number(process.env.THAW_BURST_PER_MINUTE || 20)

const buckets = new Map<string, { count: number; resetAt: number }>()

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export function allowedCorsOrigins(): string[] {
  const extra = (process.env.THAW_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set([...DEFAULT_ORIGINS, ...extra])]
}

export function resolveCorsOrigin(requestOrigin: string | undefined | null): string | null {
  if (!requestOrigin) return allowedCorsOrigins()[0] ?? null
  const allowed = allowedCorsOrigins()
  if (allowed.includes(requestOrigin)) return requestOrigin
  return null
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === '127.0.0.1' || h === '::1' || h === 'localhost' || h === '0:0:0:0:0:0:0:1'
}

export function assertJsonBodySize(raw: string, max = MAX_BODY_BYTES): void {
  if (raw.length > max) {
    throw new Error(`Request body too large (max ${max} bytes)`)
  }
}

function firstHeader(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  const raw = headers?.[name]
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  const hop = value.split(',')[0]?.trim()
  return hop || undefined
}

export function clientIp(req: {
  headers?: Record<string, unknown>
  socket?: { remoteAddress?: string }
}): string {
  return (
    firstHeader(req.headers, 'x-vercel-forwarded-for') ||
    firstHeader(req.headers, 'x-real-ip') ||
    firstHeader(req.headers, 'x-forwarded-for') ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}

export function checkOrigin(origin: string | undefined): { ok: true } | { ok: false; status: number; error: string } {
  if (!origin) return { ok: true }
  if (allowedCorsOrigins().includes(origin)) return { ok: true }
  return { ok: false, status: 403, error: 'Origin not allowed' }
}

export function checkRateLimit(
  key: string,
  maxPerWindow = RATE_MAX_DEFAULT,
): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS }
    buckets.set(key, b)
  }
  b.count += 1
  if (b.count > maxPerWindow) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded (${maxPerWindow}/min). Try again shortly.`,
    }
  }
  return { ok: true }
}

export function checkBodySize(body: unknown): { ok: true } | { ok: false; status: number; error: string } {
  let size = 0
  try {
    size = JSON.stringify(body ?? {}).length
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' }
  }
  if (size > MAX_BODY_CHARS) {
    return { ok: false, status: 413, error: `Body too large (max ${MAX_BODY_CHARS} chars)` }
  }
  return { ok: true }
}

export function clampText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text
  return text.slice(0, MAX_TEXT_CHARS)
}

export const ABUSE_LIMITS = {
  MAX_BODY_CHARS,
  MAX_TEXT_CHARS,
  RATE_WINDOW_MS,
  RATE_MAX: RATE_MAX_DEFAULT,
}

/** Test-only. The original module had no reset; Thaw tests need a clean bucket. */
export function resetRateBuckets(): void {
  buckets.clear()
}
