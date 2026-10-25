import { expect, vi } from 'vitest'
import type { Draft, DraftPatch, Finding, FindingPatch, RecordWriteGuard } from '../bindings'
import { RecordWriteConflict } from './recordWriteGuards'

const { createHash } = await vi.importActual<{
  createHash: (algorithm: 'sha256') => { update: (text: string) => { digest: (encoding: 'hex') => string } }
}>('node:crypto')

export type RecordKind = 'draft' | 'finding'
export type RecordValue = Draft | Finding
export type RecordPatch = DraftPatch | FindingPatch
export type RecordRequest = {
  before: RecordValue
  patch: RecordPatch
  guard: RecordWriteGuard
  outcome: 'saved' | 'restored-noop' | 'conflict' | 'validation'
  after: RecordValue
}

export function storedRecordBase(record: RecordValue, kind: RecordKind): string {
  return createHash('sha256').update(JSON.stringify([
    kind === 'draft' ? 'drafts' : 'findings', record.sessionId, record.id,
    [record.title, record.body, record.bodyJson, record.bodyFormat ?? 'html', record.kind, record.metadataJson],
  ])).digest('hex')
}

export function recordStorage(initial: RecordValue, kind: RecordKind, additional: RecordValue[] = []) {
  const records = new Map([initial, ...additional].map(record => [record.id, record]))
  const requests: RecordRequest[] = []
  function transact(id: string, patch: RecordPatch, guard: RecordWriteGuard): RecordValue {
    const before = records.get(id)
    if (!before) throw new Error(`Missing fixture record ${id}`)
    expect(id).toBe(before.id)
    expect(guard.sessionId).toBe(before.sessionId)
    expect(guard.origin.kind === 'editor' || guard.origin.kind === 'compensation' && guard.origin.stageId === null).toBe(true)
    const actualBase = storedRecordBase(before, kind)
    if (actualBase !== guard.expectedStoredBase) {
      const restored = guard.origin.kind === 'compensation' && guard.origin.restoredBase === actualBase
      requests.push({ before, patch, guard, outcome: restored ? 'restored-noop' : 'conflict', after: before })
      if (!restored) throw new RecordWriteConflict({ ...before })
      return { ...before }
    }
    const fields = {
      title: patch.title == null ? before.title : patch.title.trim(),
      body: patch.body ?? before.body,
      bodyJson: patch.bodyJson === undefined ? before.bodyJson : patch.bodyJson,
      bodyFormat: patch.bodyFormat ?? before.bodyFormat ?? 'html',
      metadataJson: patch.metadataJson === undefined ? before.metadataJson : patch.metadataJson,
    }
    const after = 'aiRunId' in before ? { ...before, ...fields }
      : { ...before, ...fields, kind: 'kind' in patch ? patch.kind ?? before.kind : before.kind }
    if (!after.title) {
      requests.push({ before, patch, guard, outcome: 'validation', after: before })
      throw new Error(`${kind === 'draft' ? 'Draft' : 'Finding'} title is required`)
    }
    if (guard.origin.kind === 'compensation' && storedRecordBase(after, kind) !== guard.origin.restoredBase) {
      requests.push({ before, patch, guard, outcome: 'validation', after: before })
      throw new Error('Compensation does not match its pinned restored record')
    }
    records.set(id, after)
    requests.push({ before, patch, guard, outcome: 'saved', after })
    return { ...after }
  }
  function read(id = initial.id) {
    const record = records.get(id)
    if (!record) throw new Error(`Missing fixture record ${id}`)
    return record
  }
  function write(id: string, patch: RecordPatch, guard: RecordWriteGuard): Promise<RecordValue> {
    return Promise.resolve().then(() => transact(id, patch, guard))
  }
  return { requests, write, read, external: (record: RecordValue) => { records.set(record.id, record) } }
}
