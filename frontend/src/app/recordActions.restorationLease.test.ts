import { stageOrigin } from './proposalStage.testSupport'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Draft, DraftPatch, Finding, FindingPatch, RecordWriteGuard } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentFromStoredBody, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { createRecordPersistence, type RecordPersistenceContext } from './recordPersistence'
import { editorValue, recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'

type Kind = 'finding' | 'draft'
type Row = Draft | Finding
type Patch = DraftPatch | FindingPatch
const kinds = ['finding', 'draft'] as const
const boundaries = kinds.flatMap(kind => (['ack', 'hash'] as const).map(boundary => ({ kind, boundary })))
const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

function subject(kind: Kind) {
  const a = kind === 'finding' ? findingFixture({ title: 'A', body: '<p>A</p>' }) : draftFixture({ title: 'A', body: '<p>A</p>' })
  let stored: Row = a
  const table = kind === 'finding' ? 'findings' as const : 'drafts' as const
  const dirty = { current: new Set([a.id]) }
  const cleanup = vi.fn(async (_ids: string[]) => true)
  const feedback = { setError: vi.fn(), setNotice: vi.fn(), setBusyAction: vi.fn() }
  const ctx: RecordPersistenceContext = {
    session: { activeSessionIdRef: { current: a.sessionId } },
    records: {
      draftsRef: { current: [] }, findingsRef: { current: [] }, savedDraftsRef: { current: [] }, savedFindingsRef: { current: [] },
      dirtyDraftIdsRef: { current: new Set() }, dirtyFindingIdsRef: { current: new Set() },
      setDrafts: next => { ctx.records.draftsRef.current = typeof next === 'function' ? next(ctx.records.draftsRef.current) : next },
      setFindings: next => { ctx.records.findingsRef.current = typeof next === 'function' ? next(ctx.records.findingsRef.current) : next },
      setTestwareDraftCount: vi.fn(), setFindingCount: vi.fn(),
    },
    importedAttachments: { register: vi.fn(), remember: vi.fn(), pending: () => [], clear: vi.fn(), forget: vi.fn() },
    feedback,
    materializeInlineImages: async document => ({ document, importedAttachmentIds: [] }),
    cleanupMaterializedAttachments: cleanup,
  }
  if ('aiRunId' in a) {
    ctx.records.draftsRef.current = [a]; ctx.records.savedDraftsRef.current = [a]; ctx.records.dirtyDraftIdsRef = dirty
  } else {
    ctx.records.findingsRef.current = [a]; ctx.records.savedFindingsRef.current = [a]; ctx.records.dirtyFindingIdsRef = dirty
  }
  const persistence = createRecordPersistence(ctx)
  const c = persistence.coordination
  const key = `${kind}:${a.id}`
  const intents = kind === 'finding' ? c.findingIntents : c.draftIntents
  function install(row: Row) {
    if ('aiRunId' in row) ctx.records.draftsRef.current = [row]
    else ctx.records.findingsRef.current = [row]
    dirty.current.add(row.id)
  }
  function installSaved(row: Row) {
    if ('aiRunId' in row) ctx.records.savedDraftsRef.current = [row]
    else ctx.records.savedFindingsRef.current = [row]
  }
  function reserve(operation: 'save' | 'discard' | 'canonicalize' | 'delete', restore: Row | null = null) {
    if (kind === 'finding') return c.reserveFindingIntent(a.id, operation, restore && !('aiRunId' in restore) ? restore : null)
    return c.reserveDraftIntent(a.id, operation, restore && 'aiRunId' in restore ? restore : null)
  }
  async function write(_id: string, patch: Patch, guard: RecordWriteGuard) {
    const base = await recordWriteGuard(stored, table)
    if (guard.origin.kind === 'compensation' && guard.origin.restoredBase === base.expectedStoredBase) return { ...stored }
    if (guard.sessionId !== stored.sessionId || guard.expectedStoredBase !== base.expectedStoredBase) throw new RecordWriteConflict({ ...stored })
    stored = { ...stored, title: patch.title ?? stored.title, body: patch.body ?? stored.body,
      bodyJson: patch.bodyJson === undefined ? stored.bodyJson : patch.bodyJson,
      bodyFormat: patch.bodyFormat === undefined ? stored.bodyFormat : patch.bodyFormat }
    return { ...stored }
  }
  const command = kind === 'finding' ? api.updateFinding : api.updateDraft
  command.mockImplementation(write)
  const reconcile = () => kind === 'finding' ? c.reconcileFindingIntent(a.id) : c.reconcileDraftIntent(a.id)
  const save = () => kind === 'finding' ? persistence.findings.persistFinding(ctx.records.findingsRef.current[0]) : persistence.drafts.persistDraft(ctx.records.draftsRef.current[0])
  const canonicalize = (row: Row) => 'aiRunId' in row ? persistence.drafts.canonicalizeGeneratedDraft(row, row) : persistence.findings.canonicalizeGeneratedFinding(row, row)
  const confirm = (row: Row, guard: RecordWriteGuard, generation: number) => 'aiRunId' in row
    ? c.confirmedWrite({ record: row, kind: 'draft', guard, generation })
    : c.confirmedWrite({ record: row, kind: 'finding', guard, generation })
  const local = () => kind === 'finding' ? ctx.records.findingsRef.current[0] : ctx.records.draftsRef.current[0]
  return { a, ctx, c, key, intents, command, table, dirty, cleanup, feedback, write, reconcile, reserve, install, installSaved, save, canonicalize, confirm, local,
    read: () => stored, external: (row: Row) => { stored = row } }
}

async function held(kind: Kind, boundary: 'ack' | 'hash' = 'ack') {
  const s = subject(kind)
  const b = { ...s.a, title: 'B', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('B')) }
  s.reserve('save'); s.reserve('discard', s.a)
  const base = await s.c.guardFor(s.a, kind)
  await s.write(s.a.id, b, base)
  await s.confirm(b, base, 1)
  const lease = s.c.latestWriteGuards.get(s.key)!
  s.install({ ...s.a, title: 'C', body: '<p>C</p>' })
  const reached = deferred<void>(); const release = deferred<void>()
  let armed = false
  if (boundary === 'hash') {
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const hold = armed; if (hold) armed = false
      const hash = await digest(algorithm, data)
      if (hold) { reached.resolve(); await release.promise }
      return hash
    })
  }
  s.command.mockImplementationOnce(async (id: string, patch: Patch, guard: RecordWriteGuard) => {
    const restored = await s.write(id, patch, guard)
    if (boundary === 'hash') armed = true
    else { reached.resolve(); await release.promise }
    return restored
  })
  const pending = s.reconcile()
  await reached.promise
  expect(s.read()).toEqual(s.a)
  return { ...s, b, lease, pending, release }
}

