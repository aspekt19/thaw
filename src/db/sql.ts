import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function migrationSql(): string {
  const dir = join(here, '../../migrations')
  return ['0001_init.sql', '0002_case_payment.sql', '0003_low_confirm.sql'].map((name) => readFileSync(join(dir, name), 'utf8')).join('\n')
}

/** Minimal D1 surface the store uses. */
export type SqlPrepared = {
  bind(...values: unknown[]): SqlPrepared
  first<T extends Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ meta?: { changes?: number } }>
  all<T extends Record<string, unknown>>(): Promise<{ results: T[] }>
}

export type SqlDb = {
  prepare(sql: string): SqlPrepared
  batch(statements: SqlPrepared[]): Promise<Array<{ meta?: { changes?: number } }>>
  exec(sql: string): Promise<void>
}
