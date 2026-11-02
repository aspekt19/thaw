import { ORDINARY_CATEGORIES, STOP_CATEGORIES, type Category, type Origin, type Verdict } from './constants.ts'

export const REASON = {
  police: 'The notice says the hold is for the police or a court.',
  sanctions: 'The notice mentions sanctions.',
  theft: 'The notice links the funds to theft or a victim report.',
  closure: 'The notice says the account is finally closed.',
  servStop: 'The notice was classed as a case we decline, and the rules kept that.',
  banned: 'The address check returned a ban. That answer does not split a blacklist from sanctions.',
  ordinary: 'The notice reads as an ordinary source-of-funds check, with no stop phrase from the list.',
  vague: 'The notice has no familiar ordinary-check phrase and no stop phrase from the list.',
  banOff: 'Paid address checks are off, so the rules will not call this a high chance.',
  banUnpaid: 'The address check was not paid, so there is no result and this cannot be a high chance.',
  banUnknown: 'The address check did not answer, so this cannot be a high chance.',
  banBase: 'The USDT address list does not document Base, so we do not send a Base address there. That keeps this from a high chance.',
  lookupFail: 'The deposit could not be read on chain.',
  hopFail: 'The first hop could not be read.',
  amountMismatch: 'The amount does not match the transfer on chain.',
  dateMismatch: 'The date does not match the block date, compared as a UTC calendar day.',
  amountUnknown: 'The amount could not be checked on chain.',
  dateUnknown: 'The date could not be checked on chain.',
  p2pNone: 'P2P with no records is harder to support.',
  p2pSome: 'P2P with some records is not a high chance under these rules.',
  prior: 'An appeal was already refused.',
  origin: 'These rules treat only a purchase on another exchange as a high chance.',
  exchangeIgnored: 'Per-exchange hopeless templates are not in the rules. That list was not verified.',
  pageLimit: 'The first hop is up to ten incoming transfers from one page of history, not the whole history.',
} as const

export const RAISE = {
  statement: 'A bank or exchange statement that shows the purchase.',
  p2p: 'P2P trade history and the messages with the counterparty.',
  video: 'A video of the withdrawal from the source platform.',
  tax: 'A tax return that shows the income.',
  explainGap: 'An explanation of why the amount or the date does not match.',
  ban: 'A sanctions and blacklist check on the sender and the first hop.',
  lawyer: 'A police or court hold needs a lawyer. Our papers do not replace one.',
  noHelp: 'Our papers do not raise the chance here. Do not pay anyone who promises a release.',
} as const

export const EXPLAIN = {
  high: 'This looks like an ordinary check. Those requests are usually answered with papers. We cannot guarantee the outcome.',
  medium: 'There is an indirect risk in the history of the funds. The chance depends on how fully you can show where they came from.',
  low: 'The chance is low. The reasons say what is in the way, and what could help.',
  cannot_help: 'Our papers will not help this notice. Do not pay anyone who promises a release.',
} as const

const STOP_REASON: Record<(typeof STOP_CATEGORIES)[number], string> = {
  law_enforcement: REASON.police,
  sanctions: REASON.sanctions,
  theft: REASON.theft,
  final_closure: REASON.closure,
}

export type BanState = 'clean' | 'banned' | 'disabled' | 'unpaid' | 'unavailable' | 'not_checked' | 'unsupported'

export type Match = 'match' | 'mismatch' | 'unknown'

export type RuleFacts = {
  categories: Category[]
  /** Categories that came only from the model, not the phrase list. */
  servOnly: Category[]
  ban: BanState
  lookupOk: boolean
  firstHopOk: boolean
  amountMatch: Match
  dateMatch: Match
  origin: Origin
  hasDocuments: boolean | null
  priorRefusal: boolean
}

export type RuleDecision = {
  verdict: Verdict
  reasons: string[]
  whatWouldRaiseChance: string[]
  explanation: string
}

const DOCUMENT_RAISE = [RAISE.statement, RAISE.p2p, RAISE.video, RAISE.tax]

