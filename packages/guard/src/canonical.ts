/**
 * canonicalJson and sha256Hex from AllowLatch src/lib/decision-record.ts
 * at f33257df64e1600c61185ab1a2835e3b9e58f536.
 * The seller-scoring record in that file is not copied.
 */
import { createHash } from 'node:crypto'

/** JSON with sorted object keys, so equal data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
