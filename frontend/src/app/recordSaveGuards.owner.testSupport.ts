import { act } from '@testing-library/react'
import { expect } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { generationStatusFixture } from '../test/fixtures'
import { deferred } from './useAppController.testHarness'
import { richBody, type SaveGuardSubject } from './recordSaveGuards.testSupport'
import type { RecordPatch, RecordValue } from './recordSaveGuards.storage.testSupport'

export async function holdForcedOwner(subject: SaveGuardSubject, beforeCommit = false) {
  const reached = deferred<void>()
  const release = deferred<void>()
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    const row = beforeCommit ? undefined : await subject.storage.write(id, patch, guard)
    reached.resolve()
    await release.promise
    return row ?? subject.storage.write(id, patch, guard)
  })
  subject.edit('Owner X')
  let pending!: Promise<boolean>
  act(() => { pending = subject.result.current.saveDirtyRecordsNow() })
  await act(async () => { await reached.promise })
  return { pending, release: () => release.resolve() }
}

export function canonicalizeRecord(subject: SaveGuardSubject, record: RecordValue, base = record) {
  if ('aiRunId' in record && 'aiRunId' in base) return subject.result.current.canonicalizeGeneratedDraft(record, base)
  if (!('aiRunId' in record) && !('aiRunId' in base)) return subject.result.current.canonicalizeGeneratedFinding(record, base)
  throw new Error('Canonical fixture kinds differ')
}

export function generatedRecord(subject: SaveGuardSubject, id = 'generated-Y') {
  return { ...subject.initial, id, title: 'Generated G', body: '<p>Backend G</p>', bodyJson: null, bodyFormat: 'html' }
}

export async function captureGeneration(subject: SaveGuardSubject) {
  const action = subject.kind === 'draft' ? 'testware' : 'finding'
  const status = generationStatusFixture({ jobId: 'owner-generation', action, state: 'running' })
  let emit: (event: unknown) => void = () => {}
  subject.api.startAiActionJob.mockImplementationOnce((_request: unknown, onEvent: (event: unknown) => void) => {
    emit = onEvent
    return Promise.resolve({ jobId: status.jobId, status })
  })
  await act(async () => { await subject.result.current.handleAiAction(action) })
  expect(subject.api.startAiActionJob).toHaveBeenCalledOnce()
  return (record: RecordValue) => {
    subject.storage.external(record)
    act(() => emit({
      type: 'completed', job_id: status.jobId, status: { ...status, state: 'completed' },
      result: {
        generationContext: { id: 'owner-context', sessionId: record.sessionId, createdAt: record.createdAt },
        aiRun: { id: 'owner-run', sessionId: record.sessionId, generationContextId: 'owner-context', provider: 'codex_cli',
          modelSelection: { kind: 'recorded', requested: { kind: 'default' }, reported: null }, reasoningEffort: null,
          promptVersion: 'owner-v1', status: 'completed', errorMessage: null, createdAt: record.createdAt, completedAt: record.createdAt },
        draft: 'aiRunId' in record ? record : null, finding: 'aiRunId' in record ? null : record, noteEntry: null,
      },
    }))
  }
}

export function discardRecord(subject: SaveGuardSubject, id = subject.initial.id) {
  act(() => {
    if (subject.kind === 'draft') {
      const row = subject.result.current.testwareDrafts.find(record => record.id === id)
      if (!row) throw new Error('Missing Draft to discard')
      subject.result.current.discardLocalDraft(row)
    } else {
      const row = subject.result.current.findings.find(record => record.id === id)
      if (!row) throw new Error('Missing Finding to discard')
      subject.result.current.discardLocalFinding(row)
    }
  })
}

export const canonicalBody = (record: RecordValue, title: string) => ({ ...record, title, ...richBody(`Body ${title}`) })
