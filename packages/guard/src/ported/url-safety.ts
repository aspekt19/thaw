/**
 * Seller URL and amount sanity checks shared by the check endpoint, the hosted pay path and the local kpass wrapper.
 * Kite's `kpass session execute` forwards http://, file://, ftp://, user:password@ URLs and the cloud metadata address
 * to its backend unchanged, and `kpass wallet send` forwards amounts such as 1e23 or the zero address. AllowLatch
 * refuses all of these in code before anything is called or paid.
 */
/** From AllowLatch src/lib/live-scanner.ts at the same commit. The rest of that scanner is not copied. */
export function isSsrfBlockedHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true
  }
  const m172 = /^172\.(\d+)\./.exec(h)
  if (m172) {
    const second = Number(m172[1])
    if (second >= 16 && second <= 31) return true
  }
  if (/^(fc00:|fd00:|fe80:)/i.test(h)) return true
  return false
}

export type UrlProblem = { code: 'url_invalid' | 'url_not_https' | 'url_has_credentials' | 'url_internal_host' | 'url_bad_port'; message: string }

function ipv4Internal(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 0 || a === 127 || a === 10 || a >= 224) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true
  return false
}

/** True when the host is a private, loopback, link-local (cloud metadata) or otherwise internal address. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h || isSsrfBlockedHost(h) || ipv4Internal(h)) return true
  if (h.includes(':')) return true // IPv6 literals (including ::ffff:-mapped IPv4) are never seller hosts
  if (h.endsWith('.localhost') || h.endsWith('.home.arpa') || h === 'metadata' || h.startsWith('metadata.')) return true
  if (!h.includes('.')) return true // single-label names resolve inside a network only
  return false
}

/** Null when the URL is a plain https address on a public host that a payment may be made to. */
export function sellerUrlProblem(raw: unknown): UrlProblem | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) return { code: 'url_invalid', message: 'The seller URL is missing or too long.' }
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { code: 'url_invalid', message: 'The seller URL could not be read.' }
  }
  if (u.protocol !== 'https:') return { code: 'url_not_https', message: `The seller URL uses ${u.protocol.replace(':', '')}://, not https. Only https sellers are checked or paid.` }
  if (u.username || u.password) return { code: 'url_has_credentials', message: 'The seller URL carries a user name or password. It is refused so no credential is sent with a payment.' }
  if (isInternalHost(u.hostname)) return { code: 'url_internal_host', message: `${u.hostname} is a private or internal address (for example a cloud metadata address). It is never contacted or paid.` }
  if (u.port && u.port !== '443' && Number(u.port) < 1024) return { code: 'url_bad_port', message: `Port ${u.port} is not a web port. It is refused.` }
  return null
}

/** Amount sanity: finite, above zero, at most 100,000 dollars, at most 6 decimals (USDC). */
export function amountProblem(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!/^\d+(\.\d+)?$/.test(s)) return 'The amount must be a plain dollar number such as 0.01 (no exponent, sign, spaces or commas).'
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return 'The amount must be above zero.'
  if (n > 100_000) return 'The amount is over 100,000 dollars, which AllowLatch never checks or pays.'
  if ((s.split('.')[1] ?? '').length > 6) return 'The amount has more than 6 decimals, which USDC cannot pay.'
  return null
}

export function toAmount(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  return Number(typeof v === 'string' ? v.trim() : v)
}
