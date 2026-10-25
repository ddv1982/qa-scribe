import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ownershipFixture = join(root, 'crates', 'qa-scribe-core', 'tests', 'fixtures', 'ask-ai-schema18')
export const ownershipFixtureSha256 = '3f68b6b35dd720c719e9d7a959a2ce5c518155b1aaf72009ff3fd05ab4f38ae0'

export function prepareOwnershipFixture(data) {
  const source = join(ownershipFixture, 'v18.sqlite')
  const actual = createHash('sha256').update(readFileSync(source)).digest('hex')
  if (actual !== ownershipFixtureSha256) throw Error(`Frozen schema-18 fixture changed: ${actual}`)
  const destination = join(data, 'qa-scribe.sqlite')
  if (existsSync(destination)) throw Error('Ownership migration requires fresh isolated app data')
  mkdirSync(data, { recursive: true })
  cpSync(source, destination, { errorOnExist: true, force: false })
  cpSync(join(ownershipFixture, 'attachments'), join(data, 'attachments'), { recursive: true, errorOnExist: true, force: false })
}
