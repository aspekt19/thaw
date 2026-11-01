import {
  canonicalJson,
  fence,
  servChat,
  servInjectionCheck,
  servStructured,
  sha256Hex,
  signEd25519,
  UNTRUSTED_RULE,
  type ServComplete,
  type ServSignal,
} from '@thaw/guard'
import type { RpcCall } from '../chain/evm-rpc.ts'
import { classifyDeposit, explorerUrl } from './address.ts'
import { sourcesFromOrigin } from './parse.ts'
import { formatUsd, type Category, type Verdict } from './constants.ts'
import { categoriesInNotice } from './lexicon.ts'
import { screenAddresses, type BanList } from './banlist.ts'
import { lookupFirstHop, type HopLookup } from './lookup.ts'
import { cacheKey, userKey, utcDay, type AsyncLimitStore, type LimitConfig } from './limits.ts'
import { decide, type BanState } from './rules.ts'
import { MISSING_LINE, NEED_COUNTRY_NOTE, PRODUCT_TIER_CONFIG, REASON_LINE, REFUSAL_LINE, TIER_NOTE, TRAVEL_RULE_VERIFY_NOTE, recommendTier, type Exchange as TierExchange, type Flag, type LowChanceWarning, type RefusalReason, type RuleId } from './tier.ts'
import type { ChanceInput } from './parse.ts'

const CATEGORY_LIST = [
  'law_enforcement',
  'sanctions',
  'theft',
  'final_closure',
  'source_of_funds',
  'additional_verification',
  'edd',
  'travel_rule',
  't_plus_n',
  'risk_control',
  'unknown',
] as const

const NOTICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...CATEGORY_LIST] },
  },
  required: ['category'],
}

const PROMISE = [/гарантир/i, /разморозим/i, /we guarantee/i, /promise to unfreeze/i, /верн[её]м средства/i]

export type ServHooks = {
  classify(notice: string): Promise<Category | null>
  explain(verdict: Verdict, reasons: string[]): Promise<string | null>
  injection?(notice: string): Promise<ServSignal>
}

export type ChanceDeps = {
  now: () => number
  fetch: typeof fetch
  serv: ServHooks | null
  banlist: BanList
  store: AsyncLimitStore
  limits: LimitConfig
  captchaRequired: boolean
  verifyCaptcha: (token: string | undefined) => Promise<boolean>
  paidPathEnabled: boolean
  paidPathPriceUsd: number
  id: () => string
  burst: (key: string) => { ok: true } | { ok: false; status: number; error: string }
    etherscanApiKey?: string
  trongridApiKey?: string
  evmCall?: RpcCall
  alchemyTransfers?: boolean
  /** When set, the decision is signed with the ed25519 scheme from the guard. */
  receiptSecret?: string
}

export type PublicResult = {
  ok: true
  id: string
  verdict: Verdict
  reasons: string[]
  whatWouldRaiseChance: string[]
  explanation: string
  cached: boolean
  spentUsd: string
  quotedBanlistUsd: string
  banlist: BanState
  lookupDetail: string
  inputSha256: string
  signature: string | null
  injection: 'not_called' | 'allow' | 'deny' | 'unavailable'
  disclaimer: string
  /** Public explorer page for the deposit the person entered. Base uses basescan.org. */
  depositExplorer: string | null
  /**
   * Set for high, medium, and low. A low chance recommends Full and stays blocked until the person confirms.
   * SERV document labels are not connected, so those rules do not fire.
   */
  recommendation: {
    tier: 'light' | 'full' | null
    reasonId: RuleId | RefusalReason
    reason: string
    missing: string
    priceUsd: number
    note: string
    status: 'ok' | 'blocked_low_chance' | 'blocked_need_country' | 'refused'
    canOpenCase: boolean
    lowChance: { required: boolean; warnings: LowChanceWarning[] }
    lightAllowed: boolean
    lightBlockedNote: string | null
    flags: Flag[]
  } | null
  /** Facts from the deposit trace used by the tier rules. htxLinked is not a client answer. */
  traceFacts: { addressesCount: number | null; htxLinked: boolean }
  paidPath: { enabled: boolean; priceUsd: number; implemented: false }
}

export type CheckFailure = {
  ok: false
  status: number
  code: string
  error: string
  paidPath?: { enabled: boolean; priceUsd: number; implemented: false }
}

