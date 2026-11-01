import { ORDINARY_CATEGORIES, STOP_CATEGORIES, type Category, type Origin, type Verdict } from './constants.ts'

export const REASON = {
  police: 'В уведомлении удержание по запросу полиции или суда.',
  sanctions: 'В уведомлении санкции.',
  theft: 'В уведомлении связь с кражей или заявлением жертвы.',
  closure: 'В уведомлении окончательное закрытие.',
  servStop: 'Модель отнесла текст к стоп-категории, и правила это учли.',
  banned: 'Проверка адреса вернула запрет. В ответе это одно поле: чёрный список или санкции.',
  ordinary: 'В тексте обычная проверка происхождения средств, без стоп-фразы из словаря.',
  vague: 'В тексте нет знакомой формулировки обычной проверки и нет стоп-фразы из словаря.',
  banOff: 'Платные проверки адресов выключены, поэтому высокий шанс не ставим.',
  banUnpaid: 'Проверку адреса не оплатили, результата нет, поэтому высокий шанс не ставим.',
  banUnknown: 'Проверка адреса не дала ответа, поэтому высокий шанс не ставим.',
  lookupFail: 'Депозит в блокчейне сверить не удалось.',
  hopFail: 'Первый хоп прочитать не удалось.',
  amountMismatch: 'Сумма не совпала с переводом в блокчейне.',
  dateMismatch: 'Дата не совпала с датой блока (сравнение по календарному дню UTC).',
  amountUnknown: 'Сумму на цепи сверить не удалось.',
  dateUnknown: 'Дату на цепи сверить не удалось.',
  p2pNone: 'P2P без записей: такое происхождение сложнее подтвердить.',
  p2pSome: 'P2P с частью документов: по этим правилам это не высокий шанс.',
  prior: 'Уже был отказ по апелляции.',
  origin: 'Для высокого шанса эти правила принимают только покупку на другой бирже.',
  exchangeIgnored: 'Отдельные безнадёжные формулировки по биржам не включены: список не был проверен.',
  pageLimit: 'Первый хоп — это до 10 входящих из одной страницы истории, не вся история адреса.',
} as const

export const RAISE = {
  statement: 'Выписка банка или биржи с покупкой.',
  p2p: 'История сделок P2P и переписка с контрагентом.',
  video: 'Видео вывода с исходной площадки.',
  tax: 'Налоговая декларация, где виден доход.',
  explainGap: 'Объяснение, почему сумма или дата не совпадают.',
  ban: 'Нужна проверка санкций и чёрного списка по отправителю и первому хопу.',
  lawyer: 'При удержании по запросу полиции или суда нужен юрист. Наши документы это не заменяют.',
  noHelp: 'В таком случае наши документы шанс не поднимают. Не платите тем, кто обещает разморозку.',
} as const

export const EXPLAIN = {
  high: 'Похоже на стандартную проверку. Такие запросы обычно закрываются документами. Гарантировать результат мы не можем.',
  medium: 'Есть косвенный риск в истории средств. Шанс зависит от того, насколько полно вы подтвердите происхождение.',
  low: 'Шанс невысокий. Вот что мешает и что может помочь.',
  cannot_help: 'В таких случаях документы от нас не помогут. Не платите никому, кто обещает разморозку.',
} as const

const STOP_REASON: Record<(typeof STOP_CATEGORIES)[number], string> = {
  law_enforcement: REASON.police,
  sanctions: REASON.sanctions,
  theft: REASON.theft,
  final_closure: REASON.closure,
}

export type BanState = 'clean' | 'banned' | 'disabled' | 'unpaid' | 'unavailable' | 'not_checked'

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
  else if (facts.ban !== 'clean') blocksHigh.push(REASON.banUnknown)
  if (!facts.lookupOk) blocksHigh.push(REASON.lookupFail)
  if (!facts.firstHopOk) blocksHigh.push(REASON.hopFail)
  if (facts.amountMatch === 'unknown') blocksHigh.push(REASON.amountUnknown)
  if (facts.dateMatch === 'unknown') blocksHigh.push(REASON.dateUnknown)
  if (facts.origin === 'p2p' && facts.hasDocuments === true) blocksHigh.push(REASON.p2pSome)
  if (facts.origin !== 'exchange_purchase') blocksHigh.push(REASON.origin)

  const raise: string[] = [...DOCUMENT_RAISE]
  if (facts.amountMatch === 'mismatch' || facts.dateMatch === 'mismatch') raise.push(RAISE.explainGap)
  if (facts.ban === 'disabled' || facts.ban === 'unpaid' || facts.ban === 'unavailable') raise.push(RAISE.ban)

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
