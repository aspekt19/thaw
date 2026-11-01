export type Exchange = "binance" | "okx" | "bybit" | "coinbase" | "kraken" | "kucoin" | "htx" | "bitget" | "other";
export type FundsSource = "other_exchange" | "own_wallet" | "p2p" | "otc" | "defi" | "unknown";
export type Verdict = "high" | "medium" | "low" | "cannot_help";
export type Evidence = "bank_statements" | "income_docs" | "exchange_export" | "txid_only" | "none";
export type RequestedDoc =
  | "source_of_funds" | "source_of_wealth" | "bank_statement" | "proof_of_address"
  | "exchange_statement" | "wallet_ownership" | "video" | "questionnaire" | "other";
export type Tier = "light" | "full";

export interface TierInput {
  exchange: Exchange;
  verdict: Verdict;
  disputedDepositsCount: number;          // >= 1
  addressesCount: number | null;          // unique addresses known after check; null = unknown
  fundsSources: FundsSource[];            // multi-select, may be empty
  priorExchangeRejection: boolean;        // proposal: new form field
  priorRoundsCount?: number;              // proposal
  requestedDocs: RequestedDoc[];          // from notice classification; empty = not listed
  ownershipProofRequested: boolean;       // from notice classification (proposal)
  evidence: Evidence[];                   // proposal: new form field
  amountUsd?: number;                     // informational only, not used in rules
  userConfirmedLowChance?: boolean;       // must be exactly true to open a case with verdict "low"
}

export type RuleId =
  | "LOW_POLICY_FULL" | "PRIOR_REJECTION" | "OWNERSHIP_REQUESTED" | "OKX_TXID_ONLY"
  | "COMPLEX_SOURCES" | "MANY_DEPOSITS" | "MANY_DOCS_REQUESTED" | "MANY_ADDRESSES"
  | "LIGHT_OVER_BUDGET" | "LIGHT_DEFAULT";
export type Flag = "FULL_BUDGET_GUARD" | "GENERIC_EXCHANGE" | "KUCOIN_LANGUAGE" | "ADDRESSES_UNKNOWN";

export interface TierConfig {
  allowLowVerdict: boolean;     // Yura decision 2026-11-01: true (only with warnings + explicit confirmation)
  lowVerdictTier: "full" | "rules"; // "full" = low always -> Full (R0); "rules" = low goes through R1..R8
  maxLightDeposits: number;     // 2
  maxLightAddresses: number;    // 30
  maxLightRequestedDocs: number;// 2 (3+ types -> full)
  defaultAddresses: number;     // 30, used when addressesCount is null
  costPerAddress: { light: number; full: number }; // USD, calibrate on real runs
  price: { light: number; full: number };          // 49, 79
  maxCostShare: number;         // 0.8 (margin >= 20%)
}

export const DEFAULT_CONFIG: TierConfig = {
  allowLowVerdict: true,
  lowVerdictTier: "full",
  maxLightDeposits: 2,
  maxLightAddresses: 30,
  maxLightRequestedDocs: 2,
  defaultAddresses: 30,
  costPerAddress: { light: 7.45 / 30, full: 21.45 / 30 },
  price: { light: 49, full: 79 },
  maxCostShare: 0.8,
};

// Where each warning is shown. All four must be shown for a low-chance case.
export type LowChancePlace = "chance_result" | "checkout" | "checkout_checkbox" | "case_cover_note";
export interface LowChanceWarning { place: LowChancePlace; text: string }

export const NO_FABRICATION = "We will not create, alter or falsify any document.";
export const LOW_CHANCE_WARNINGS: LowChanceWarning[] = [
  { place: "chance_result", text:
    "Your chance looks low: the exchange may refuse even with a complete set of documents. " +
    "We only prepare documents from what you give us. " + NO_FABRICATION + " Are you sure you want to continue?" },
  { place: "checkout", text:
    "Reminder: your chance looks low. This is document preparation only, not legal advice, " +
    "and no one can guarantee the exchange's decision. " + NO_FABRICATION },
  { place: "checkout_checkbox", text:
    "I understand my chance is low and the exchange may still refuse. " +
    "I understand Thaw will not create, alter or falsify any document. I still want to go ahead." },
  { place: "case_cover_note", text:
    "Note for you, not for the exchange: the chance check rated this case as low. " +
    "These documents are based only on what you provided. " + NO_FABRICATION +
    " Please check every document before you send it." },
];