function isStop(category: Category): category is (typeof STOP_CATEGORIES)[number] {
  return (STOP_CATEGORIES as readonly string[]).includes(category)
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function isOrdinary(category: Category): boolean {
  return (ORDINARY_CATEGORIES as readonly string[]).includes(category)
}

export function decide(facts: RuleFacts): RuleDecision {
  const reasons: string[] = []
  const stops = facts.categories.filter(isStop)
  if (stops.length > 0) {
    for (const stop of stops) reasons.push(STOP_REASON[stop])
    const fromModel = stops.some((stop) => facts.servOnly.includes(stop))
    const fromLexicon = stops.some((stop) => !facts.servOnly.includes(stop))
    if (fromModel && !fromLexicon) reasons.push(REASON.servStop)
    const raise = stops.includes('law_enforcement')
      ? [RAISE.lawyer, RAISE.noHelp]
      : [RAISE.noHelp]
    return {
      verdict: 'cannot_help',
      reasons,
      whatWouldRaiseChance: raise,
      explanation: EXPLAIN.cannot_help,
    }
  }

  if (facts.ban === 'banned') {
    return {
      verdict: 'cannot_help',
      reasons: [REASON.banned],
      whatWouldRaiseChance: [RAISE.noHelp],
      explanation: EXPLAIN.cannot_help,
    }
  }

  const ordinary = facts.categories.some(isOrdinary)
  reasons.push(ordinary ? REASON.ordinary : REASON.vague)
  reasons.push(REASON.exchangeIgnored)
  reasons.push(REASON.pageLimit)

  const low: string[] = []
  if (facts.priorRefusal) low.push(REASON.prior)
  if (facts.amountMatch === 'mismatch') low.push(REASON.amountMismatch)
  if (facts.dateMatch === 'mismatch') low.push(REASON.dateMismatch)
  if (facts.origin === 'p2p' && facts.hasDocuments === false) low.push(REASON.p2pNone)

  const blocksHigh: string[] = []
  if (!ordinary) blocksHigh.push(REASON.vague)
  if (facts.ban === 'disabled') blocksHigh.push(REASON.banOff)
  else if (facts.ban === 'unpaid') blocksHigh.push(REASON.banUnpaid)
  else if (facts.ban === 'unsupported') blocksHigh.push(REASON.banBase)
  else if (facts.ban !== 'clean') blocksHigh.push(REASON.banUnknown)
  if (!facts.lookupOk) blocksHigh.push(REASON.lookupFail)
  if (!facts.firstHopOk) blocksHigh.push(REASON.hopFail)
  if (facts.amountMatch === 'unknown') blocksHigh.push(REASON.amountUnknown)
  if (facts.dateMatch === 'unknown') blocksHigh.push(REASON.dateUnknown)
  if (facts.origin === 'p2p' && facts.hasDocuments === true) blocksHigh.push(REASON.p2pSome)
  if (facts.origin !== 'exchange_purchase') blocksHigh.push(REASON.origin)

  const raise: string[] = [...DOCUMENT_RAISE]
  if (facts.amountMatch === 'mismatch' || facts.dateMatch === 'mismatch') raise.push(RAISE.explainGap)
  if (facts.ban === 'disabled' || facts.ban === 'unpaid' || facts.ban === 'unavailable' || facts.ban === 'unsupported') raise.push(RAISE.ban)

  if (low.length > 0) {
    return {
      verdict: 'low',
      reasons: unique([...reasons, ...low]),
      whatWouldRaiseChance: raise,
      explanation: EXPLAIN.low,
    }
  }

  if (blocksHigh.length > 0) {
    return {
      verdict: 'medium',
      reasons: unique([...reasons, ...blocksHigh]),
      whatWouldRaiseChance: raise,
      explanation: EXPLAIN.medium,
    }
  }

  return {
    verdict: 'high',
    reasons,
    whatWouldRaiseChance: raise,
    explanation: EXPLAIN.high,
  }
}
