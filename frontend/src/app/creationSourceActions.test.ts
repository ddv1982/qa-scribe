import { beforeEach, expect, it, vi } from 'vitest'
import { entryFixture, findingFixture, generationStatusFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml, richEditorDocumentToHtml } from '../editor/editorDocument'
import { createCreationActions, type CreationSelection } from './creationActions'
import type { AiSelection } from './types'
import type { CreatedRecord, GenerationJobEvent, GenerationJobStatus, NoteSource } from '../tauri'
import type { CreationIntent } from './creationIntent'
import * as editorRegistry from '../editor/richEditorRegistry'

const bridge = vi.hoisted(() => ({ readNoteSource: vi.fn(), startAiActionJob: vi.fn(), cancelAiActionJob: vi.fn(), readClipboardImageDataUrl: vi.fn() }))
vi.mock('../tauri', async (original) => ({ ...await original<object>(), ...bridge }))
const selection: AiSelection = { selectedProvider: 'codex_cli', selectedModel: 'request-model', selectedReasoningEffort: 'high' }
let latest: NoteSource
let receive: (event: GenerationJobEvent) => void
const status = (patch: Partial<GenerationJobStatus> = {}) => generationStatusFixture({ action: 'finding', jobId: 'owned-job', ...patch })
function setup() {
  let session = 'session-1'
  let epoch = 0
  let allowed = true
  const error = vi.fn()
  const notice = vi.fn()
  const selected = vi.fn(async (_intent: CreationIntent, _record: CreatedRecord): Promise<CreationSelection> => 'selected')
  const jobs = vi.fn((_status: GenerationJobStatus) => undefined)
  const actions = createCreationActions({ activeSessionId: () => session, sourceAllowed: () => allowed, noteId: () => 'entry-1', beginNavigation: () => ++epoch,
    navigationIsCurrent: (captured) => captured === epoch, publishJob: jobs,
    openDestination: vi.fn(), changed: vi.fn(), decisionChanged: vi.fn(), error, notice, selectSaved: selected })
  return { actions, error, notice, selected, jobs, blockSource: () => { allowed = false }, changeSession: (id: string) => { session = id; ++epoch } }
}
async function opened(kind: 'finding' | 'testware' = 'finding') {
  const owner = setup()
  await owner.actions.open(kind)
  await vi.waitFor(() => expect(owner.actions.current()?.source?.revision).toBe(0))
  return owner
}
function completed(): GenerationJobEvent {
  return { type: 'completed', job_id: 'owned-job', status: status({ state: 'completed' }), result: {
    generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: 'now' },
    aiRun: { id: 'run-1', sessionId: 'session-1', generationContextId: 'context-1', provider: 'codex_cli', modelSelection: { kind: 'recorded', requested: { kind: 'default' }, reported: null }, reasoningEffort: null, promptVersion: 'finding-v4', status: 'completed', errorMessage: null, createdAt: 'now', completedAt: 'now' },
    finding: findingFixture({ id: 'returned-result' }), draft: null, noteEntry: null,
  } }
}
beforeEach(() => {
  vi.resetAllMocks()
  latest = { entry: entryFixture({ title: 'Reviewed title', body: '<p>Reviewed exact source</p>' }), revision: 0 }
  bridge.readNoteSource.mockImplementation(async () => latest)
  bridge.startAiActionJob.mockImplementation(async (_request: unknown, callback: typeof receive) => { receive = callback; return { jobId: 'owned-job', status: status() } })
  bridge.cancelAiActionJob.mockResolvedValue(status({ state: 'cancelling' }))
})

