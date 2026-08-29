import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getEnv } from '../config/env'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export function openDatabase(opts: { file: string; migrationsFolder: string }): Db {
  if (opts.file !== ':memory:') mkdirSync(dirname(opts.file), { recursive: true })
  const sqlite = new Database(opts.file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: opts.migrationsFolder })
  return db
}

let instance: Db | undefined

export function getDb(): Db {
  if (!instance) {
    const env = getEnv()
    instance = openDatabase({ file: env.dbFile, migrationsFolder: env.migrationsDir })
  }
  return instance
}

export function closeDb(): void {
  instance?.$client.close()
  instance = undefined
}
