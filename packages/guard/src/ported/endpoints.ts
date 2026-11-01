/**
 * Endpoint identity, the allowlist, the cash-out block list and the signature-window rule.
 * All matching is fail-closed: a URL that cannot be read, or that uses tricks (userinfo, odd ports,
 * plain http), never matches an allow entry.
 */
import type { GuardFinding, Severity } from './types.ts'
import type { GuardPolicy } from './policy.ts'

export type EndpointKey = { method: string; host: string; path: string; segments: string[] }

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/**
 * Normalize "METHOD url" to method + lowercase host (punycode) + path without query, trailing slash or empty segments.
 * Returns null when the URL is not plain https on the default port with no userinfo.
 */
export function normalizeEndpoint(method: string, url: string): EndpointKey | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (u.port && u.port !== '443') return null
  const m = String(method || 'GET').trim().toUpperCase()
  if (!/^[A-Z]{3,7}$/.test(m)) return null
  const segments = u.pathname
    .split('/')
    .filter((s) => s.length > 0)
    .map(decodeSegment)
  if (segments.some((s) => s === '..' || s === '.' || s.includes('/'))) return null
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  return { method: m, host, path: '/' + segments.join('/'), segments }
}

/** Parse an allowlist entry: "METHOD host/path" or "METHOD https://host/path". */
export function parseEndpointPattern(pattern: string): EndpointKey | null {
  const m = /^\s*([A-Za-z]{3,7})\s+(\S+)\s*$/.exec(pattern)
  if (!m) return null
  const target = /^https:\/\//i.test(m[2] as string) ? (m[2] as string) : `https://${m[2]}`
  return normalizeEndpoint(m[1] as string, target)
}

const isParam = (seg: string) => /^:[A-Za-z_][\w-]*$/.test(seg) || /^\{[A-Za-z_][\w-]*\}$/.test(seg)

/** Exact match on method and host; path segments must match exactly except ":param" / "{param}" segments. */
export function endpointMatches(pattern: EndpointKey, actual: EndpointKey, opts: { caseInsensitivePath?: boolean } = {}): boolean {
  if (pattern.method !== actual.method || pattern.host !== actual.host) return false
  if (pattern.segments.length !== actual.segments.length) return false
  return pattern.segments.every((seg, i) => {
    if (isParam(seg)) return (actual.segments[i] as string).length > 0
    return opts.caseInsensitivePath ? seg.toLowerCase() === (actual.segments[i] as string).toLowerCase() : seg === actual.segments[i]
  })
}

export function endpointLabel(k: EndpointKey): string {
  return `${k.method} ${k.host}${k.path}`
}

/* ---------------- cash-out list (Kite catalog, generated 2026-10-30 18:18 Europe/Istanbul) ---------------- */

export type ListedEndpoint = { endpoint: string; seller: string; what: string }

/** Endpoints that turn wallet money into something that can leave: transfers, cards, gift cards, invoices, prepaid tokens. Blocked by default. */
export const CASHOUT_ENDPOINTS: ListedEndpoint[] = [
  { endpoint: 'POST api.bitrefill.com/x402/invoice/pay', seller: 'Bitrefill', what: 'pays an invoice for gift cards, eSIMs or top-ups' },
  { endpoint: 'POST api.bitrefill.com/x402/invoice/create', seller: 'Bitrefill', what: 'creates the invoice that invoice/pay settles' },
  { endpoint: 'GET api.bitrefill.com/x402/invoice/status', seller: 'Bitrefill', what: 'returns redemption codes for bought cards' },
  { endpoint: 'GET laso.finance/send-payment', seller: 'Laso Finance', what: 'sends money by Venmo or PayPal' },
  { endpoint: 'GET laso.finance/send-bank-payment', seller: 'Laso Finance', what: 'sends money to a bank account by ACH' },
  { endpoint: 'GET laso.finance/get-push-to-card', seller: 'Laso Finance', what: 'sends money to a debit card' },
  { endpoint: 'GET laso.finance/order-gift-card', seller: 'Laso Finance', what: 'buys a gift card' },
  { endpoint: 'GET laso.finance/get-card', seller: 'Laso Finance', what: 'issues a prepaid card' },
  { endpoint: 'GET laso.finance/fund-card-balance', seller: 'Laso Finance', what: 'loads a reloadable card' },
  { endpoint: 'GET laso.finance/order-intl-card', seller: 'Laso Finance', what: 'issues an international prepaid card' },
  { endpoint: 'GET laso.finance/auth', seller: 'Laso Finance', what: 'signs in to the Laso payment API' },
  { endpoint: 'GET agi.apify.com/protocols/x402/prepaid-tokens', seller: 'Apify', what: 'buys a prepaid, transferable API token' },
  { endpoint: 'POST agi.apify.com/protocols/mpp/prepaid-tokens', seller: 'Apify', what: 'buys a prepaid, transferable API token' },
]