it('reviews canonical source without creating a job, and Prefill mutates the same intent', async () => {
  const { actions } = await opened()
  const id = actions.current()?.id
  expect(bridge.startAiActionJob).not.toHaveBeenCalled()
  expect(await actions.prefill()).toBe(true)
  expect(actions.current()?.id).toBe(id)
  expect(richEditorDocumentToHtml(actions.current()!.document)).toContain('Reviewed exact source')
  expect(richEditorDocumentToHtml(actions.current()!.document)).not.toContain('Describe the finding')
  expect(bridge.startAiActionJob).not.toHaveBeenCalled()
})
it.each(['prefill', 'generate'] as const)('refreshes an ABA Note and requires a second confirmation for %s', async (operation) => {
  const { actions, error } = await opened()
  latest = { ...latest, revision: 2 }
  expect(operation === 'prefill' ? await actions.prefill() : await actions.generate(selection)).toBe(false)
  expect(actions.current()?.source?.revision).toBe(2)
  expect(error).toHaveBeenLastCalledWith('The Note changed. Review the refreshed source and confirm again.')
  expect(bridge.startAiActionJob).not.toHaveBeenCalled()
  expect(operation === 'prefill' ? await actions.prefill() : await actions.generate(selection)).toBe(true)
})
it('starts exactly one job from the displayed source token and request-local identity', async () => {
  const { actions } = await opened()
  const first = actions.generate(selection)
  expect(await actions.generate(selection)).toBe(false)
  expect(await first).toBe(true)
  expect(bridge.startAiActionJob).toHaveBeenCalledTimes(1)
  expect(bridge.startAiActionJob.mock.calls[0][0]).toEqual({ sessionId: 'session-1', noteEntryId: 'entry-1', expectedNoteRevision: 0,
    provider: 'codex_cli', model: 'request-model', reasoningEffort: 'high', action: 'finding', testwarePreferences: null })
})
it('retains exact rich text, metadata and local images after accepted cancellation', async () => {
  const { actions, notice } = await opened()
  const document = richEditorDocumentFromHtml('<p><strong>Keep authored work</strong></p><img src="data:image/png;base64,aGVsbG8=">')
  actions.update({ title: 'My draft', document, metadataJson: '{"severity":"high"}' })
  await actions.generate(selection)
  expect(await actions.save()).toBe(false)
  actions.update({ title: 'Forbidden edit' })
  await actions.cancelGeneration()
  receive({ type: 'cancelled', job_id: 'owned-job', status: status({ state: 'cancelled' }), ai_run: null })
  expect(actions.current()).toMatchObject({ title: 'My draft', document, metadataJson: '{"severity":"high"}', phase: { state: 'editing' } })
  expect(notice).toHaveBeenLastCalledWith('Generation cancelled')
})
it('retains the draft after backend revision rejection and refreshes source for explicit confirmation', async () => {
  const { actions, selected, error } = await opened()
  actions.update({ title: 'Keep this title' })
  bridge.startAiActionJob.mockRejectedValueOnce(new Error('The reviewed Note changed'))
  latest = { ...latest, revision: 0 }
  expect(await actions.generate(selection)).toBe(false)
  expect(actions.current()?.title).toBe('Keep this title')
  expect(actions.current()?.phase.state).toBe('editing')
  expect(selected).not.toHaveBeenCalled()
  expect(error.mock.calls.some(([message]) => String(message).includes('reviewed Note changed'))).toBe(true)
})
it('consumes the matching intent only after the returned result is selected', async () => {
  const { actions, selected } = await opened()
  let finish!: (selected: CreationSelection) => void
  selected.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  await actions.generate(selection)
  receive(completed())
  await vi.waitFor(() => expect(selected).toHaveBeenCalledOnce())
  expect(actions.current()?.phase.state).toBe('saved')
  expect(selected.mock.calls[0][1].record.id).toBe('returned-result')
  finish('selected')
  await vi.waitFor(() => expect(actions.current()).toBeNull())
})
it('does not revive the intent from a late start status after synchronous completion', async () => {
  const { actions, jobs } = await opened()
  bridge.startAiActionJob.mockImplementationOnce(async (_request, callback: typeof receive) => { callback(completed()); return { jobId: 'owned-job', status: status() } })
  await actions.generate(selection)
  await vi.waitFor(() => expect(actions.current()).toBeNull())
  expect(jobs.mock.calls.at(-1)?.[0].state).toBe('completed')
})
it('ignores wrong-job and stale Session completions without consuming local work', async () => {
  const { actions, selected, changeSession } = await opened()
  actions.update({ title: 'Session-bound local work' })
  await actions.generate(selection)
  receive({ ...completed(), job_id: 'other-job' })
  expect(selected).not.toHaveBeenCalled()
  changeSession('session-2')
  receive(completed())
  expect(selected).not.toHaveBeenCalled()
  expect(actions.current()?.title).toBe('Session-bound local work')
})
it('lets commit win cancellation and does not report the saved result as cancelled', async () => {
  const { actions, selected } = await opened()
  await actions.generate(selection)
  bridge.cancelAiActionJob.mockImplementationOnce(async () => { receive(completed()); return status({ state: 'completed' }) })
  await actions.cancelGeneration()
  await vi.waitFor(() => expect(actions.current()).toBeNull())
  expect(selected).toHaveBeenCalledOnce()
})
it('requires ordinary draft settlement after cancelling generation for a navigation request', async () => {
  const { actions } = await opened()
  actions.update({ title: 'Still unsaved' })
  await actions.generate(selection)
  let finished = false
  const settled = actions.settle().then((value) => { finished = value })
  await actions.cancelGeneration()
  receive({ type: 'cancelled', job_id: 'owned-job', status: status({ state: 'cancelled' }), ai_run: null })
  expect(finished).toBe(false)
  expect(actions.current()?.title).toBe('Still unsaved')
  await actions.decide('discard')
  await settled
  expect(finished).toBe(true)
})

