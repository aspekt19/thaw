/** Exact decimal compare. No tolerance: the plan does not define one. */

export function amountToRaw(amount: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  const match = amount.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  const whole = match[1] ?? '0'
  const frac = match[2] ?? ''
  if (frac.length > decimals && /[^0]/.test(frac.slice(decimals))) return null
  const padded = frac.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(whole + padded)
}

export function compareAmount(
  stated: string,
  rawValue: string,
  decimals: number,
): 'match' | 'mismatch' | 'unknown' {
  if (!/^\d+$/.test(rawValue)) return 'unknown'
  const statedRaw = amountToRaw(stated, decimals)
  if (statedRaw === null) return 'mismatch'
  return statedRaw === BigInt(rawValue) ? 'match' : 'mismatch'
}

export function utcDayFromMs(ms: number): string | null {
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

export function compareDate(statedDay: string, ms: number | null): 'match' | 'mismatch' | 'unknown' {
  if (ms === null) return 'unknown'
  const day = utcDayFromMs(ms)
  if (!day) return 'unknown'
  return day === statedDay ? 'match' : 'mismatch'
}
