import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'
import { migrate } from './migrations'

export type DbClient = {
  sqlite: Database
  db: ReturnType<typeof drizzle<typeof schema>>
}

export function createDbClient(userDataPath: string): DbClient {
  mkdirSync(userDataPath, { recursive: true })
  const sqlite = new Database(join(userDataPath, 'qa-scribe.sqlite'), { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  migrate(sqlite)

  return {
    sqlite,
    db: drizzle({ client: sqlite, schema })
  }
}