/** Reads next to cash-out sellers. Not blocked, but flagged. */
export const CASHOUT_ADJACENT: ListedEndpoint[] = [
  { endpoint: 'GET api.bitrefill.com/x402/checkout/info', seller: 'Bitrefill', what: 'checkout info' },
  { endpoint: 'GET api.bitrefill.com/x402/products/detail', seller: 'Bitrefill', what: 'product details' },
  { endpoint: 'GET api.bitrefill.com/x402/gift-cards/search', seller: 'Bitrefill', what: 'gift card search' },
  { endpoint: 'GET api.bitrefill.com/x402/esims/search', seller: 'Bitrefill', what: 'eSIM search' },
  { endpoint: 'GET api.bitrefill.com/x402/topups/search', seller: 'Bitrefill', what: 'top-up search' },
]

/**
 * Endpoints where the caller sets the amount or buys real-world goods or services. Refused automatically unless you
 * listed the endpoint by name in your policy (cashout.allow, with caps) ahead of time. Never a prompt.
 */
export const CONFIRM_ENDPOINTS: Array<ListedEndpoint & { severity: Severity }> = [
  { endpoint: 'POST agents.sayerandstone.com/purchase', seller: 'Sayer & Stone', what: 'buys jewelry; price set per order', severity: 'deny' },
  { endpoint: 'POST postalform.com/api/machine/mpp/orders', seller: 'PostalForm', what: 'prints and mails a letter', severity: 'deny' },
  { endpoint: 'POST api.aidress.ai/pay/agent_agentres_dev', seller: 'Aidress', what: 'pays for a restaurant booking', severity: 'deny' },
  { endpoint: 'POST api.arkm.com/x402/transfers', seller: 'Arkham', what: 'price grows with the limit you ask for', severity: 'deny' },
  { endpoint: 'POST stablephone.dev/api/number/topup', seller: 'StablePhone', what: 'extends a phone number', severity: 'deny' },
  { endpoint: 'POST stableemail.dev/api/inbox/topup', seller: 'StableEmail', what: 'extends an inbox', severity: 'deny' },
  { endpoint: 'POST mcp.yield.xyz/x402/actions_exit', seller: 'Yield.xyz', what: 'builds unsigned exit transactions (moves no money)', severity: 'warn' },
]

/** Catalog endpoints that match cash-out words but were reviewed and do not move money out. */
export const REVIEWED_NOT_CASHOUT: ListedEndpoint[] = [
  { endpoint: 'GET marketdata.use.x402atlas.com/dividends', seller: 'x402atlas', what: 'dividend history ("payout" is a data field)' },
  { endpoint: 'GET hyperliquid-accounts.use.x402atlas.com/state', seller: 'x402atlas', what: 'account state (lists withdrawable balance)' },
  { endpoint: 'GET api.loyalspark.online/x402-gateway/recipient-api/vouchers', seller: 'LoyalSpark', what: 'lists reward vouchers' },
  { endpoint: 'GET api.loyalspark.online/x402-gateway/vouchers', seller: 'LoyalSpark', what: 'lists reward vouchers' },
  { endpoint: 'GET bykaranteli.com/api/x402/networks-history', seller: 'bykaranteli', what: 'network history (withdrawal flags as data)' },
]