it.each(boundaries)('$kind preserves a fresh same-content B lease during old $boundary completion', async ({ kind, boundary }) => {
  const s = await held(kind, boundary)
  s.c.clearStage(kind, s.a.id, 'discard'); s.installSaved(s.a); s.reserve('discard', s.a)
  s.install(s.b)
  expect(await s.save()).toBe('saved')
  expect(s.read().title).toBe('B')
  const fresh = await s.c.guardFor(s.read(), kind)
  expect(fresh).not.toBe(s.lease)
  expect(fresh.expectedStoredBase).toBe(s.lease.expectedStoredBase)
  s.release.resolve(); await s.pending
  expect(s.c.latestWriteGuards.get(s.key)).toBe(fresh)
  expect(s.local().title).toBe('B')
  s.install({ ...s.read(), title: 'E', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('E')) })
  expect(await s.save()).toBe('saved')
  expect(s.read().title).toBe('E'); expect(s.read().body).toBe('<p>E</p>')
})

it.each(kinds)('%s preserves an explicitly reviewed same-content remote B pin', async kind => {
  const s = await held(kind)
  s.external(s.b); s.installSaved(s.b)
  s.c.clearStage(kind, s.a.id, 'discard'); s.reserve('discard', s.b)
  const fresh = await s.c.guardFor(s.b, kind)
  s.reserve('save')
  s.release.resolve(); await s.pending
  expect(s.c.latestWriteGuards.get(s.key)).toBe(fresh)
  s.install({ ...s.b, title: 'Reviewed E' })
  expect(await s.save()).toBe('saved'); expect(s.read().title).toBe('Reviewed E')
})

