/**
 * Step 1: hard rules in code, before any money moves. Pure function: same input, same verdict.
 * Order: cash-out, allowlist, per-purchase limit, daily limit, price vs catalog, payee, signature window.
 */
import type { Challenge } from './challenge.ts'
import { checkPayee, type PayeeContext } from './payee.ts'
import { checkPriceMatch, type CatalogPriceInput } from './price.ts'
import { checkAllowlist, checkCashout, checkSignatureWindow, endpointLabel, normalizeEndpoint } from './endpoints.ts'
import type { GuardPolicy } from './policy.ts'
import { strictest, type GuardFinding, type GuardIntent, type Severity } from './types.ts'

export type RuleContext = {
  /** Kite catalog endpoints (for the "catalog" allowlist mode). */
  catalog: Array<{ method: string; url: string }>
  /** Catalog summary and tags of the endpoint being bought (cash-out detector). */
  summary?: string | null
  tags?: string[] | null
  spentToday: { totalUsd: number; byEndpoint: Record<string, number> }
  /** The seller's live 402, every offer read with the right decimals. Both pay paths pass it. */
  challenge?: Challenge | null
  /** Catalog price of the endpoint (null = the catalog has none). */
  catalogPrice?: CatalogPriceInput
  /** Pins for the challenge's payees, loaded before this pure check. */
  payee?: PayeeContext | null
}

export type RuleResult = { verdict: Severity; findings: GuardFinding[]; endpoint: string }

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export function evaluateRules(intent: GuardIntent, policy: GuardPolicy, ctx: RuleContext): RuleResult {
  const k = normalizeEndpoint(intent.method, intent.url)
  const label = k ? endpointLabel(k) : `${intent.method} ${intent.url}`.slice(0, 300)
  const findings: GuardFinding[] = []
  if (k) findings.push(...checkCashout(k, policy, { summary: ctx.summary, tags: ctx.tags, amountUsd: intent.amountUsd, spentTodayOnEndpointUsd: ctx.spentToday.byEndpoint[label] ?? 0 }))
  findings.push(...checkAllowlist(k, policy, ctx.catalog))
  const amt = intent.amountUsd
  if (amt == null || !Number.isFinite(amt) || amt < 0) {
    findings.push({ rule: 'price_unknown', severity: 'deny', by: 'allowlatch', message: 'The live price could not be read, so the limits cannot be checked.' })
  } else {
    if (amt > policy.perPurchaseUsd + 1e-9)
      findings.push({ rule: 'over_per_purchase', severity: 'deny', by: 'allowlatch', message: `$${amt} is over your $${policy.perPurchaseUsd} limit per purchase.` })
    const after = r6(ctx.spentToday.totalUsd + amt)
    if (after > policy.dailyUsd + 1e-9)
      findings.push({ rule: 'over_daily', severity: 'deny', by: 'allowlatch', message: `Spent $${r6(ctx.spentToday.totalUsd)} today; $${amt} more would pass your $${policy.dailyUsd} daily limit.` })
  }
  if (ctx.challenge) {
    const price = checkPriceMatch(ctx.challenge, ctx.catalogPrice, policy)
    const haveOver = findings.some((f) => f.rule === 'over_per_purchase')
    findings.push(...price.findings.filter((f) => !(haveOver && f.rule === 'over_per_purchase')))
  }
  if (ctx.payee) findings.push(...checkPayee(ctx.payee, policy))
  findings.push(...checkSignatureWindow(intent.maxTimeoutSeconds, policy))
  return { verdict: strictest(findings.map((f) => f.severity)), findings, endpoint: label }
}
