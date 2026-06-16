import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { migrate } from './migrations'

export type DbClient = {
  sqlite: Database.Database
  db: ReturnType<typeof drizzle<typeof schema>>
}

export function createDbClient(userDataPath: string): DbClient {
  mkdirSync(userDataPath, { recursive: true })
  const sqlite = new Database(join(userDataPath, 'qa-scribe.sqlite'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)

  return {
    sqlite,
    db: drizzle(sqlite, { schema })
  }
}
