import { expect, it, vi } from 'vitest'
import { draftFixture, findingFixture } from '../test/fixtures'
import { createRecordActionCoordination } from './recordActions.coordination'
import type { RecordPersistenceContext } from './recordPersistence'
import { RecordWriteConflict } from './recordWriteGuards'

const kinds = ['draft', 'finding'] as const
const boundaries = ['unloaded', 'absent', 'wrong-session-row', 'wrong-kind-row', 'inactive', 'owned'] as const
it.each(kinds.flatMap(kind => boundaries.map(boundary => ({ kind, boundary }))))(
  '$kind recognizes $boundary conflict without publishing outside its live owner', ({ kind, boundary }) => {
    const incoming = kind === 'draft' ? draftFixture({ title: 'Conflict snapshot' }) : findingFixture({ title: 'Conflict snapshot' })
    const local = { ...incoming, title: 'Retained local edit' }
    const saved = { ...incoming, title: 'Existing saved baseline' }
    const row = boundary === 'wrong-session-row' ? { ...local, sessionId: 'other-session' }
      : boundary === 'absent' ? { ...local, id: 'other-record' } : local
    const ctx: RecordPersistenceContext = {
      session: { activeSessionIdRef: { current: boundary === 'inactive' ? 'session-2' : incoming.sessionId } },
      records: {
        draftsRef: { current: [] }, findingsRef: { current: [] },
        savedDraftsRef: { current: [] }, savedFindingsRef: { current: [] },
        dirtyDraftIdsRef: { current: new Set(['existing-draft-edit']) },
        dirtyFindingIdsRef: { current: new Set(['existing-finding-edit']) },
        setDrafts: vi.fn(), setFindings: vi.fn(), setTestwareDraftCount: vi.fn(), setFindingCount: vi.fn(),
      },
      importedAttachments: { register: vi.fn(), remember: vi.fn(), pending: vi.fn(() => []), clear: vi.fn(), forget: vi.fn() },
      feedback: { setError: vi.fn(), setNotice: vi.fn(), setBusyAction: vi.fn() },
      materializeInlineImages: vi.fn(async document => ({ document, importedAttachmentIds: [] })),
      cleanupMaterializedAttachments: vi.fn(async () => true),
    }
    if ('aiRunId' in saved) ctx.records.savedDraftsRef.current = [saved]
    else ctx.records.savedFindingsRef.current = [saved]
    if (boundary !== 'unloaded' && boundary !== 'wrong-kind-row') {
      if ('aiRunId' in row) ctx.records.draftsRef.current = [row]
      else ctx.records.findingsRef.current = [row]
    }
    if (boundary === 'wrong-kind-row') {
      if (kind === 'draft') ctx.records.findingsRef.current = [findingFixture({ id: incoming.id })]
      else ctx.records.draftsRef.current = [draftFixture({ id: incoming.id })]
    }
    const coordination = createRecordActionCoordination(ctx)
    const changed = vi.fn()
    coordination.subscribeChanges(changed)
    const before = {
      drafts: ctx.records.draftsRef.current, findings: ctx.records.findingsRef.current,
      savedDrafts: ctx.records.savedDraftsRef.current, savedFindings: ctx.records.savedFindingsRef.current,
    }
    const cause = new RecordWriteConflict(incoming)
    expect(coordination.adoptConflict(cause)).toBe(true)
    expect(ctx.records.draftsRef.current).toBe(before.drafts)
    expect(ctx.records.findingsRef.current).toBe(before.findings)
    if (boundary === 'owned') {
      expect(kind === 'draft' ? ctx.records.savedDraftsRef.current : ctx.records.savedFindingsRef.current).toEqual([incoming])
      expect(ctx.feedback.setError).toHaveBeenCalledWith(cause.message)
      expect(changed).toHaveBeenCalledExactlyOnceWith(kind, incoming.id, 'conflict')
    } else {
      expect(ctx.records.savedDraftsRef.current).toBe(before.savedDrafts)
      expect(ctx.records.savedFindingsRef.current).toBe(before.savedFindings)
      expect(changed).not.toHaveBeenCalled()
      expect(ctx.feedback.setError).toHaveBeenCalledExactlyOnceWith(boundary === 'inactive'
        ? 'A Save from another Session reported a conflict. Reopen its Session to review the latest saved record.'
        : 'A Save for a record not open in this workspace reported a conflict. Reopen its Session to review the latest saved record.')
    }
    expect([...ctx.records.dirtyDraftIdsRef.current]).toEqual(boundary === 'owned' && kind === 'draft' ? ['existing-draft-edit', incoming.id] : ['existing-draft-edit'])
    expect([...ctx.records.dirtyFindingIdsRef.current]).toEqual(boundary === 'owned' && kind === 'finding' ? ['existing-finding-edit', incoming.id] : ['existing-finding-edit'])
    expect(ctx.records.setDrafts).not.toHaveBeenCalled()
    expect(ctx.records.setFindings).not.toHaveBeenCalled()
    expect(ctx.importedAttachments.pending).not.toHaveBeenCalled()
    expect(ctx.cleanupMaterializedAttachments).not.toHaveBeenCalled()
    changed.mockClear()
    vi.mocked(ctx.feedback.setError).mockClear()
    expect(coordination.adoptConflict(new Error('ordinary failure'))).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    expect(ctx.feedback.setError).not.toHaveBeenCalled()
  },
)
