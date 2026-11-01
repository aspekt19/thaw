export type Exchange = "binance" | "okx" | "bybit" | "coinbase" | "kraken" | "kucoin" | "htx" | "bitget" | "other";
export type FundsSource = "other_exchange" | "own_wallet" | "p2p" | "otc" | "defi" | "unknown";
export type Verdict = "high" | "medium" | "low" | "cannot_help";
export type Evidence = "bank_statements" | "income_docs" | "exchange_export" | "txid_only" | "none";
export type RequestedDoc =
  | "source_of_funds" | "source_of_wealth" | "bank_statement" | "proof_of_address"
  | "exchange_statement" | "wallet_ownership" | "video" | "questionnaire" | "other";
export type Tier = "light" | "full";
export type HoldType = "travel_rule" | "aml" | "unknown";

export interface TierInput {
  exchange: Exchange;
  verdict: Verdict;
  disputedDepositsCount: number;          // >= 1
  addressesCount: number | null;          // unique addresses known after check; null = unknown
  fundsSources: FundsSource[];            // multi-select, may be empty
  priorExchangeRejection: boolean;        // new form field (decided 2026-11-01)
  priorRoundsCount?: number;              // new form field (decided 2026-11-01)
  requestedDocs: RequestedDoc[];          // from notice classification; empty = not listed
  ownershipProofRequested: boolean;       // from notice classification (decided 2026-11-01)
  evidence: Evidence[];                   // new form field (decided 2026-11-01)
  amountUsd?: number;                     // informational only; no amount threshold (decided 2026-11-01)
  userConfirmedLowChance?: boolean;       // must be exactly true to open a case with verdict "low"
  // Travel Rule (Yura decision 2026-11-01 15:48): sell Light, but only after we checked the cause.
  holdType?: HoldType;                    // what the hold looks like (from notice classification / form)
  travelRuleConfirmed?: boolean;          // true only after OUR check that the cause really is Travel Rule
  // HTX (Yura decision 2026-11-01 15:49): decline only for UK/EU clients.
  clientCountry?: string;                 // ISO-2 country of residence, e.g. "DE", "GB", "TR", "US"
  clientNationalities?: string[];         // ISO-2 citizenships (EU/UK rules also cover nationals abroad)
  htxLinked?: boolean;                    // funds came from / went to HTX (exchange may be another one)
}

export type RuleId =
  | "LOW_POLICY_FULL" | "PRIOR_REJECTION" | "OWNERSHIP_REQUESTED" | "OKX_TXID_ONLY"
  | "COMPLEX_SOURCES" | "MANY_DEPOSITS" | "MANY_DOCS_REQUESTED" | "MANY_ADDRESSES"
  | "LIGHT_OVER_BUDGET" | "TRAVEL_RULE_LIGHT" | "LIGHT_DEFAULT";
export type RefusalReason = "NOT_ELIGIBLE" | "HTX_UK_EU_CLIENT";
export type Flag =
  | "FULL_BUDGET_GUARD" | "GENERIC_EXCHANGE" | "KUCOIN_LANGUAGE" | "ADDRESSES_UNKNOWN"
  | "TRAVEL_RULE_VERIFY_FIRST"  // travel_rule hold, not confirmed yet: check the cause before answering the client
  | "HTX_COUNTRY_REQUIRED";     // HTX-related case without client country: ask before opening the case

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
  htxDeclineCountries: string[];// ISO-2: EU member states + GB (Yura decision 2026-11-01 15:49)
}

// EU member states (27) + United Kingdom, ISO 3166-1 alpha-2. Greece is "GR" (EU uses "EL", normalised below).
export const EU_MEMBER_STATES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];
export const HTX_DECLINE_COUNTRIES = [...EU_MEMBER_STATES, "GB"];

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
  htxDeclineCountries: HTX_DECLINE_COUNTRIES,
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

export type CaseStatus = "ok" | "blocked_low_chance" | "blocked_need_country" | "refused";

export interface TierResult {
  status: CaseStatus;           // "ok" = case can be opened
  canOpenCase: boolean;
  tier: Tier | null;            // recommended tier; null = refused (no paid case)
  reason: RuleId | RefusalReason;
  matched: RuleId[];            // all rules that matched, for UI/debug
  flags: Flag[];
  lowChanceAck: { required: boolean; confirmed: boolean; warnings: LowChanceWarning[] };
  lightAllowed: boolean;        // false only when R8 LIGHT_OVER_BUDGET fired (margin >= 20%)
  lightBlockedNote: string | null; // user note shown when lightAllowed is false
  estCostUsd: { light: number; full: number };
  costCapUsd: { light: number; full: number };
}

