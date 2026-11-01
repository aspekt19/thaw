/**
 * Payee rule from AllowLatch src/guard/payee.ts at f33257df64e1600c61185ab1a2835e3b9e58f536.
 * The pure check is copied. Not copied: the pin store (src/guard/store.ts) and the observed
 * catalog snapshot (src/guard/payee-seed.ts). Thaw does not ship that snapshot. A caller passes
 * pins it already holds; there is no observed-payee list here.
 */
import { isZeroAddress, normalizeAddress, normalizeNetwork, type Challenge } from './challenge.ts'
import type { GuardPolicy } from './policy.ts'
import type { GuardFinding } from './types.ts'

export const OBSERVED_NOTE =
  'Payees marked "observed" were seen by AllowLatch in its own audit of catalog sellers. They are observed by AllowLatch, not issued by Kite. That snapshot is not included in Thaw.'

export type PayeePin = {
  host: string
  network: string
  asset: string
  payTo: string
  source: 'verified' | 'owner_set' | 'owner_confirmed' | 'observed'
  at: number | string
}

export type PayeeKey = { host: string; network: string; asset: string }

export function normHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, '')
}

export function payeeKey(k: PayeeKey): string {
  return `${normHost(k.host)}|${normalizeNetwork(k.network) ?? ''}|${normalizeAddress(k.asset) ?? ''}`
}

export function siteOf(host: string): string {
  const parts = normHost(host).split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const two = parts.slice(-2)
  if (two[0]!.length <= 3 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'].includes(two[0]!) && two[1]!.length === 2) return parts.slice(-3).join('.')
  return two.join('.')
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

export type PayeeContext = {
  requestHost: string
  challenge: Challenge
  pins: Array<PayeePin | null>
  sharedWith: Record<string, string[]>
}

/** Pure: findings for the payee rule. Copied from checkPayee in src/guard/payee.ts. */
export function checkPayee(ctx: PayeeContext, policy: GuardPolicy): GuardFinding[] {
  const out: GuardFinding[] = []
  const seen = new Set<string>()
  const push = (f: GuardFinding) => {
    const id = `${f.rule}|${f.message}`
    if (!seen.has(id)) {
      seen.add(id)
      out.push(f)
    }
  }
  const host = ctx.requestHost
  for (const rh of ctx.challenge.resourceHosts) {
    if (rh === host) continue
    const allowed = policy.payee.allowHostPairs.some((p) => normHost(p.requested) === host && normHost(p.challenge) === rh)
    if (allowed) push({ rule: 'challenge_host_allowed_by_you', severity: 'warn', by: 'allowlatch', message: `The payment request is for ${rh}, not ${host}; you allowed that pair.` })
    else
      push({
        rule: 'challenge_host_mismatch',
        severity: 'deny',
        by: 'allowlatch',
        message: `You called ${host}, but its payment request says it is for ${rh}. Paying could pay someone else. Not paid.`,
      })
  }
  if (!ctx.challenge.offers.length) push({ rule: 'payee_missing', severity: 'deny', by: 'allowlatch', message: 'The payment request names nobody to pay. Not paid.' })
  ctx.challenge.offers.forEach((o, i) => {
    const payTo = normalizeAddress(o.payTo)
    const where = [o.network, o.asset ? short(o.asset) : null].filter(Boolean).join(', ')
    if (!payTo) {
      push({ rule: 'payee_missing', severity: 'deny', by: 'allowlatch', message: `The payment request${where ? ` (${where})` : ''} names nobody to pay. Not paid.` })
      return
    }
    if (isZeroAddress(payTo)) {
      push({ rule: 'payee_zero_address', severity: 'deny', by: 'allowlatch', message: `The payment request asks to pay the zero address ${short(payTo)}; that money would be gone. Not paid.` })
      return
    }
    const pin = ctx.pins[i] ?? null
    if (pin && pin.payTo !== payTo) {
      const from =
        pin.source === 'observed'
          ? `AllowLatch observed it paying ${short(pin.payTo)} on ${pin.at} (observed by AllowLatch, not issued by Kite)`
          : pin.source === 'owner_set'
            ? `you pinned ${short(pin.payTo)} for it yourself`
            : `${short(pin.payTo)} was pinned for it`
      const hard = pin.source === 'owner_set' || policy.payee.unknownPayee === 'deny'
      push({
        rule: 'payee_changed',
        severity: hard ? 'deny' : 'escalate',
        by: 'allowlatch',
        message: hard
          ? `${host} now asks to be paid at ${short(payTo)} on ${where || 'this network'}, but ${from}. ${pin.source === 'owner_set' ? 'A payee you pinned by hand is never replaced automatically' : 'Your policy refuses changed payees'}. Not paid.`
          : `${host} now asks to be paid at ${short(payTo)} on ${where || 'this network'}, but ${from}.`,
      })
      return
    }
    if (!pin) {
      push({
        rule: 'payee_unknown',
        severity: policy.payee.unknownPayee === 'deny' ? 'deny' : 'escalate',
        by: 'allowlatch',
        message:
          policy.payee.unknownPayee === 'deny'
            ? `${host} asks to be paid at ${short(payTo)} (${where}), a payee not pinned for this seller. Your policy refuses new payees. Not paid.`
            : `${host} asks to be paid at ${short(payTo)} (${where}), a payee AllowLatch has not seen for this seller.`,
      })
    }
    const others = ctx.sharedWith[payTo]
    if (others?.length)
      push({
        rule: 'payee_shared',
        severity: 'warn',
        by: 'allowlatch',
        message: `The same payee ${short(payTo)} also gets paid by ${others.length} unrelated seller${others.length === 1 ? '' : 's'} (${others.slice(0, 3).join(', ')}${others.length > 3 ? ', …' : ''}). That can be one operator or a reseller.`,
      })
  })
  return out
}