/** Words that suggest money leaving the wallet. A match on an endpoint that is on none of the lists above is denied. */
export const CASHOUT_PATTERN =
  /gift[\s_-]?cards?|prepaid|top[\s_-]?ups?|vouchers?|invoice\/pay|venmo|paypal|\bach\b|bank[\s_-]?payments?|push[\s_-]?to[\s_-]?card|off[\s_-]?ramp|payouts?|withdraw(?:al|als|s)?|send[\s_-]?payments?|fund[\s_-]?card/i

const parsed = (list: ListedEndpoint[]) => list.map((e) => ({ ...e, key: parseEndpointPattern(e.endpoint) as EndpointKey }))
const CASHOUT_KEYS = parsed(CASHOUT_ENDPOINTS)
const ADJACENT_KEYS = parsed(CASHOUT_ADJACENT)
const CONFIRM_KEYS = CONFIRM_ENDPOINTS.map((e) => ({ ...e, key: parseEndpointPattern(e.endpoint) as EndpointKey }))
const REVIEWED_KEYS = parsed(REVIEWED_NOT_CASHOUT)

/** Deny lists compare paths case-insensitively and also by host only for method mix-ups, so case or method tricks do not slip past. */
function onList<T extends { key: EndpointKey }>(list: T[], k: EndpointKey): T | undefined {
  return list.find((e) => endpointMatches(e.key, k, { caseInsensitivePath: true }) || (e.key.host === k.host && e.key.path.toLowerCase() === k.path.toLowerCase()))
}

/** The cash-out endpoint you allowed by name that matches this endpoint, with its own caps. */
export function cashoutAllowEntryFor(k: EndpointKey, policy: GuardPolicy): GuardPolicy['cashout']['allow'][number] | undefined {
  return policy.cashout.allow.find((a) => {
    const p = parseEndpointPattern(a.endpoint)
    return p ? endpointMatches(p, k) : false
  })
}

export function checkCashout(
  k: EndpointKey,
  policy: GuardPolicy,
  meta: { summary?: string | null; tags?: string[] | null; amountUsd?: number | null; spentTodayOnEndpointUsd?: number }
): GuardFinding[] {
  const label = endpointLabel(k)
  const allowEntry = cashoutAllowEntryFor(k, policy)
  const listed = onList(CASHOUT_KEYS, k)
  const capCheck = (what: string): GuardFinding[] => {
    if (!allowEntry) return [{ rule: 'cashout_blocked', severity: 'deny', by: 'allowlatch', message: `${label} ${what}. Cash-out endpoints are blocked unless you allow this one by name.` }]
    const amt = meta.amountUsd
    if (amt == null) return [{ rule: 'cashout_price_unknown', severity: 'deny', by: 'allowlatch', message: `${label} is allowed for cash-out, but its price could not be read, so it was not paid.` }]
    if (amt > allowEntry.maxUsdPerPurchase + 1e-9)
      return [{ rule: 'cashout_over_cap', severity: 'deny', by: 'allowlatch', message: `${label} costs $${amt}, over the $${allowEntry.maxUsdPerPurchase} you allowed per purchase for it.` }]
    if ((meta.spentTodayOnEndpointUsd ?? 0) + amt > allowEntry.maxUsdPerDay + 1e-9)
      return [{ rule: 'cashout_over_daily_cap', severity: 'deny', by: 'allowlatch', message: `${label} would pass the $${allowEntry.maxUsdPerDay} a day you allowed for it.` }]
    return [{ rule: 'cashout_allowed_by_you', severity: 'warn', by: 'allowlatch', message: `${label} ${what}. Allowed because you listed it, within your caps.` }]
  }
  if (listed) return capCheck(listed.what)
  if (onList(ADJACENT_KEYS, k)) return [{ rule: 'cashout_adjacent', severity: 'warn', by: 'allowlatch', message: `${label} is a read on a cash-out seller. Allowed; its paid neighbours are blocked.` }]
  const confirm = onList(CONFIRM_KEYS, k)
  if (confirm) {
    if (confirm.severity !== 'deny') return [{ rule: 'real_world_purchase', severity: confirm.severity, by: 'allowlatch', message: `${label} ${confirm.what}.` }]
    if (allowEntry) return capCheck(confirm.what)
    return [
      {
        rule: 'real_world_purchase_blocked',
        severity: 'deny',
        by: 'allowlatch',
        message: `${label} ${confirm.what}. AllowLatch does not buy this on its own; it is paid only if you listed this endpoint by name in your policy, with caps.`,
      },
    ]
  }
  if (onList(REVIEWED_KEYS, k)) return []
  let text = [k.path, meta.summary ?? '', ...(meta.tags ?? [])].join(' ')
  for (const phrase of policy.cashout.notCashout) text = text.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
  const hit = CASHOUT_PATTERN.exec(text)
  if (hit) {
    if (allowEntry) return capCheck(`looks like cash-out ("${hit[0]}")`)
    return [{ rule: 'suspected_cashout', severity: 'deny', by: 'allowlatch', message: `${label} looks like cash-out ("${hit[0]}"). Blocked until you allow it by name.` }]
  }
  return []
}