it.each(boundaries)('$kind leaves deletion terminal after old $boundary completion', async ({ kind, boundary }) => {
  const s = await held(kind, boundary)
  s.reserve('delete'); s.ctx.records.findingsRef.current = []; s.ctx.records.draftsRef.current = []
  s.ctx.records.savedFindingsRef.current = []; s.ctx.records.savedDraftsRef.current = []
  s.dirty.current.clear()
  s.release.resolve(); await s.pending
  expect(s.local()).toBeUndefined()
  expect(s.ctx.records.savedFindingsRef.current).toEqual([]); expect(s.ctx.records.savedDraftsRef.current).toEqual([])
  expect(s.dirty.current.size).toBe(0)
  expect(s.c.latestWriteGuards.get(s.key)).toBe(s.lease)
})

it.each(kinds)('%s leaves a fresh Proposal origin intact', async kind => {
  const s = await held(kind)
  s.reserve('save')
  const value = editorValue(s.a)
  s.c.bindStage(kind, s.a.id, s.a.sessionId, { origin: stageOrigin(kind, s.a.id, 'fresh-stage', s.a.sessionId), id: 'fresh-stage', before: value, after: value, storedBaseToken: s.lease.expectedStoredBase })
  const proposal = s.c.latestWriteGuards.get(s.key)
  s.release.resolve(); await s.pending
  expect(s.c.latestWriteGuards.get(s.key)).toBe(proposal)
  expect(proposal?.origin).toEqual({ kind: 'proposal', stageId: 'fresh-stage' })
  expect(await s.save()).toBe('failed')
  expect(s.read().title).toBe('A'); expect(s.local().title).toBe('C')
})

it.each(kinds)('%s keeps the same Editor object when release only removes proposal association', async kind => {
  const s = await held(kind)
  s.reserve('save')
  const value = editorValue(s.a)
  s.c.proposalStages.set(s.key, { origin: stageOrigin(kind, s.a.id, 'previous-stage', s.a.sessionId), id: 'previous-stage', before: value, after: value, storedBaseToken: s.lease.expectedStoredBase })
  s.c.releaseStage(kind, s.a.id, s.lease, 'previous-stage')
  expect(s.c.latestWriteGuards.get(s.key)).toBe(s.lease)
  expect(s.c.proposalStages.has(s.key)).toBe(false)
  s.release.resolve(); await s.pending
  expect(s.read().title).toBe('A'); expect(s.local().title).toBe('C')
  expect(await s.save()).toBe('saved'); expect(s.read().title).toBe('C')
})

it.each(kinds.flatMap(kind => [true, false].map(same => ({ kind, same }))))('$kind excludes synthetic repeated canonicalization from retired publication, same content $same', async ({ kind, same }) => {
  const s = await held(kind)
  const generated = same ? s.b : { ...s.b, title: 'Generated D', body: '<p>Generated D</p>' }
  await s.canonicalize(generated)
  const error = s.feedback.setError.mock.calls.at(-1)
  s.release.resolve(); await s.pending
  expect(s.read().title).toBe('A'); expect(s.local().title).toBe('C')
  expect(s.intents.get(s.a.id)?.kind).toBe('canonicalize')
  expect(s.feedback.setError.mock.calls.at(-1)).toEqual(error)
  expect(s.c.latestWriteGuards.get(s.key)).toBe(s.lease)
  expect(await s.save()).toBe('failed')
  expect(s.read().title).toBe('A')
})

it.each(kinds)('%s protects materialized images referenced by a newer saved or retained record', async kind => {
  const s = subject(kind)
  const reached = deferred<void>(); const release = deferred<void>()
  const image = { ...s.a, title: 'D with evidence', body: '<p><img src="qa-scribe-attachment://shared-image" data-attachment-id="shared-image"></p>' }
  s.ctx.materializeInlineImages = async () => ({ document: richEditorDocumentFromStoredBody(image), importedAttachmentIds: ['shared-image', 'orphan-image'] })
  s.command.mockImplementationOnce(async () => { reached.resolve(); await release.promise; throw new Error('Retired Save failed') })
  const pending = s.save(); await reached.promise
  s.install(image)
  expect(await s.save()).toBe('saved')
  s.cleanup.mockClear()
  const attachments = new Set(['shared-image', 'orphan-image'])
  s.cleanup.mockImplementation(async ids => { for (const id of ids) attachments.delete(id); return true })
  release.resolve(); expect(await pending).toBe('superseded')
  expect(s.cleanup.mock.calls.flatMap(([ids]) => ids)).toEqual(['orphan-image'])
  expect([...attachments]).toEqual(['shared-image'])
  expect(s.read().title).toBe('D with evidence')
  expect(s.read().body).toContain('shared-image')
  expect(s.feedback.setError.mock.calls.at(-1)).toEqual([null])
})