export type CaseStatus = "ok" | "blocked_low_chance" | "refused";

export interface TierResult {
  status: CaseStatus;           // "ok" = case can be opened
  canOpenCase: boolean;
  tier: Tier | null;            // recommended tier; null = refused (no paid case)
  reason: RuleId | "NOT_ELIGIBLE";
  matched: RuleId[];            // all rules that matched, for UI/debug
  flags: Flag[];
  lowChanceAck: { required: boolean; confirmed: boolean; warnings: LowChanceWarning[] };
  estCostUsd: { light: number; full: number };
  costCapUsd: { light: number; full: number };
}

const COMPLEX: FundsSource[] = ["p2p", "otc", "defi", "unknown"];
const r2 = (x: number) => Math.round(x * 100) / 100;

export function recommendTier(i: TierInput, c: TierConfig = DEFAULT_CONFIG): TierResult {
  const addr = i.addressesCount ?? c.defaultAddresses;
  const est = { light: r2(addr * c.costPerAddress.light), full: r2(addr * c.costPerAddress.full) };
  const cap = { light: r2(c.price.light * c.maxCostShare), full: r2(c.price.full * c.maxCostShare) };
  const flags: Flag[] = [];
  if (i.addressesCount === null) flags.push("ADDRESSES_UNKNOWN");
  if (i.exchange === "other") flags.push("GENERIC_EXCHANGE");
  if (i.exchange === "kucoin") flags.push("KUCOIN_LANGUAGE");

  const isLow = i.verdict === "low";
  const confirmed = i.userConfirmedLowChance === true;
  const eligible = i.verdict === "high" || i.verdict === "medium" || (isLow && c.allowLowVerdict);
  if (!eligible) return {
    status: "refused", canOpenCase: false, tier: null, reason: "NOT_ELIGIBLE", matched: [], flags,
    lowChanceAck: { required: false, confirmed: false, warnings: [] }, estCostUsd: est, costCapUsd: cap,
  };

  const rules: [RuleId, boolean][] = [
    ["LOW_POLICY_FULL", isLow && c.lowVerdictTier === "full"],
    ["PRIOR_REJECTION", i.priorExchangeRejection || (i.priorRoundsCount ?? 0) >= 1],
    ["OWNERSHIP_REQUESTED", i.ownershipProofRequested || i.requestedDocs.includes("wallet_ownership")],
    ["OKX_TXID_ONLY", i.exchange === "okx" && i.evidence.length > 0 && i.evidence.every(e => e === "txid_only" || e === "none") && i.evidence.includes("txid_only")],
    ["COMPLEX_SOURCES", i.fundsSources.length === 0 || i.fundsSources.some(s => COMPLEX.includes(s))],
    ["MANY_DEPOSITS", i.disputedDepositsCount > c.maxLightDeposits],
    ["MANY_DOCS_REQUESTED", new Set(i.requestedDocs).size > c.maxLightRequestedDocs || i.requestedDocs.includes("source_of_wealth")],
    ["MANY_ADDRESSES", addr > c.maxLightAddresses],
    ["LIGHT_OVER_BUDGET", est.light > cap.light],
  ];
  const matched = rules.filter(([, hit]) => hit).map(([id]) => id);
  const tier: Tier = matched.length ? "full" : "light";
  if (tier === "full" && est.full > cap.full) flags.push("FULL_BUDGET_GUARD");
  const blocked = isLow && !confirmed;
  return {
    status: blocked ? "blocked_low_chance" : "ok", canOpenCase: !blocked,
    tier, reason: matched[0] ?? "LIGHT_DEFAULT", matched: matched.length ? matched : ["LIGHT_DEFAULT"], flags,
    lowChanceAck: isLow
      ? { required: true, confirmed, warnings: LOW_CHANCE_WARNINGS }
      : { required: false, confirmed: false, warnings: [] },
    estCostUsd: est, costCapUsd: cap,
  };
}