/* ---------------- allowlist ---------------- */

export function checkAllowlist(k: EndpointKey | null, policy: GuardPolicy, catalog: Array<{ method: string; url: string }>): GuardFinding[] {
  if (!k) return [{ rule: 'endpoint_unreadable', severity: 'deny', by: 'allowlatch', message: 'The seller URL is not plain https on the default port, so it cannot be matched to your allowlist.' }]
  const label = endpointLabel(k)
  if (policy.endpointAllowlist === 'catalog') {
    const inCatalog = catalog.some((c) => {
      const ck = normalizeEndpoint(c.method, c.url)
      return ck ? endpointMatches(ck, k) : false
    })
    return inCatalog ? [] : [{ rule: 'endpoint_not_allowed', severity: 'deny', by: 'allowlatch', message: `${label} is not a Kite catalog endpoint, so it is not on your allowlist.` }]
  }
  const ok = policy.endpointAllowlist.some((p) => {
    const pk = parseEndpointPattern(p)
    return pk ? endpointMatches(pk, k) : false
  })
  return ok ? [] : [{ rule: 'endpoint_not_allowed', severity: 'deny', by: 'allowlatch', message: `${label} is not on your endpoint allowlist.` }]
}

/* ---------------- signature window ---------------- */

/** maxTimeoutSeconds from the 402: how long the signed payment stays valid. Kite signs it; AllowLatch can only warn or refuse. */
export function checkSignatureWindow(seconds: number | null | undefined, policy: GuardPolicy): GuardFinding[] {
  if (seconds == null || !Number.isFinite(seconds)) return []
  if (seconds > 1e9) return [{ rule: 'signature_window_timestamp', severity: 'deny', by: 'allowlatch', message: `The seller asks for a ${seconds} s payment window. That looks like a timestamp, not a duration, so it was refused.` }]
  if (seconds > policy.maxSignatureWindowSec)
    return [
      {
        rule: 'signature_window_long',
        severity: 'deny',
        by: 'allowlatch',
        message: `The signed payment would stay valid for ${seconds} s, over your ${policy.maxSignatureWindowSec} s. Not paid; an equivalent seller is tried instead.`,
      },
    ]
  if (seconds > 600) return [{ rule: 'signature_window_over_10_min', severity: 'warn', by: 'allowlatch', message: `The signed payment stays valid for ${seconds} s (over 10 minutes).` }]
  return []
}
