import { CHAINS, EXCHANGES, ORIGINS, type Chain, type Exchange, type Origin } from './constants.ts'
import { classifyDeposit } from './address.ts'
import type { Evidence, FundsSource, HoldType } from './tier.ts'

const FUNDS: readonly FundsSource[] = ['other_exchange', 'own_wallet', 'p2p', 'otc', 'defi', 'unknown']
const HOLDS: readonly HoldType[] = ['travel_rule', 'aml', 'unknown']
const EVIDENCE: readonly Evidence[] = ['bank_statements', 'income_docs', 'exchange_export', 'txid_only', 'none']

export type ChanceInput = {
  exchange: Exchange
  notice: string
  amount: string
  asset: string
  chain: Chain
  deposit: string
  date: string
  origin: Origin
  hasDocuments: boolean | null
  priorRefusal: boolean
  fundsSources?: FundsSource[]
  evidence?: Evidence[]
  priorExchangeRejection?: boolean
  priorRoundsCount?: number
  disputedDepositsCount?: number
  holdType?: HoldType
  clientCountry?: string
  clientNationalities?: string[]
  htxLinked?: boolean
  clientId?: string
  captchaToken?: string
}

export type ParseResult = { ok: true; value: ChanceInput } | { ok: false; error: string }

const SECRET_KEYS = ['privatekey', 'private_key', 'seed', 'seedphrase', 'seed_phrase', 'mnemonic']

export function parseChanceInput(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Нужен объект с полями проверки.' }
  }
  const row = body as Record<string, unknown>
  for (const key of Object.keys(row)) {
    if (SECRET_KEYS.includes(key.toLowerCase().replace(/[\s-]/g, ''))) {
      return { ok: false, error: 'Мы не принимаем приватные ключи и сид-фразы.' }
    }
  }
  const exchange = readEnum(row.exchange, EXCHANGES)
  if (!exchange) return { ok: false, error: 'Укажите биржу из списка.' }
  if (typeof row.notice !== 'string' || row.notice.trim().length === 0 || row.notice.trim().length > 8000) {
    return { ok: false, error: 'Вставьте текст уведомления, до 8000 знаков.' }
  }
  if (typeof row.amount !== 'string' || !positiveAmount(row.amount)) {
    return { ok: false, error: 'Укажите сумму обычным числом, больше нуля.' }
  }
  if (typeof row.asset !== 'string' || !/^[A-Za-z]{2,12}$/.test(row.asset)) {
    return { ok: false, error: 'Укажите актив буквами, например USDT.' }
  }
  const chain = readEnum(row.chain, CHAINS)
  if (!chain) return { ok: false, error: 'Сеть: tron, ethereum, arbitrum или base.' }
  if (typeof row.deposit !== 'string' || !classifyDeposit(chain, row.deposit)) {
    return { ok: false, error: 'Депозит должен быть адресом или txid этой сети.' }
  }
  if (typeof row.date !== 'string' || !validDay(row.date)) {
    return { ok: false, error: 'Дата в формате ГГГГ-ММ-ДД.' }
  }
  const listedSources = readList(row.fundsSources, FUNDS)
  if (listedSources === 'bad') return { ok: false, error: 'Укажите происхождение средств из списка.' }
  const hasSourceList = Array.isArray(row.fundsSources)
  const origin = hasSourceList ? originFromSources(listedSources) : readEnum(row.origin, ORIGINS)
  if (!origin) return { ok: false, error: 'Укажите, откуда средства, из списка.' }
  const fundsSources = hasSourceList ? listedSources : sourcesFromOrigin(origin)
  const listedEvidence = readList(row.evidence, EVIDENCE)
  if (listedEvidence === 'bad') return { ok: false, error: 'Укажите, какие документы уже есть, из списка.' }
  const evidence = Array.isArray(row.evidence) ? listedEvidence : []
  const documents = Array.isArray(row.evidence) ? documentsFromEvidence(evidence) : readDocuments(row.hasDocuments)
  if (documents === 'bad') return { ok: false, error: 'Поле документов: yes, no или пусто.' }
  const rejected = row.priorExchangeRejection === true || row.priorExchangeRejection === 'yes' || row.priorRefusal === true || row.priorRefusal === 'yes'
  let priorRoundsCount: number | undefined
  if (row.priorRoundsCount !== undefined && row.priorRoundsCount !== '') {
    const rounds = typeof row.priorRoundsCount === 'number' ? row.priorRoundsCount : Number(row.priorRoundsCount)
    if (!Number.isInteger(rounds) || rounds < 0 || rounds > 20) return { ok: false, error: 'Число раундов должно быть от 0 до 20.' }
    priorRoundsCount = rounds
  }
  let disputedDepositsCount = 1
  if (row.disputedDepositsCount !== undefined && row.disputedDepositsCount !== '') {
    const count = typeof row.disputedDepositsCount === 'number' ? row.disputedDepositsCount : Number(row.disputedDepositsCount)
    if (!Number.isInteger(count) || count < 1 || count > 20) return { ok: false, error: 'Число спорных депозитов должно быть от 1 до 20.' }
    disputedDepositsCount = count
  }
  let clientId: string | undefined
  if (row.clientId !== undefined && row.clientId !== '') {
    if (typeof row.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(row.clientId)) {
      return { ok: false, error: 'Идентификатор браузера не подходит.' }
    }
    clientId = row.clientId
  }
  const captchaToken = typeof row.captchaToken === 'string' ? row.captchaToken : undefined
  const holdType = readEnum(row.holdType, HOLDS) ?? undefined
  const clientCountry = readCountry(row.clientCountry)
  if (clientCountry === 'bad') return { ok: false, error: 'Country of residence should be a two-letter code.' }
  const nationalities = readCountries(row.clientNationalities)
  if (nationalities === 'bad') return { ok: false, error: 'Citizenships should be two-letter codes.' }
  // The client cannot confirm a Travel Rule cause. That flag is set only after our own check.
  return {
    ok: true,
    value: {
      exchange,
      notice: row.notice.trim(),
      amount: row.amount,
      asset: row.asset.toUpperCase(),
      chain,
      deposit: row.deposit.trim(),
      date: row.date,
      origin,
      hasDocuments: documents,
      priorRefusal: rejected || (priorRoundsCount ?? 0) >= 1,
      fundsSources,
      evidence,
      priorExchangeRejection: rejected,
      priorRoundsCount,
      disputedDepositsCount,
      holdType,
      clientCountry,
      clientNationalities: nationalities,
      htxLinked: row.htxLinked === true || row.htxLinked === 'yes',
      clientId,
      captchaToken,
    },
  }
}