const COMPLEX: FundsSource[] = ["p2p", "otc", "defi", "unknown"];
const r2 = (x: number) => Math.round(x * 100) / 100;
const iso2 = (x: string) => { const u = x.trim().toUpperCase(); return u === "UK" ? "GB" : u === "EL" ? "GR" : u; };

// HTX-related case: the frozen account is on HTX, or the disputed funds came from / went to HTX.
export function isHtxRelated(i: TierInput): boolean {
  return i.exchange === "htx" || i.htxLinked === true;
}
// UK/EU client: residence or any citizenship in the list (EU Reg. 833/2014 art. 13, UK SAMLA 2018 s.21).
export function isHtxDeclinedClient(i: TierInput, c: TierConfig = DEFAULT_CONFIG): boolean {
  const list = c.htxDeclineCountries.map(iso2);
  const countries = [i.clientCountry, ...(i.clientNationalities ?? [])].filter((x): x is string => !!x).map(iso2);
  return countries.some(x => list.includes(x));
}

export function recommendTier(i: TierInput, c: TierConfig = DEFAULT_CONFIG): TierResult {
  const addr = i.addressesCount ?? c.defaultAddresses;
  const est = { light: r2(addr * c.costPerAddress.light), full: r2(addr * c.costPerAddress.full) };
  const cap = { light: r2(c.price.light * c.maxCostShare), full: r2(c.price.full * c.maxCostShare) };
  const flags: Flag[] = [];
  if (i.addressesCount === null) flags.push("ADDRESSES_UNKNOWN");
  if (i.exchange === "other") flags.push("GENERIC_EXCHANGE");
  if (i.exchange === "kucoin") flags.push("KUCOIN_LANGUAGE");
  const travelRule = i.holdType === "travel_rule";
  const trConfirmed = travelRule && i.travelRuleConfirmed === true;
  if (travelRule && !trConfirmed) flags.push("TRAVEL_RULE_VERIFY_FIRST");

  const isLow = i.verdict === "low";
  const confirmed = i.userConfirmedLowChance === true;
  const eligible = i.verdict === "high" || i.verdict === "medium" || (isLow && c.allowLowVerdict);
  const refuse = (reason: RefusalReason): TierResult => ({
    status: "refused", canOpenCase: false, tier: null, reason, matched: [], flags,
    lowChanceAck: { required: false, confirmed: false, warnings: [] },
    lightAllowed: false, lightBlockedNote: null, estCostUsd: est, costCapUsd: cap,
  });
  if (!eligible) return refuse("NOT_ELIGIBLE");
  const htx = isHtxRelated(i);
  if (htx && isHtxDeclinedClient(i, c)) return refuse("HTX_UK_EU_CLIENT");
  const needCountry = htx && !i.clientCountry;
  if (needCountry) flags.push("HTX_COUNTRY_REQUIRED");

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
  const fullHits = rules.filter(([, hit]) => hit).map(([id]) => id);
  const lightAllowed = !fullHits.includes("LIGHT_OVER_BUDGET");
  // R_TR: confirmed Travel Rule hold -> Light, wins over R0..R7. R8 (margin >= 20%) still wins over R_TR.
  const trLight = trConfirmed && lightAllowed;
  const matched: RuleId[] = trLight ? ["TRAVEL_RULE_LIGHT", ...fullHits] : fullHits;
  const tier: Tier = trLight || !fullHits.length ? "light" : "full";
  if (tier === "full" && est.full > cap.full) flags.push("FULL_BUDGET_GUARD");
  const blocked = isLow && !confirmed;
  return {
    status: blocked ? "blocked_low_chance" : needCountry ? "blocked_need_country" : "ok",
    canOpenCase: !blocked && !needCountry,
    tier, reason: matched[0] ?? "LIGHT_DEFAULT", matched: matched.length ? matched : ["LIGHT_DEFAULT"], flags,
    lowChanceAck: isLow
      ? { required: true, confirmed, warnings: LOW_CHANCE_WARNINGS }
      : { required: false, confirmed: false, warnings: [] },
    lightAllowed, lightBlockedNote: lightAllowed ? null : LIGHT_BLOCKED_NOTE,
    estCostUsd: est, costCapUsd: cap,
  };
}

export const LIGHT_BLOCKED_NOTE =
  "For this case the Light package cannot cover the checks needed, so only the Full case is available.";