it('preserves the existing Note-recovery source gate while ordinary writing stays available', async () => {
  const { actions, blockSource } = await opened()
  actions.update({ title: 'Ordinary work' })
  blockSource()
  expect(await actions.generate(selection)).toBe(false)
  expect(await actions.prefill()).toBe(false)
  expect(actions.current()?.title).toBe('Ordinary work')
  expect(bridge.startAiActionJob).not.toHaveBeenCalled()
})
it('accepts cancellation during source confirmation before starting a provider job', async () => {
  const { actions } = await opened()
  let finish!: (source: NoteSource) => void
  bridge.readNoteSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const generating = actions.generate(selection)
  await vi.waitFor(() => expect(actions.current()?.phase.state).toBe('generating'))
  await actions.cancelGeneration()
  finish(latest)
  expect(await generating).toBe(false)
  expect(bridge.startAiActionJob).not.toHaveBeenCalled()
  expect(actions.current()?.phase.state).toBe('editing')
})
it('cancels a pending native start once its returned job identity is available', async () => {
  const { actions } = await opened()
  let finish!: (value: { jobId: string; status: GenerationJobStatus }) => void
  bridge.startAiActionJob.mockImplementationOnce((_request: unknown, callback: typeof receive) => {
    receive = callback
    return new Promise(resolve => { finish = resolve })
  })
  const generating = actions.generate(selection)
  await vi.waitFor(() => expect(bridge.startAiActionJob).toHaveBeenCalledOnce())
  await actions.cancelGeneration()
  expect(bridge.cancelAiActionJob).not.toHaveBeenCalled()
  finish({ jobId: 'owned-job', status: status() })
  expect(await generating).toBe(true)
  await vi.waitFor(() => expect(bridge.cancelAiActionJob).toHaveBeenCalledWith('owned-job'))
  receive({ type: 'cancelled', job_id: 'owned-job', status: status({ state: 'cancelled' }), ai_run: null })
  expect(actions.current()?.phase.state).toBe('editing')
})
it('cannot consume a newer A-to-B-to-A intent from an earlier generation completion', async () => {
  const { actions, selected, changeSession } = await opened()
  await actions.generate(selection)
  const oldReceive = receive
  oldReceive({ type: 'cancelled', job_id: 'owned-job', status: status({ state: 'cancelled' }), ai_run: null })
  await actions.discard()
  changeSession('session-2')
  latest = { entry: entryFixture({ sessionId: 'session-2' }), revision: 0 }
  await actions.open('finding')
  await actions.discard()
  changeSession('session-1')
  latest = { entry: entryFixture(), revision: 0 }
  await actions.open('finding')
  actions.update({ title: 'New A intent must survive' })
  const id = actions.current()?.id
  oldReceive(completed())
  expect(actions.current()?.id).toBe(id)
  expect(actions.current()?.title).toBe('New A intent must survive')
  expect(selected).not.toHaveBeenCalled()
})
it.each(['finding', 'testware'] as const)('rejects a pending %s Prefill after authored content changes', async (kind) => {
  const { actions } = await opened(kind)
  actions.update({ title: 'Before confirmation', document: richEditorDocumentFromHtml('<p>Before body</p>') })
  const id = actions.current()!.id
  let finish!: (source: NoteSource) => void
  bridge.readNoteSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const pending = actions.prefill()
  await vi.waitFor(() => expect(bridge.readNoteSource).toHaveBeenCalledTimes(2))
  const document = richEditorDocumentFromHtml('<p><strong>New authored body</strong></p>')
  actions.update({ title: 'New authored title', document })
  finish(latest)
  expect(await pending).toBe(false)
  expect(actions.current()).toMatchObject({ id, title: 'New authored title', document, phase: { state: 'editing' } })
  expect(bridge.startAiActionJob).not.toHaveBeenCalled()
})