export const DISCLAIMER =
  'Это подготовка документов, не юридическая помощь. Мы не обещаем разморозку. Оценку дают правила по тексту уведомления и открытым данным блокчейна. Решение принимает только биржа. Санкционные случаи мы не берём.'

export function paidPathView(deps: ChanceDeps): PublicResult['paidPath'] {
  return { enabled: deps.paidPathEnabled, priceUsd: deps.paidPathPriceUsd, implemented: false }
}

export async function runChanceCheck(
  input: ChanceInput,
  ip: string,
  deps: ChanceDeps,
): Promise<PublicResult | CheckFailure> {
  const burst = deps.burst(`burst:${ip}`)
  if (!burst.ok) {
    return { ok: false, status: 429, code: 'burst', error: 'Слишком много запросов. Подождите минуту.' }
  }
  if (deps.captchaRequired) {
    const passed = await deps.verifyCaptcha(input.captchaToken)
    if (!passed) {
      return { ok: false, status: 403, code: 'captcha', error: 'Проверка капчи не пройдена.' }
    }
  }

  const now = deps.now()
  const day = utcDay(now)
  const key = cacheKey(input.chain, input.deposit)
  const cached = await deps.store.readCache<PublicResult>(key, now)
  if (cached) return { ...cached, cached: true }

  const slotKey = userKey(ip, input.clientId, day)
  if (!(await deps.store.takeUserSlot(slotKey, day, deps.limits.dailyChecks))) {
    if (!deps.paidPathEnabled) {
      return {
        ok: false,
        status: 429,
        code: 'user_limit',
        error: 'Бесплатный лимит на сегодня исчерпан. Платная проверка сверх лимита выключена.',
        paidPath: paidPathView(deps),
      }
    }
    return {
      ok: false,
      status: 501,
      code: 'paid_path_stub',
      error: 'Платная проверка сверх лимита помечена в настройке, но оплата не подключена. Проверку не запускали.',
      paidPath: paidPathView(deps),
    }
  }

  let lookup: HopLookup
  try {
    lookup = await lookupFirstHop(input, deps.fetch, {
      etherscanApiKey: deps.etherscanApiKey,
      trongridApiKey: deps.trongridApiKey,
      evmCall: deps.evmCall,
      alchemyTransfers: deps.alchemyTransfers,
    })
  } catch {
    lookup = {
      status: 'unavailable',
      detail: 'lookup failed',
      sender: null,
      hop1: [],
      firstHopOk: false,
      amountMatch: 'unknown',
      dateMatch: 'unknown',
    }
  }
  const baseDeposit = input.chain === 'base'
  const addresses = baseDeposit ? [] : banAddresses(lookup)
  const bill = deps.banlist.billedMicroPerAddress * addresses.length
  if (!(await deps.store.reserveSpend(day, bill, deps.limits.spendCapMicro))) {
    await deps.store.giveBackSlot(slotKey)
    return {
      ok: false,
      status: 429,
      code: 'spend_cap',
      error: 'Дневной потолок расходов на проверки исчерпан.',
      paidPath: paidPathView(deps),
    }
  }

  let ban: BanState = 'disabled'
  if (baseDeposit) ban = 'unsupported'
  else if (!deps.banlist.enabled) ban = 'disabled'
  else if (addresses.length === 0) ban = 'not_checked'
  else {
    try {
      const screened = await screenAddresses(deps.banlist, addresses)
      ban = screened.state === 'not_checked' ? 'unavailable' : screened.state
    } catch {
      ban = 'unavailable'
    }
  }

  const lexicon = categoriesInNotice(input.notice)
  let injection: PublicResult['injection'] = 'not_called'
  let servBlocked = false
  if (deps.serv?.injection) {
    try {
      const signal = await deps.serv.injection(input.notice)
      if (signal.status === 'ok') {
        injection = signal.verdict === 'deny' ? 'deny' : 'allow'
        servBlocked = signal.verdict === 'deny'
      } else if (signal.status === 'unavailable') injection = 'unavailable'
    } catch {
      injection = 'unavailable'
    }
  }
  const servCategory = deps.serv && !servBlocked ? await safeClassify(deps.serv, input.notice) : null
  const categories = mergeCategories(lexicon, servCategory)
  const servOnly = servCategory && !lexicon.includes(servCategory) ? [servCategory] : []
  const decision = decide({
    categories,
    servOnly,
    ban,
    lookupOk: lookup.status === 'ok',
    firstHopOk: lookup.firstHopOk,
    amountMatch: lookup.amountMatch,
    dateMatch: lookup.dateMatch,
    origin: input.origin,
    hasDocuments: input.hasDocuments,
    priorRefusal: input.priorRefusal,
  })
  let explanation = decision.explanation
  if (deps.serv && !servBlocked) {
    const extra = await safeExplain(deps.serv, decision.verdict, decision.reasons)
    if (extra && !PROMISE.some((pattern) => pattern.test(extra))) explanation = extra
  }

  const quoted = deps.banlist.enabled ? deps.banlist.quotedMicroPerAddress * addresses.length : 0
  const signed = canonicalJson({
    input: decisionInput(input),
    verdict: decision.verdict,
    reasons: decision.reasons,
    banlist: ban,
  })
  const result: PublicResult = {
    ok: true,
    id: deps.id(),
    verdict: decision.verdict,
    reasons: decision.reasons,
    whatWouldRaiseChance: decision.whatWouldRaiseChance,
    explanation,
    cached: false,
    spentUsd: formatUsd(bill),
    quotedBanlistUsd: formatUsd(quoted),
    banlist: ban,
    lookupDetail: lookup.detail,
    inputSha256: sha256Hex(signed),
    signature: deps.receiptSecret ? signEd25519(signed, deps.receiptSecret) : null,
    injection,
    disclaimer: DISCLAIMER,
    depositExplorer: depositLink(input.chain, input.deposit),
    recommendation: recommendationFor(input, decision.verdict, lookup),
    traceFacts: { addressesCount: knownAddresses(lookup), htxLinked: htxLinkedFromLookup(lookup) },
    paidPath: paidPathView(deps),
  }
  await deps.store.writeCache(key, result, now, deps.limits.cacheTtlMs)
  return result
}

