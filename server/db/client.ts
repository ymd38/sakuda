import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getEnv } from '../config/env'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

function openSqlite(file: string): Database.Database {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return sqlite
}

export function openDatabase(opts: { file: string; migrationsFolder: string }): Db {
  const sqlite = openSqlite(opts.file)
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: opts.migrationsFolder })
  return db
}

// Tracked alongside `instance` (rather than read back via drizzle's `$client`
// accessor) so closing the singleton never depends on cross-module-instance
// structural typing of drizzle's generic client parameter.
let instance: Db | undefined
let handle: Database.Database | undefined

export function getDb(): Db {
  if (!instance) {
    const env = getEnv()
    handle = openSqlite(env.dbFile)
    instance = drizzle(handle, { schema })
    migrate(instance, { migrationsFolder: env.migrationsDir })
  }
  return instance
}

export function closeDb(): void {
  handle?.close()
  instance = undefined
  handle = undefined
}
