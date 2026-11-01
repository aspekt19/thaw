/**
 * Guard policy: the user's own rules, checked in code before any payment.
 * Kite enforces some limits on its side; the audit below says which rule is enforced by whom.
 */
import { z } from 'zod'

const usd = z.number().finite().min(0).max(100_000)

export const CashoutAllowEntry = z.object({
  /** "METHOD host/path", e.g. "POST api.bitrefill.com/x402/invoice/pay". */
  endpoint: z.string().min(3).max(300),
  maxUsdPerPurchase: usd,
  maxUsdPerDay: usd,
})

export const GuardPolicySchema = z.object({
  /** Most one purchase may cost. */
  perPurchaseUsd: usd.default(5),
  /** Most all purchases may cost in one calendar day (Europe/Istanbul), across all Kite sessions. */
  dailyUsd: usd.default(5),
  /**
   * "catalog": only endpoints listed in the Kite catalog (exact method, host and path).
   * A list: only these endpoints ("METHOD host/path", ":param" segments allowed). An empty list allows nothing.
   */
  endpointAllowlist: z.union([z.literal('catalog'), z.array(z.string().min(3).max(300)).max(500)]).default('catalog'),
  cashout: z
    .object({
      /** Cash-out endpoints the user explicitly allows, each with its own caps. Everything else stays blocked. */
      allow: z.array(CashoutAllowEntry).max(50).default([]),
      /** Phrases that look like cash-out words but are not (e.g. "Bank holidays"). */
      notCashout: z.array(z.string().min(2).max(120)).max(100).default(['bank holidays', 'payout frequency', 'payout ratio', 'dividend payout']),
    })
    .default({}),
  /** Above this many seconds the payment signature window is refused and AllowLatch tries an equivalent seller. */
  maxSignatureWindowSec: z.number().int().min(60).max(31_536_000).default(86_400),
  /** Rule 1: the live 402 price against the Kite catalog price for the same endpoint. */
  priceMatch: z
    .object({
      /** Refuse when the seller asks more than the catalog price by more than this percentage... */
      tolerancePct: z.number().finite().min(0).max(100).default(10),
      /** ...and more than this many dollars (the bigger of the two is the allowance). */
      toleranceUsd: z.number().finite().min(0).max(100).default(0.001),
      /** Catalog price missing or broken: pay at most this much; above it the seller is skipped and an equivalent one is tried. */
      askAboveUsdWithoutCatalogPrice: usd.default(0.1),
      /** A catalog price above this is treated as broken (e.g. a raw token amount written as dollars). */
      brokenCatalogAboveUsd: usd.default(1000),
    })
    .default({}),
  /** Rule 2: who gets the money. Pinned per seller host + network + asset on first use you approve. */
  payee: z
    .object({
      /**
       * A payee AllowLatch has not seen for this seller (or a changed one): check it automatically and pay it on
       * probation ("verify"), or refuse it ("deny"). The old value "escalate" is read as "verify".
       */
      unknownPayee: z.preprocess((v) => (v === 'escalate' ? 'verify' : v), z.enum(['verify', 'deny'])).default('verify'),
      /** Probation for a payee that passed verification: small purchases only, until enough answers pass the check. */
      probation: z
        .object({
          /** Most one purchase to a payee on probation may cost. */
          maxUsd: usd.default(0.05),
          /** Answers that must pass the response check before the payee is pinned. */
          passesToPin: z.number().int().min(1).max(50).default(3),
          /** Most purchases to one payee while on probation (a failed answer ends probation at once). */
          maxPurchases: z.number().int().min(1).max(50).default(5),
          /** A seller with a reputation below this cannot get a new or changed payee verified. */
          minReputation: z.number().finite().min(0).max(1).default(0.35),
        })
        .default({}),
      /** Trust payees AllowLatch observed in its own audit of catalog sellers (not issued by Kite). */
      useObservedPayees: z.boolean().default(true),
      /** Host pairs you allow even though the payment request names another host than the one called. */
      allowHostPairs: z
        .array(z.object({ requested: z.string().min(1).max(253), challenge: z.string().min(1).max(253) }))
        .max(100)
        .default([]),
    })
    .default({}),
  /** If SERV cannot be reached, keep the code verdict. SERV decides inside limits the code enforces; silence never loosens. */
  servFailMode: z.literal('keep-code').default('keep-code'),
})