/**
 * Whether the deposit trace shows the funds touched HTX or another sanctioned exchange.
 * TODO: the first-hop lookup returns addresses only. It has no labeled exchange or sanctions list,
 * so a link cannot be detected yet. Do not guess, and do not read this from the form.
 */
export function htxLinkedFromLookup(_lookup: HopLookup): boolean {
  return false
}

function knownAddresses(lookup: HopLookup): number | null {
  if (lookup.status !== 'ok') return null
  const ids = new Set<string>()
  if (lookup.sender) ids.add(lookup.sender.toLowerCase())
  for (const hop of lookup.hop1) ids.add(hop.toLowerCase())
  return ids.size
}

function tierExchange(exchange: ChanceInput['exchange']): TierExchange {
  if (
    exchange === 'binance' ||
    exchange === 'okx' ||
    exchange === 'bybit' ||
    exchange === 'coinbase' ||
    exchange === 'kraken' ||
    exchange === 'kucoin' ||
    exchange === 'htx' ||
    exchange === 'other'
  ) {
    return exchange
  }
  return 'other'
}

/** Re-run the tier rules after the person gives a country of residence on the result screen. */
export function recommendationWithCountry(
  input: ChanceInput,
  verdict: Verdict,
  trace: { addressesCount: number | null; htxLinked: boolean },
  clientCountry: string,
): PublicResult['recommendation'] {
  return tierRecommendation(input, verdict, trace.addressesCount, trace.htxLinked, clientCountry)
}

function recommendationFor(input: ChanceInput, verdict: Verdict, lookup: HopLookup): PublicResult['recommendation'] {
  return tierRecommendation(input, verdict, knownAddresses(lookup), htxLinkedFromLookup(lookup), undefined)
}