it.each(['revision', 'error'] as const)('ignores late %s feedback after Prefill dismissal without requiring another edit', async (result) => {
  const { actions, error } = await opened()
  let resolve!: (source: NoteSource) => void
  let reject!: (cause: Error) => void
  bridge.readNoteSource.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no }))
  const pending = actions.prefill()
  await vi.waitFor(() => expect(bridge.readNoteSource).toHaveBeenCalledTimes(2))
  actions.cancelPrefill()
  const retained = actions.current()
  error.mockClear()
  if (result === 'revision') resolve({ ...latest, revision: 8 })
  else reject(new Error('Old transport failure'))
  expect(await pending).toBe(false)
  expect(actions.current()).toBe(retained)
  expect(error).not.toHaveBeenCalled()
})

it('does not let an older Prefill completion clear a superseding confirmation', async () => {
  const { actions, error } = await opened()
  let oldRead!: (source: NoteSource) => void
  let newRead!: (source: NoteSource) => void
  bridge.readNoteSource.mockReturnValueOnce(new Promise(resolve => { oldRead = resolve }))
  const old = actions.prefill()
  await vi.waitFor(() => expect(bridge.readNoteSource).toHaveBeenCalledTimes(2))
  bridge.readNoteSource.mockReturnValueOnce(new Promise(resolve => { newRead = resolve }))
  const next = actions.prefill()
  await vi.waitFor(() => expect(bridge.readNoteSource).toHaveBeenCalledTimes(3))
  error.mockClear()
  oldRead({ ...latest, revision: 7 })
  expect(await old).toBe(false)
  expect(error).not.toHaveBeenCalled()
  expect(actions.current()?.source?.revision).toBe(0)
  newRead(latest)
  expect(await next).toBe(true)
  expect(richEditorDocumentToHtml(actions.current()!.document)).toContain('Reviewed exact source')
})

it.each(['title', 'body', 'metadata', 'kind'] as const)('invalidates pending Prefill on a %s edit even when the content returns to its initial value', async (field) => {
  const { actions } = await opened()
  const originalDocument = actions.current()!.document
  let finish!: (source: NoteSource) => void
  bridge.readNoteSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const pending = actions.prefill()
  await vi.waitFor(() => expect(bridge.readNoteSource).toHaveBeenCalledTimes(2))
  if (field === 'title') { actions.update({ title: 'Changed' }); actions.update({ title: '' }) }
  if (field === 'body') { actions.update({ document: richEditorDocumentFromHtml('<p>Changed body</p>') }); actions.update({ document: originalDocument }) }
  if (field === 'metadata') { actions.update({ metadataJson: '{"severity":"high"}' }); actions.update({ metadataJson: null }) }
  if (field === 'kind') { actions.update({ findingKind: 'risk' }); actions.update({ findingKind: 'bug' }) }
  finish(latest)
  expect(await pending).toBe(false)
})

it('can confirm Prefill after a navigation epoch changed while the same draft stayed open', async () => {
  const { actions, changeSession } = await opened()
  changeSession('session-1')
  expect(await actions.prefill()).toBe(true)
  expect(richEditorDocumentToHtml(actions.current()!.document)).toContain('Reviewed exact source')
})

it('cancels the Prefill that is still waiting for a local image and retains that image', async () => {
  const { actions, error } = await opened()
  let finishImage!: (data: string) => void
  bridge.readClipboardImageDataUrl.mockReturnValueOnce(new Promise(resolve => { finishImage = resolve }))
  const document = richEditorDocumentFromHtml('<p>Keep this image</p><img src="data:image/png;base64,aGVsbG8=">')
  const insertImage = vi.fn(() => { actions.update({ document }); return true })
  const registry = vi.spyOn(editorRegistry, 'richEditorImageInserterForId').mockReturnValue(insertImage)
  try {
    const image = actions.pasteImage({ editorId: 'current-editor', insertImage })
    const pending = actions.prefill()
    actions.cancelPrefill()
    error.mockClear()
    finishImage('data:image/png;base64,aGVsbG8=')
    await image
    expect(await pending).toBe(false)
    expect(actions.current()?.document).toBe(document)
    expect(actions.current()?.imageOperations).toEqual({})
    expect(bridge.readNoteSource).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
    expect(bridge.startAiActionJob).not.toHaveBeenCalled()
  } finally { registry.mockRestore() }
})
