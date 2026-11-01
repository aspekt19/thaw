/**
 * Rule 1, price match: the seller's live 402 price against the Kite catalog price for the same endpoint.
 * Pure function. Kite pays whatever the 402 asks (within the session limits); this is AllowLatch's own check.
 */
import type { Challenge } from './challenge.ts'
import type { GuardPolicy } from './policy.ts'
import type { GuardFinding } from './types.ts'

/** The catalog's starting price for the endpoint being bought (null/undefined = the catalog has none). */
export type CatalogPriceInput = { amountUsd: number | null; unit?: string | null; raw?: string | null } | null | undefined

export type PriceCheck = {
  findings: GuardFinding[]
  /** Highest amount the seller asks across its offers, in dollars. */
  challengeUsd: number | null
  catalogUsd: number | null
  catalog: 'usable' | 'missing' | 'broken'
}

/** Plain dollars: no trailing zeros, enough digits for sub-cent prices. */
export function dollars(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n >= 1e6) return `$${n.toExponential(2)}`
  const v = String(Number(n.toFixed(n < 0.01 ? 6 : 4)))
  // One digit after the point reads oddly as money: $0.1 → $0.10, $2.5 → $2.50.
  return `$${/\.\d$/.test(v) ? v + '0' : v}`
}

export function catalogPriceStatus(c: CatalogPriceInput, policy: GuardPolicy): { status: 'usable' | 'missing' | 'broken'; usd: number | null } {
  if (!c || c.amountUsd == null) return { status: 'missing', usd: null }
  const n = c.amountUsd
  if (!Number.isFinite(n) || n <= 0) return { status: 'broken', usd: Number.isFinite(n) ? n : null }
  if (n > policy.priceMatch.brokenCatalogAboveUsd) return { status: 'broken', usd: n }
  return { status: 'usable', usd: n }
}

export function checkPriceMatch(challenge: Challenge, catalogPrice: CatalogPriceInput, policy: GuardPolicy): PriceCheck {
  const findings: GuardFinding[] = []
  const pm = policy.priceMatch
  const ask = challenge.maxUsd
  const cat = catalogPriceStatus(catalogPrice, policy)
  const out = (): PriceCheck => ({ findings, challengeUsd: ask, catalogUsd: cat.usd, catalog: cat.status })
  if (ask == null) return out() // price_unknown is already refused by the limit rules
  const variable = challenge.offers.some((o) => o.variable)
  const asks = variable ? `asks up to ${dollars(ask)}` : `asks ${dollars(ask)}`
  // Whatever the catalog says, never more than the per-purchase limit (also checked on the main amount).
  if (ask > policy.perPurchaseUsd + 1e-9)
    findings.push({ rule: 'over_per_purchase', severity: 'deny', by: 'allowlatch', message: `The seller ${asks}, over your ${dollars(policy.perPurchaseUsd)} limit per purchase.` })
  if (challenge.offers.some((o) => o.decimalsFrom === 'assumed_6' || o.decimalsFrom === 'seller_said_fewer'))
    findings.push({ rule: 'price_decimals_assumed', severity: 'warn', by: 'allowlatch', message: 'The payment asset is not one AllowLatch knows, so its price was read with 6 decimals (this can only make it look higher, not lower).' })
  if (cat.status !== 'usable') {
    const what = cat.status === 'missing' ? 'has no price for this endpoint' : `lists a price for this endpoint that cannot be right (${catalogPrice?.raw ?? (cat.usd != null ? dollars(cat.usd) : 'not a number')})`
    const sev = ask > pm.askAboveUsdWithoutCatalogPrice + 1e-9 ? 'deny' : 'warn'
    findings.push({
      rule: 'catalog_price_unusable',
      severity: sev,
      by: 'allowlatch',
      message:
        sev === 'deny'
          ? `The Kite catalog ${what}, so AllowLatch cannot check the price. The seller ${asks}, more than the ${dollars(pm.askAboveUsdWithoutCatalogPrice)} AllowLatch pays without a catalog price. Not paid; an equivalent seller with a checkable price is tried instead.`
          : `The Kite catalog ${what}, so AllowLatch cannot compare; the seller ${asks}, which is within ${dollars(pm.askAboveUsdWithoutCatalogPrice)} and your limits.`,
    })
    return out()
  }
  const catalog = cat.usd!
  const allowance = Math.max((catalog * pm.tolerancePct) / 100, pm.toleranceUsd)
  if (ask > catalog + allowance + 1e-9) {
    const times = catalog > 0 ? ask / catalog : Infinity
    const howMuch = times >= 2 ? `${Number(times.toFixed(times >= 100 ? 0 : 1))} times the catalog price` : `${Number(((times - 1) * 100).toFixed(1))}% more than the catalog price`
    findings.push({
      rule: 'price_above_catalog',
      severity: 'deny',
      by: 'allowlatch',
      message: `The seller ${asks}, but the Kite catalog lists this endpoint at ${dollars(catalog)}. That is ${howMuch}, over your allowance of ${pm.tolerancePct}% or ${dollars(pm.toleranceUsd)}. Not paid.`,
    })
  } else if (ask < catalog - allowance - 1e-9) {
    findings.push({
      rule: 'price_below_catalog',
      severity: 'warn',
      by: 'allowlatch',
      message: `The seller ${asks}, less than the ${dollars(catalog)} the Kite catalog lists. Allowed; noted in case the answer is not what the catalog promises.`,
    })
  } else if (variable) {
    findings.push({ rule: 'price_variable', severity: 'warn', by: 'allowlatch', message: `Variable price: the seller may take up to ${dollars(ask)} (catalog ${dollars(catalog)}). Checked at the most it can take.` })
  }
  return out()
}