// Upgrade Light -> Full (Yura decision 2026-11-01): the client pays the price difference.
export interface UpgradeQuote {
  allowed: boolean;
  from: Tier;
  to: "full";
  payUsd: number;               // full - light = 30; chance-check credit is NOT applied again
  costCapUsd: number;           // total case spend (Light work already done + Full extras) <= full cap
  reuse: string[];              // Light work that is kept
}

export const UPGRADE_REUSE = [
  "first-hop trace and address list",
  "address screening results already bought",
  "exchange checklist and notice classification",
  "documents already collected and the SoF draft",
];

/** Product path: a low chance does not open a case. Thresholds stay in config. */
export const PRODUCT_TIER_CONFIG: TierConfig = { ...DEFAULT_CONFIG, allowLowVerdict: false }

/** One-line English reasons from the tier spec. */
export const REASON_LINE: Record<RuleId, string> = {
  LOW_POLICY_FULL: 'Your chance looks low, so we recommend the Full case, which collects the most evidence we can prepare.',
  PRIOR_REJECTION: 'The exchange has already turned down a submission, so we recommend the Full case: it checks every document against the request and includes one more round after the exchange replies.',
  OWNERSHIP_REQUESTED: 'The exchange asks you to show that the sending wallet or account is yours, and that step is only included in the Full case.',
  OKX_TXID_ONLY: 'OKX says a transaction ID alone may not show the wallet is yours, so we recommend the Full case to help you put together extra proof.',
  COMPLEX_SOURCES: "Part of your funds came through P2P, OTC, DeFi or a source you're not sure about, and the Full case explains each of those paths step by step.",
  MANY_DEPOSITS: 'You have more than two disputed deposits, and the Light case covers only one or two.',
  MANY_DOCS_REQUESTED: 'The exchange asks for several kinds of documents, so we recommend the Full case, which builds an indexed document pack matched to the request.',
  MANY_ADDRESSES: 'Your funds passed through many addresses, and the Full case checks all of them with several screening providers.',
  LIGHT_OVER_BUDGET: 'Your case needs more screening work than the Light case allows, so we recommend the Full case.',
  LIGHT_DEFAULT: 'Your case looks simple: one or two deposits with clear sources, so the Light case should cover what the exchange asked for.',
}

export const MISSING_LINE: Record<RuleId, string> = {
  PRIOR_REJECTION: "a document check against the exchange's request, a second round, or a formal complaint draft",
  OWNERSHIP_REQUESTED: 'wallet ownership proof',
  OKX_TXID_ONLY: 'wallet ownership proof',
  COMPLEX_SOURCES: 'a step-by-step explanation of P2P, OTC or DeFi paths',
  MANY_DEPOSITS: 'more than two deposits',
  MANY_DOCS_REQUESTED: 'an indexed document pack',
  MANY_ADDRESSES: 'screening of every address with several providers',
  LIGHT_OVER_BUDGET: 'screening of every address with several providers',
  LOW_POLICY_FULL: 'screening of every address with several providers',
  LIGHT_DEFAULT: 'the extra Full-case steps',
}

export const TIER_NOTE = "This is document preparation only, not legal advice, and no one can guarantee the exchange's decision."

export const LIGHT_PICK_NOTE = 'You chose the Full case. It adds wallet ownership proof, multi-provider screening, one extra round and a formal complaint draft.'

export function downgradeWarning(reason: RuleId): string {
  return `We recommended the Full case because ${REASON_LINE[reason]} The Light case does not include ${MISSING_LINE[reason]}. If the exchange asks for more, you can upgrade later by paying the difference. A later upgrade from Light to Full costs $30 extra.`
}

export function upgradeQuote(current: Tier, c: TierConfig = DEFAULT_CONFIG): UpgradeQuote {
  const allowed = current === "light";
  return {
    allowed, from: current, to: "full",
    payUsd: allowed ? r2(c.price.full - c.price.light) : 0,
    costCapUsd: r2(c.price.full * c.maxCostShare),
    reuse: allowed ? UPGRADE_REUSE : [],
  };
}
