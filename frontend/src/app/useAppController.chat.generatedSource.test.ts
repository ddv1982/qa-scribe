import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatComposerRequest, StartChatJobRequest } from '../bindings'
import { chatJobFixture } from './useSessionChat.testSupport'
import { draftFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { openSaveGuardSubject, recordKinds } from './recordSaveGuards.testSupport'
import { captureGeneration, generatedRecord } from './recordSaveGuards.owner.testSupport'

beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(recordKinds)('%s generated after collection hydration is available to its exact Ask AI conversation and ordinary Send', async kind => {
  const subject = await openSaveGuardSubject(kind)
  expect(kind === 'draft' ? subject.result.current.draftLoadState : subject.result.current.findingLoadState).toBe('ready')
  const list = kind === 'draft' ? subject.api.listDrafts : subject.api.listFindings
  expect(list).toHaveBeenCalledOnce()
  const complete = await captureGeneration(subject)
  const generated = generatedRecord(subject)
  complete(generated)
  await waitFor(() => expect(subject.current(generated.id).bodyFormat).toBe('tiptap_json'))
  const target = { kind: kind === 'draft' ? 'test_cases_draft' as const : 'finding' as const,
    recordId: generated.id, title: 'Generated G', unsaved: false }
  act(() => subject.result.current.askAi.onSelectRecord(target))
  await act(async () => { await subject.result.current.askAi.onAskAi(target) })
  const reference = subject.result.current.askAi.reference!
  const handle = subject.result.current.conversations.bind(reference)
  expect.soft(subject.result.current.askAi.source).toEqual({ kind: 'available', title: 'Generated G', unsaved: false })
  expect(handle.snapshot().chat?.owner).toEqual({ kind: 'record', sessionId: 'session-1', record: { kind: target.kind, recordId: 'generated-Y' } })
  act(() => handle.setComposer('Explain this generated evidence. 雪'))
  subject.api.startChatJob.mockImplementationOnce(async (request: StartChatJobRequest) => ({
    jobId: 'generated-chat-job', turnId: 'generated-turn',
    status: chatJobFixture({ chat: { reference } }), chat: { ...handle.snapshot().chat!, revision: request.scope.expectedRevision + 1 },
  }))
  await act(async () => { await handle.send() })
  expect.soft(subject.api.startChatJob).toHaveBeenCalledOnce()
  const request = subject.api.startChatJob.mock.calls[0]?.[0] as StartChatJobRequest | undefined
  expect(request?.scope).toEqual({ ...reference, expectedRevision: 1 })
  expect(request?.context).toEqual({ kind: target.kind, snapshot: {
    sessionId: 'session-1', recordId: 'generated-Y', title: 'Generated G',
    documentJson: '{"doc":{"content":[{"content":[{"text":"Backend G","type":"text"}],"type":"paragraph"}],"type":"doc"},"schemaVersion":1}',
    metadataJson: generated.metadataJson, recordKind: generated.kind, origin: 'saved', localFingerprint: '', storedBaseToken: '',
  } })
  const savedInput = subject.api.saveChatComposer.mock.calls.at(-1)?.[0] as ChatComposerRequest | undefined
  expect(savedInput?.composer).toBe('Explain this generated evidence. 雪')
  expect(list).toHaveBeenCalledOnce()
})

it.each(recordKinds)('%s generated source stays blocked during loading, failed reads and authoritative deletion despite a retained dirty row', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const complete = await captureGeneration(subject)
  const generated = generatedRecord(subject)
  complete(generated)
  await waitFor(() => expect(subject.current(generated.id).bodyFormat).toBe('tiptap_json'))
  const target = { kind: kind === 'draft' ? 'test_cases_draft' as const : 'finding' as const, recordId: generated.id, title: 'Generated G', unsaved: false }
  act(() => subject.result.current.askAi.onSelectRecord(target))
  await act(async () => { await subject.result.current.askAi.onAskAi(target) })
  const reference = subject.result.current.askAi.reference!
  const handle = subject.result.current.conversations.bind(reference)
  subject.editRecord(generated.id, 'Retained dirty generated title')
  act(() => subject.result.current.askAi.onSelectRecord({ ...target, title: 'Retained dirty generated title', unsaved: true }))
  act(() => handle.setComposer('Keep this generated source question'))
  expect(subject.result.current.askAi.source).toEqual({ kind: 'available', title: 'Retained dirty generated title', unsaved: true })
  const failed = deferred<void>()
  const failRead = async () => { await failed.promise; throw new Error('Synthetic generated-source read failure') }
  if (kind === 'draft') subject.api.listDrafts.mockImplementationOnce(failRead)
  else subject.api.listFindings.mockImplementationOnce(failRead)
  const reload = () => kind === 'draft' ? subject.result.current.loadDraftsForSession('session-1', { force: true }) : subject.result.current.loadFindingsForSession('session-1', { force: true })
  let pending!: Promise<unknown>
  act(() => { pending = reload().catch(() => undefined) })
  expect(subject.result.current.askAi.source).toEqual({ kind: 'loading' })
  await act(async () => { await handle.send() })
  expect(subject.api.startChatJob).not.toHaveBeenCalled()
  await act(async () => { failed.resolve(); await pending })
  expect(subject.result.current.askAi.source?.kind).toBe('error')
  await act(async () => { await handle.send() })
  expect(subject.api.startChatJob).not.toHaveBeenCalled()
  subject.storage.remove(generated.id)
  await act(async () => { await reload() })
  expect(subject.current(generated.id).title).toBe('Retained dirty generated title')
  expect(subject.result.current.askAi.source).toEqual({ kind: 'unavailable' })
  await act(async () => { await handle.send() })
  expect(subject.api.startChatJob).not.toHaveBeenCalled()
  expect(handle.snapshot().composer).toBe('Keep this generated source question')
  expect(handle.snapshot().chat?.owner).toEqual({ kind: 'record', sessionId: 'session-1', record: { kind: target.kind, recordId: 'generated-Y' } })
  expect(subject.result.current.askAi.reference).toEqual(reference)
})