// User changes the recommended tier (section 4). Full -> Light needs the warning checkbox
// and is rejected when R8 fired (Thaw's derivation from Yura's margin rule >= 20%).
export type Override = "none" | "full_to_light" | "light_to_full";
export interface TierChoice {
  ok: boolean;
  tier: Tier | null;            // tier that will be sold; null = choice rejected / no case
  override: Override;
  needsConfirmation: boolean;   // full -> light: warning + checkbox
  error: "NO_CASE" | "LIGHT_NOT_ALLOWED" | null;
  note: string | null;
}

export function chooseTier(r: TierResult, chosen: Tier): TierChoice {
  if (r.tier === null) return { ok: false, tier: null, override: "none", needsConfirmation: false, error: "NO_CASE", note: null };
  if (chosen === r.tier) return { ok: true, tier: chosen, override: "none", needsConfirmation: false, error: null, note: null };
  if (chosen === "full") return { ok: true, tier: "full", override: "light_to_full", needsConfirmation: false, error: null, note: null };
  if (!r.lightAllowed) return { ok: false, tier: "full", override: "full_to_light", needsConfirmation: false, error: "LIGHT_NOT_ALLOWED", note: r.lightBlockedNote };
  return { ok: true, tier: "light", override: "full_to_light", needsConfirmation: true, error: null, note: null };
}

/** Fields chooseTier reads, taken from a stored recommendation. Other fields are unused by that function. */
export function choiceResult(tier: Tier | null, lightAllowed: boolean, lightBlockedNote: string | null): TierResult {
  return {
    status: tier ? "ok" : "refused",
    canOpenCase: tier !== null,
    tier,
    reason: tier ? "LIGHT_DEFAULT" : "NOT_ELIGIBLE",
    matched: [],
    flags: [],
    lowChanceAck: { required: false, confirmed: false, warnings: [] },
    lightAllowed,
    lightBlockedNote,
    estCostUsd: { light: 0, full: 0 },
    costCapUsd: { light: 0, full: 0 },
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

/** Product path: a low chance opens a Full case only after an explicit confirmation. Thresholds stay in config. */
export const PRODUCT_TIER_CONFIG: TierConfig = { ...DEFAULT_CONFIG, allowLowVerdict: true, lowVerdictTier: 'full' }

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
  TRAVEL_RULE_LIGHT: "Your funds are on hold because of the exchange's Travel Rule check, so the Light case should cover the sender and recipient details the exchange asked for.",
  LIGHT_DEFAULT: 'Your case looks simple: one or two deposits with clear sources, so the Light case should cover what the exchange asked for.',
}

export const REFUSAL_LINE: Record<RefusalReason, string> = {
  NOT_ELIGIBLE: 'We will not prepare papers for this notice.',
  HTX_UK_EU_CLIENT: "We can't take HTX-related cases for UK or EU residents or citizens, so we can't open a case for you. This is not legal advice.",
}

export const TRAVEL_RULE_VERIFY_NOTE = 'We first verify that the hold is really caused by the Travel Rule. Until that check is done, the file follows the ordinary rules.'

export const NEED_COUNTRY_NOTE = 'Tell us your country of residence, and any other citizenship, before we can open a file on an HTX-related case.'

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
  TRAVEL_RULE_LIGHT: 'the extra Full-case steps',
  LIGHT_DEFAULT: 'the extra Full-case steps',
}

export const TIER_NOTE = "This is document preparation only, not legal advice, and no one can guarantee the exchange's decision."

export const LIGHT_PICK_NOTE = 'You chose the Full case. It adds wallet ownership proof, multi-provider screening, one extra round and a formal complaint draft.'

/** English upgrade line. The dollar amount comes from upgradeQuote(), not a fixed string. */
export function upgradeOfferText(config: TierConfig = DEFAULT_CONFIG): string {
  const quote = upgradeQuote('light', config)
  if (!quote.allowed) return ''
  return `You can upgrade to the Full case at any time by paying the $${quote.payUsd} difference. We keep the work already done in your Light case.`
}

export function downgradeWarning(reason: RuleId, config: TierConfig = DEFAULT_CONFIG): string {
  const quote = upgradeQuote('light', config)
  return `We recommended the Full case because ${REASON_LINE[reason]} The Light case does not include ${MISSING_LINE[reason]}. If the exchange asks for more, you can upgrade later by paying the difference. A later upgrade from Light to Full costs $${quote.payUsd} extra. ${upgradeOfferText(config)}`
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