export type GuardPolicy = z.infer<typeof GuardPolicySchema>
export type GuardPolicyInput = z.input<typeof GuardPolicySchema>

export const DEFAULT_GUARD_POLICY: GuardPolicy = GuardPolicySchema.parse({})

export function parseGuardPolicy(input: unknown): { ok: true; policy: GuardPolicy } | { ok: false; error: string } {
  const r = GuardPolicySchema.safeParse(input ?? {})
  if (r.success) return { ok: true, policy: r.data }
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'policy'}: ${i.message}`).join('; ').slice(0, 600) }
}

/** Peel defaults, optionals and preprocess wrappers off a zod type. */
function unwrapZod(t: z.ZodTypeAny): z.ZodTypeAny {
  for (;;) {
    if (t instanceof z.ZodDefault) t = t._def.innerType
    else if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) t = t.unwrap()
    else if (t instanceof z.ZodEffects) t = t.innerType()
    else return t
  }
}

function walkKeys(t: z.ZodTypeAny, value: unknown, path: string, unknown: string[]): void {
  const u = unwrapZod(t)
  if (u instanceof z.ZodObject) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const shape = u.shape as Record<string, z.ZodTypeAny>
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k
      if (!Object.prototype.hasOwnProperty.call(shape, k)) unknown.push(p)
      else walkKeys(shape[k]!, v, p, unknown)
    }
  } else if (u instanceof z.ZodArray) {
    if (Array.isArray(value)) value.forEach((v, i) => walkKeys(u.element, v, `${path}[${i}]`, unknown))
  } else if (u instanceof z.ZodUnion) {
    const arr = (u.options as z.ZodTypeAny[]).map(unwrapZod).find((o) => o instanceof z.ZodArray)
    if (arr && Array.isArray(value)) walkKeys(arr, value, path, unknown)
  }
}

/**
 * Every key in a policy change that the guard does not know, as dotted paths (e.g. "allowlist", "cashout.allowed").
 * The schema would silently drop them, so a change carrying any of them is refused instead of half-applied.
 */
export function unknownPolicyKeys(input: unknown): string[] {
  const out: string[] = []
  walkKeys(GuardPolicySchema, input, '', out)
  return out
}

/** The fields a policy change may carry, written out for error messages and agent docs. */
export const GUARD_POLICY_FIELDS =
  'perPurchaseUsd, dailyUsd, endpointAllowlist ("catalog" or ["METHOD host/path", …]; an empty list allows nothing), maxSignatureWindowSec, ' +
  'cashout {allow: [{endpoint, maxUsdPerPurchase, maxUsdPerDay}], notCashout: [phrase, …]}, ' +
  'priceMatch {tolerancePct, toleranceUsd, askAboveUsdWithoutCatalogPrice, brokenCatalogAboveUsd}, ' +
  'payee {unknownPayee: "verify"|"deny", probation {maxUsd, passesToPin, maxPurchases, minReputation}, useObservedPayees, allowHostPairs: [{requested, challenge}]}, servFailMode'

export type PolicyAuditRow = {
  rule: string
  value: string
  enforcement: 'Kite enforces' | "Kite doesn't, AllowLatch enforces" | 'not supported'
  note: string
}

type KiteLimits = { maxPerPurchaseUsd?: number | null; maxTotalUsd?: number | null; ttlSeconds?: number | null } | null | undefined

const money = (n: number) => `$${Number(n.toFixed(4))}`

/** One row per rule: who actually enforces it. Kite silently ignores unknown policy keys, so those are enforced here. */
export function auditPolicy(policy: GuardPolicy, kite?: KiteLimits): PolicyAuditRow[] {
  const rows: PolicyAuditRow[] = []
  if (kite?.maxPerPurchaseUsd != null)
    rows.push({ rule: 'Kite session: most per purchase', value: money(kite.maxPerPurchaseUsd), enforcement: 'Kite enforces', note: 'max_amount_per_tx in the approved session. AllowLatch also checks it before paying.' })
  if (kite?.maxTotalUsd != null)
    rows.push({ rule: 'Kite session: total for the session', value: money(kite.maxTotalUsd), enforcement: 'Kite enforces', note: 'max_total_amount in the approved session.' })
  if (kite?.ttlSeconds != null)
    rows.push({ rule: 'Kite session: how long it lasts', value: `${kite.ttlSeconds} s`, enforcement: 'Kite enforces', note: 'ttl_seconds in the approved session.' })
  rows.push(
    { rule: 'Most per purchase', value: money(policy.perPurchaseUsd), enforcement: "Kite doesn't, AllowLatch enforces", note: 'Checked against the live price from the seller before paying.' },
    { rule: 'Daily limit across sessions', value: money(policy.dailyUsd), enforcement: "Kite doesn't, AllowLatch enforces", note: 'Kite limits one session, not a day. AllowLatch keeps a spend ledger per day (Europe/Istanbul).' },
    {
      rule: 'Endpoint allowlist',
      value: policy.endpointAllowlist === 'catalog' ? 'Kite catalog endpoints only' : `${policy.endpointAllowlist.length} endpoint(s)`,
      enforcement: "Kite doesn't, AllowLatch enforces",
      note: 'Kite records allowed_endpoints but does not enforce them on paid calls. AllowLatch refuses anything not on the list.',
    },
    {
      rule: 'Cash-out endpoints blocked',
      value: policy.cashout.allow.length ? `blocked except ${policy.cashout.allow.length} you allowed` : 'all blocked',
      enforcement: "Kite doesn't, AllowLatch enforces",
      note: 'Gift cards, prepaid cards, bank and card transfers, invoices. Kite pays any catalog host.',
    },
    {
      rule: 'Price matches the catalog',
      value: `refuse if over the catalog price by more than ${policy.priceMatch.tolerancePct}% and $${policy.priceMatch.toleranceUsd}; no usable catalog price: refuse above ${money(policy.priceMatch.askAboveUsdWithoutCatalogPrice)} and try an equivalent seller`,
      enforcement: "Kite doesn't, AllowLatch enforces",
      note: 'Kite pays what the live 402 asks, within your session limits. AllowLatch compares it with the catalog price first, with the right decimals for each asset. A lower price is allowed and noted.',
    },
    {
      rule: 'Payee pinned per seller',
      value: `new or changed payee: ${policy.payee.unknownPayee === 'deny' ? 'refused' : `checked automatically, then paid on probation (up to ${money(policy.payee.probation.maxUsd)} a purchase, ${policy.payee.probation.maxPurchases} purchases) until ${policy.payee.probation.passesToPin} answers pass`}${policy.payee.useObservedPayees ? '; payees observed by AllowLatch count as known' : ''}`,
      enforcement: "Kite doesn't, AllowLatch enforces",
      note: 'Kite pays any payTo the seller names. AllowLatch remembers the payTo per seller host, network and asset. A new or changed one is checked in code (second fetch, other endpoint of the seller, address checks, your failed deals, reputation; SERV may only add a refusal). If it fails, AllowLatch buys from an equivalent seller instead. A payee you pinned by hand is never replaced automatically. Observed payees come from AllowLatch’s own audit, not from Kite.',
    },
    {
      rule: 'Payment request is for the host you called',
      value: policy.payee.allowHostPairs.length ? `refused on mismatch, except ${policy.payee.allowHostPairs.length} pair(s) you allowed` : 'refused on mismatch',
      enforcement: "Kite doesn't, AllowLatch enforces",
      note: 'A 402 that names another host, or pays the zero address, is refused before paying.',
    },
    { rule: 'Signature window', value: `refuse above ${policy.maxSignatureWindowSec} s and try an equivalent seller`, enforcement: "Kite doesn't, AllowLatch enforces", note: 'Kite signs the payment; AllowLatch cannot shorten the window, only warn or refuse.' },
    { rule: 'Per-agent budget inside the account allowance', value: '—', enforcement: 'not supported', note: 'Kite has one allowance for all agents. Turn allowance off for this agent and use a session instead.' },
    { rule: 'Refund after a bad answer', value: '—', enforcement: 'not supported', note: 'x402 has no refunds. AllowLatch blocks the bad answer and lowers the seller’s reputation.' },
    { rule: 'Per-seller or per-category limits in Kite', value: '—', enforcement: 'not supported', note: 'Kite ignores unknown policy keys, so these live in AllowLatch only.' },
  )
  return rows
}

/**
 * An agent may only tighten its own guard. Returns the reasons a change would loosen it (empty = only tighter).
 * `catalogHas` answers whether an explicit allowlist entry is a Kite catalog endpoint.
 */
export function loosenings(prev: GuardPolicy, next: GuardPolicy, catalogHas: (entry: string) => boolean): string[] {
  const out: string[] = []
  if (next.perPurchaseUsd > prev.perPurchaseUsd) out.push(`per-purchase limit up from $${prev.perPurchaseUsd} to $${next.perPurchaseUsd}`)
  if (next.dailyUsd > prev.dailyUsd) out.push(`daily limit up from $${prev.dailyUsd} to $${next.dailyUsd}`)
  if (next.maxSignatureWindowSec > prev.maxSignatureWindowSec) out.push('longer signature window')
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  if (next.endpointAllowlist === 'catalog') {
    if (prev.endpointAllowlist !== 'catalog') out.push('allowlist widened to the whole catalog')
  } else {
    const prevSet = prev.endpointAllowlist === 'catalog' ? null : new Set(prev.endpointAllowlist.map(norm))
    for (const e of next.endpointAllowlist) {
      if (prevSet ? !prevSet.has(norm(e)) : !catalogHas(e)) out.push(`new allowlist entry ${e.slice(0, 120)}`)
    }
  }
  for (const a of next.cashout.allow) {
    const p = prev.cashout.allow.find((x) => norm(x.endpoint) === norm(a.endpoint))
    if (!p) out.push(`cash-out endpoint allowed: ${a.endpoint.slice(0, 120)}`)
    else if (a.maxUsdPerPurchase > p.maxUsdPerPurchase || a.maxUsdPerDay > p.maxUsdPerDay) out.push(`higher cash-out caps for ${a.endpoint.slice(0, 120)}`)
  }
  const pm = prev.priceMatch
  const nm = next.priceMatch
  if (nm.tolerancePct > pm.tolerancePct) out.push(`price tolerance up from ${pm.tolerancePct}% to ${nm.tolerancePct}%`)
  if (nm.toleranceUsd > pm.toleranceUsd) out.push(`price tolerance up from $${pm.toleranceUsd} to $${nm.toleranceUsd}`)
  if (nm.askAboveUsdWithoutCatalogPrice > pm.askAboveUsdWithoutCatalogPrice) out.push(`pays more when the catalog price is unusable ($${pm.askAboveUsdWithoutCatalogPrice} to $${nm.askAboveUsdWithoutCatalogPrice})`)
  if (nm.brokenCatalogAboveUsd > pm.brokenCatalogAboveUsd) out.push(`trusts higher catalog prices ($${pm.brokenCatalogAboveUsd} to $${nm.brokenCatalogAboveUsd})`)
  if (prev.payee.unknownPayee === 'deny' && next.payee.unknownPayee !== 'deny') out.push('new payees verified and paid on probation instead of refused')
  const pp = prev.payee.probation
  const np = next.payee.probation
  if (np.maxUsd > pp.maxUsd) out.push(`probation purchase cap up from $${pp.maxUsd} to $${np.maxUsd}`)
  if (np.maxPurchases > pp.maxPurchases) out.push(`more purchases on probation (${pp.maxPurchases} to ${np.maxPurchases})`)
  if (np.passesToPin < pp.passesToPin) out.push(`fewer passed answers before pinning (${pp.passesToPin} to ${np.passesToPin})`)
  if (np.minReputation < pp.minReputation) out.push(`lower reputation accepted for new payees (${pp.minReputation} to ${np.minReputation})`)
  if (!prev.payee.useObservedPayees && next.payee.useObservedPayees) out.push('payees observed by AllowLatch trusted again')
  const pairKey = (p: { requested: string; challenge: string }) => `${norm(p.requested)}>${norm(p.challenge)}`
  const prevPairs = new Set(prev.payee.allowHostPairs.map(pairKey))
  for (const p of next.payee.allowHostPairs) if (!prevPairs.has(pairKey(p))) out.push(`host pair allowed: ${p.requested.slice(0, 80)} -> ${p.challenge.slice(0, 80)}`)
  const prevNot = new Set(prev.cashout.notCashout.map(norm))
  for (const n of next.cashout.notCashout) if (!prevNot.has(norm(n))) out.push(`new not-cash-out phrase "${n.slice(0, 60)}"`)
  return out
}