function tierRecommendation(
  input: ChanceInput,
  verdict: Verdict,
  addressesCount: number | null,
  htxLinked: boolean,
  clientCountry: string | undefined,
): PublicResult['recommendation'] {
  if (verdict === 'cannot_help') return null
  const picked = recommendTier(
    {
      exchange: tierExchange(input.exchange),
      verdict,
      addressesCount,
      fundsSources: input.fundsSources ?? sourcesFromOrigin(input.origin),
      priorExchangeRejection: input.priorExchangeRejection ?? input.priorRefusal,
      priorRoundsCount: input.priorRoundsCount,
      // SERV is not connected, so these stay unknown and their rules do not fire.
      requestedDocs: [],
      ownershipProofRequested: false,
      evidence: input.evidence ?? [],
      disputedDepositsCount: input.disputedDepositsCount ?? 1,
      holdType: input.holdType,
      // A Travel Rule cause is confirmed only by our own check. The form cannot set this.
      travelRuleConfirmed: false,
      clientCountry,
      htxLinked,
    },
    PRODUCT_TIER_CONFIG,
  )
  if (picked.reason === 'NOT_ELIGIBLE') return null
  const reason = picked.reason in REASON_LINE
    ? REASON_LINE[picked.reason as RuleId]
    : picked.status === 'blocked_need_country'
      ? NEED_COUNTRY_NOTE
      : REFUSAL_LINE[picked.reason as RefusalReason]
  return {
    tier: picked.tier,
    reasonId: picked.reason,
    reason,
    missing: picked.reason in MISSING_LINE ? MISSING_LINE[picked.reason as RuleId] : '',
    priceUsd: picked.tier === 'full' ? PRODUCT_TIER_CONFIG.price.full : PRODUCT_TIER_CONFIG.price.light,
    note: picked.flags.includes('TRAVEL_RULE_VERIFY_FIRST') ? TRAVEL_RULE_VERIFY_NOTE : TIER_NOTE,
    status: picked.status === 'ok' ? 'ok' : picked.status,
    canOpenCase: picked.canOpenCase,
    lowChance: { required: picked.lowChanceAck.required, warnings: picked.lowChanceAck.warnings },
    lightAllowed: picked.lightAllowed,
    lightBlockedNote: picked.lightBlockedNote,
    flags: picked.flags,
  }
}

function depositLink(chain: ChanceInput['chain'], deposit: string): string | null {
  const kind = classifyDeposit(chain, deposit)
  if (!kind) return null
  return explorerUrl(chain, kind, deposit)
}

function banAddresses(lookup: HopLookup): string[] {
  if (!lookup.sender || !lookup.firstHopOk) return lookup.sender ? [lookup.sender] : []
  return [lookup.sender, ...lookup.hop1]
}

function mergeCategories(lexicon: Category[], servCategory: Category | null): Category[] {
  const set = new Set<Category>(lexicon)
  if (servCategory && servCategory !== 'unknown') set.add(servCategory)
  return [...set]
}

async function safeClassify(serv: ServHooks, notice: string): Promise<Category | null> {
  try {
    return await serv.classify(notice)
  } catch {
    return null
  }
}

async function safeExplain(serv: ServHooks, verdict: Verdict, reasons: string[]): Promise<string | null> {
  try {
    return await serv.explain(verdict, reasons)
  } catch {
    return null
  }
}

function decisionInput(input: ChanceInput): Record<string, unknown> {
  return {
    exchange: input.exchange,
    notice: input.notice,
    amount: input.amount,
    asset: input.asset,
    chain: input.chain,
    deposit: input.chain === 'tron' ? input.deposit : input.deposit.toLowerCase(),
    date: input.date,
    origin: input.origin,
    hasDocuments: input.hasDocuments,
    priorRefusal: input.priorRefusal,
    fundsSources: input.fundsSources,
    evidence: input.evidence,
    priorExchangeRejection: input.priorExchangeRejection,
    priorRoundsCount: input.priorRoundsCount,
    disputedDepositsCount: input.disputedDepositsCount,
  }
}

export function createServHooks(complete: ServComplete): ServHooks {
  return {
    async injection(notice) {
      return servInjectionCheck(notice, complete)
    },
    async classify(notice) {
      const fenced = fence(notice, 8000)
      const result = await servStructured(
        {
          system: `You classify an exchange freeze notice. ${UNTRUSTED_RULE} Pick one category. Do not give legal advice and do not promise that funds will be released. thaw.notice.v1`,
          user: fenced,
          schemaName: 'notice_category',
          jsonSchema: NOTICE_SCHEMA,
          promptVersion: 'thaw.notice.v1',
          servTools: { promptGuard: true },
          parse: (value) => {
            const category = (value as { category?: string }).category
            if (!category || !(CATEGORY_LIST as readonly string[]).includes(category)) {
              throw new Error('bad category')
            }
            return category as Category
          },
        },
        complete,
      )
      return result.data
    },
    async explain(verdict, reasons) {
      const fenced = fence(JSON.stringify({ verdict, reasons }), 4000)
      const result = await servChat(
        {
          system: `Explain the given verdict in plain Russian, in 2 to 4 sentences. ${UNTRUSTED_RULE} This is document preparation, not legal advice. Do not promise an unfreeze. thaw.explain.v1`,
          user: fenced,
          promptVersion: 'thaw.explain.v1',
          servTools: { promptGuard: true },
        },
        complete,
      )
      return result.text
    },
  }
}
