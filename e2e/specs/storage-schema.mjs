import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storage = readFileSync(new URL('../../crates/qa-scribe-core/src/storage/mod.rs', import.meta.url), 'utf8')
const declaration = storage.match(/^pub const SCHEMA_VERSION: i32 = (\d+);$/m)
assert.ok(declaration, 'The storage module must declare the current schema version')

export const expectedStorageSchemaVersion = Number(declaration[1])
