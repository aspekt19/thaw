/**
 * Shared guard types. A verdict only moves one way: allow < warn < escalate < deny.
 * Every check (code rules, SERV, response checks) produces a verdict and the strictest one wins.
 */
export type Severity = 'allow' | 'warn' | 'escalate' | 'deny'

export const SEVERITY_RANK: Record<Severity, number> = { allow: 0, warn: 1, escalate: 2, deny: 3 }

/**
 * The stricter of two verdicts. A SERV verdict is merged with this, so a SERV allow never loosens a code refusal; the only
 * places SERV may lift a code finding are the bounded ones in serv-authority.ts (SERV decides inside limits the code enforces).
 */
export function stricter(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

export function strictest(list: Severity[]): Severity {
  return list.reduce<Severity>((acc, s) => stricter(acc, s), 'allow')
}

export type GuardFinding = {
  rule: string
  severity: Severity
  message: string
  /** Who enforces this rule: AllowLatch code, Kite, or SERV. */
  by: 'allowlatch' | 'kite' | 'serv'
}

/** What the agent wants to pay for, as the guard sees it before any money moves. */
export type GuardIntent = {
  method: string
  url: string
  amountUsd: number | null
  /** maxTimeoutSeconds from the seller's live 402 (signature window). */
  maxTimeoutSeconds: number | null
  task?: string | null
  sellerName?: string | null
  sellerSummary?: string | null
  endpointId?: string | null
  /** Who owns the spend ledger (a Passport link id on the hosted path, "local" for the local wrapper). */
  ownerKey: string
}

export type ServSignal =
  | { status: 'ok'; verdict: Severity; reason: string; graphId: string; requestId: string | null }
  | { status: 'unavailable'; reason: string; graphId: string | null }
  /** Not asked: code already denied, so SERV could not change the outcome. */
  | { status: 'skipped'; reason: string; graphId: null }

export type GuardDecision = {
  verdict: Severity
  code: { verdict: Severity; findings: GuardFinding[] }
  serv: ServSignal
}
