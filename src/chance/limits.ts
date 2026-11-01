import { CACHE_TTL_MS, DEFAULT_DAILY_CHECKS, DEFAULT_SPEND_CAP_USD, usdToMicro } from './constants.ts'

export type LimitConfig = {
  dailyChecks: number
  spendCapMicro: number
  cacheTtlMs: number
}

export function defaultLimitConfig(now = Date.now()): LimitConfig {
  void now
  return {
    dailyChecks: numberFromEnv('THAW_DAILY_CHECK_LIMIT', DEFAULT_DAILY_CHECKS),
    spendCapMicro: usdToMicro(numberFromEnv('THAW_DAILY_SPEND_CAP_USD', DEFAULT_SPEND_CAP_USD)),
    cacheTtlMs: CACHE_TTL_MS,
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}

export type CacheEntry<T> = { expiresAt: number; value: T }

export type LimitStore = {
  checks: Map<string, { day: string; count: number }>
  spendDay: string
  spentMicro: number
  cache: Map<string, CacheEntry<unknown>>
}

export function createStore(): LimitStore {
  return { checks: new Map(), spendDay: '', spentMicro: 0, cache: new Map() }
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function userKey(ip: string, clientId: string | undefined, day: string): string {
  return `${day}|${ip}|${clientId ?? ''}`
}

export function cacheKey(chain: string, deposit: string): string {
  const id = chain === 'tron' ? deposit.trim() : deposit.trim().toLowerCase()
  return `${chain}|${id}`
}

export function readCache<T>(store: LimitStore, key: string, now: number): T | null {
  const hit = store.cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= now) {
    store.cache.delete(key)
    return null
  }
  return hit.value as T
}

export function writeCache<T>(store: LimitStore, key: string, value: T, now: number, ttlMs: number): void {
  store.cache.set(key, { expiresAt: now + ttlMs, value })
}

export function takeUserSlot(store: LimitStore, key: string, day: string, limit: number): boolean {
  const row = store.checks.get(key)
  if (!row || row.day !== day) {
    store.checks.set(key, { day, count: 1 })
    return true
  }
  if (row.count >= limit) return false
  row.count += 1
  return true
}

export function giveBackSlot(store: LimitStore, key: string): void {
  const row = store.checks.get(key)
  if (!row) return
  row.count = Math.max(0, row.count - 1)
}

export function reserveSpend(store: LimitStore, day: string, micro: number, capMicro: number): boolean {
  if (store.spendDay !== day) {
    store.spendDay = day
    store.spentMicro = 0
  }
  if (micro <= 0) return true
  if (store.spentMicro + micro > capMicro) return false
  store.spentMicro += micro
  return true
}