it.each(kinds)('%s rechecks ownership after awaited failure cleanup', async kind => {
  const s = subject(kind)
  const reached = deferred<void>(); const release = deferred<void>()
  s.ctx.materializeInlineImages = async document => ({ document, importedAttachmentIds: ['orphan-image'] })
  s.command.mockRejectedValueOnce(new Error('Old failed Save'))
  s.cleanup.mockImplementationOnce(async () => { reached.resolve(); await release.promise; return true })
  const pending = s.save(); await reached.promise
  s.install({ ...s.a, title: 'Confirmed D', body: '<p>D</p>' })
  expect(await s.save()).toBe('saved')
  release.resolve(); expect(await pending).toBe('superseded')
  expect(s.feedback.setError.mock.calls.at(-1)).toEqual([null])
  s.install({ ...s.read(), title: 'E' })
  expect(await s.save()).toBe('saved'); expect(s.read().title).toBe('E')
})


it.each(kinds)('%s rejects same-token ABA while a newer confirmation still inherits the old expectation', async kind => {
  const s = await held(kind)
  s.reserve('save')
  const oldExpected = s.intents.get(s.a.id)?.expected
  const aGuard = await recordWriteGuard(s.a, s.table)
  await s.write(s.a.id, s.b, aGuard)
  const reached = deferred<void>(); const finishConfirmation = deferred<void>()
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  let calls = 0
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const hold = ++calls === 2
    const hash = await digest(algorithm, data)
    if (hold) { reached.resolve(); await finishConfirmation.promise }
    return hash
  })
  const confirming = s.confirm(s.b, aGuard, 1)
  await reached.promise
  const fresh = s.c.latestWriteGuards.get(s.key)!
  expect(fresh).not.toBe(s.lease)
  expect(fresh.expectedStoredBase).toBe(s.lease.expectedStoredBase)
  expect(s.intents.get(s.a.id)?.expected).toBe(oldExpected)
  s.release.resolve(); await s.pending
  expect(s.c.latestWriteGuards.get(s.key)).toBe(fresh)
  finishConfirmation.resolve(); await confirming
  s.installSaved(s.b); s.install({ ...s.b, title: 'E after ABA' })
  expect(await s.save()).toBe('saved'); expect(s.read().title).toBe('E after ABA')
})


it.each(kinds)('%s Proposal to Editor release preserves its pinned base and revokes old restoration authority', async kind => {
  const s = await held(kind)
  s.reserve('save')
  const value = editorValue(s.a)
  s.c.bindStage(kind, s.a.id, s.a.sessionId, { origin: stageOrigin(kind, s.a.id, 'new-stage', s.a.sessionId), id: 'new-stage', before: value, after: value, storedBaseToken: s.lease.expectedStoredBase })
  const proposal = s.c.latestWriteGuards.get(s.key)
  s.c.releaseStage(kind, s.a.id, await recordWriteGuard(s.a, s.table), 'new-stage')
  const released = s.c.latestWriteGuards.get(s.key)!
  expect(released).not.toBe(proposal); expect(released).not.toBe(s.lease)
  expect(released.origin).toEqual({ kind: 'editor' })
  expect(released.expectedStoredBase).toBe(s.lease.expectedStoredBase)
  expect(s.c.proposalStages.has(s.key)).toBe(false)
  const remote = { ...s.a, title: 'Remote D', body: '<p>Remote D</p>' }
  s.external(remote)
  s.release.resolve(); await s.pending
  expect(s.c.latestWriteGuards.get(s.key)).toBe(released)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    expect(await s.save()).toBe('failed')
    expect(s.read()).toEqual(remote); expect(s.local().title).toBe('C')
    expect(s.c.latestWriteGuards.get(s.key)).toBe(released)
  }
})