function readList<T extends string>(value: unknown, allowed: readonly T[]): T[] | 'bad' {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'bad'
  const out: T[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(allowed as readonly string[]).includes(item)) return 'bad'
    if (!out.includes(item as T)) out.push(item as T)
  }
  return out
}

function originFromSources(sources: FundsSource[]): Origin {
  if (sources.includes('p2p')) return 'p2p'
  if (sources.includes('otc')) return 'otc'
  if (sources.includes('defi')) return 'defi_airdrop'
  if (sources.includes('other_exchange')) return 'exchange_purchase'
  if (sources.includes('own_wallet')) return 'unknown'
  return 'unknown'
}

export function sourcesFromOrigin(origin: Origin): FundsSource[] {
  if (origin === 'exchange_purchase') return ['other_exchange']
  if (origin === 'p2p') return ['p2p']
  if (origin === 'otc') return ['otc']
  if (origin === 'defi_airdrop') return ['defi']
  if (origin === 'transfer_person') return ['own_wallet']
  if (origin === 'unknown') return ['unknown']
  return ['unknown']
}

function documentsFromEvidence(evidence: Evidence[]): boolean | null {
  if (evidence.some((item) => item === 'bank_statements' || item === 'income_docs' || item === 'exchange_export')) return true
  if (evidence.length === 0) return null
  return false
}

function readCountry(value: unknown): string | undefined | 'bad' {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return 'bad'
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return 'bad'
  return code
}

function readCountries(value: unknown): string[] | 'bad' {
  if (value === undefined || value === null || value === '') return []
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : null
  if (!raw) return 'bad'
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim() === '') continue
    const code = readCountry(item)
    if (code === 'bad') return 'bad'
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function readDocuments(value: unknown): boolean | null | 'bad' {
  if (value === undefined || value === null || value === '') return null
  if (value === true || value === 'yes') return true
  if (value === false || value === 'no') return false
  return 'bad'
}

function positiveAmount(amount: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) return false
  return !/^0+(?:\.0+)?$/.test(amount)
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(time)) return false
  return new Date(time).toISOString().slice(0, 10) === value
}