it.each(recordKinds)('%s late generation from another Session cannot authorize a deleted dirty source with the same ID', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const complete = await captureGeneration(subject)
  const generated = generatedRecord(subject)
  const foreign = kind === 'draft' ? draftFixture({ id: generated.id, sessionId: 'session-2', title: 'Other Session row' })
    : findingFixture({ id: generated.id, sessionId: 'session-2', title: 'Other Session row' })
  if (kind === 'draft') subject.api.listDrafts.mockResolvedValueOnce([foreign])
  else subject.api.listFindings.mockResolvedValueOnce([foreign])
  await act(async () => { await subject.result.current.openSession(sessionFixture({ id: 'session-2' })) })
  act(() => subject.result.current.setActiveView(kind === 'draft' ? 'testware' : 'findings'))
  await waitFor(() => expect(subject.current(generated.id).sessionId).toBe('session-2'))
  const target = { kind: kind === 'draft' ? 'test_cases_draft' as const : 'finding' as const, recordId: generated.id, title: 'Other Session row', unsaved: false }
  act(() => subject.result.current.askAi.onSelectRecord(target))
  await act(async () => { await subject.result.current.askAi.onAskAi(target) })
  const reference = subject.result.current.askAi.reference!
  const handle = subject.result.current.conversations.bind(reference)
  subject.editRecord(generated.id, 'Other Session retained edit')
  await act(async () => {
    if (kind === 'draft') await subject.result.current.loadDraftsForSession('session-2', { force: true })
    else await subject.result.current.loadFindingsForSession('session-2', { force: true })
  })
  expect(subject.result.current.askAi.source).toEqual({ kind: 'unavailable' })
  complete(generated)
  expect(subject.current(generated.id).title).toBe('Other Session retained edit')
  expect(subject.result.current.askAi.source).toEqual({ kind: 'unavailable' })
  act(() => handle.setComposer('Do not send against the foreign completion'))
  await act(async () => { await handle.send() })
  expect(subject.api.startChatJob).not.toHaveBeenCalled()
  expect(subject.result.current.askAi.reference).toEqual(reference)
  expect(handle.snapshot().chat?.owner).toEqual({ kind: 'record', sessionId: 'session-2', record: { kind: target.kind, recordId: 'generated-Y' } })
})
