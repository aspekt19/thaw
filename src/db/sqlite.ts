import { DatabaseSync } from 'node:sqlite'
import type { SqlDb, SqlPrepared } from './sql.ts'

/** Test stand-in for D1. Runs the same SQL. */
export function sqliteDb(sql: string): SqlDb {
  const db = new DatabaseSync(':memory:')
  db.exec(sql)
  return {
    prepare(statement: string): SqlPrepared {
      const prepared = db.prepare(statement)
      const bound: unknown[] = []
      const api: SqlPrepared = {
        bind(...values: unknown[]) {
          bound.splice(0, bound.length, ...values)
          return api
        },
        async first<T extends Record<string, unknown>>() {
          const row = prepared.get(...(bound as never[]))
          return (row as T | undefined) ?? null
        },
        async run() {
          const info = prepared.run(...(bound as never[]))
          return { meta: { changes: Number(info.changes) } }
        },
        async all<T extends Record<string, unknown>>() {
          const results = prepared.all(...(bound as never[])) as T[]
          return { results }
        },
      }
      return api
    },
    async batch(statements) {
      db.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    async exec(script) {
      db.exec(script)
    },
  }
}
