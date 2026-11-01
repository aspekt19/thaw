import { CHAINS, EXCHANGES, ORIGINS, type Chain, type Exchange, type Origin } from './constants.ts'
import { classifyDeposit } from './address.ts'

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
  if (!chain) return { ok: false, error: 'Сеть: tron, ethereum или arbitrum.' }
  if (typeof row.deposit !== 'string' || !classifyDeposit(chain, row.deposit)) {
    return { ok: false, error: 'Депозит должен быть адресом или txid этой сети.' }
  }
  if (typeof row.date !== 'string' || !validDay(row.date)) {
    return { ok: false, error: 'Дата в формате ГГГГ-ММ-ДД.' }
  }
  const origin = readEnum(row.origin, ORIGINS)
  if (!origin) return { ok: false, error: 'Укажите, откуда средства, из списка.' }
  const documents = readDocuments(row.hasDocuments)
  if (documents === 'bad') return { ok: false, error: 'Поле документов: yes, no или пусто.' }
  let clientId: string | undefined
  if (row.clientId !== undefined && row.clientId !== '') {
    if (typeof row.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(row.clientId)) {
      return { ok: false, error: 'Идентификатор браузера не подходит.' }
    }
    clientId = row.clientId
  }
  const captchaToken = typeof row.captchaToken === 'string' ? row.captchaToken : undefined
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
      priorRefusal: row.priorRefusal === true || row.priorRefusal === 'yes',
      clientId,
      captchaToken,
    },
  }
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
