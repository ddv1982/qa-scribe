import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findingFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml, richEditorDocumentToHtml } from '../editor/editorDocument'
import type { CommitCreationSave, CreationOutcome, PrepareCreationSave } from '../tauri'
import { createCreationActions } from './creationActions'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}

const bridge = vi.hoisted(() => ({ prepareCreationSave: vi.fn(), commitCreationSave: vi.fn(), abortCreationSave: vi.fn() }))
vi.mock('../tauri', async (original) => ({ ...await original<object>(), ...bridge }))
const committed: CreationOutcome = { state: 'committed', record: { kind: 'finding', record: findingFixture() } }
function setup() {
  let session = 'session-1'
  let epoch = 0
  const selected = vi.fn(async () => true)
  const error = vi.fn()
  const actions = createCreationActions({ activeSessionId: () => session, beginNavigation: () => ++epoch,
    openDestination: vi.fn(), changed: vi.fn(), decisionChanged: vi.fn(), selectSaved: selected, error })
  return { actions, selected, error, session: (next: string) => { session = next } }
}

beforeEach(() => {
  vi.resetAllMocks()
  bridge.prepareCreationSave.mockImplementation(async (request: PrepareCreationSave) => ({ attemptId: request.attemptId, images: [], outcome: { state: 'preparing' } }))
  bridge.commitCreationSave.mockResolvedValue(committed)
  bridge.abortCreationSave.mockResolvedValue({ state: 'aborted' })
})

describe('creation intent ownership', () => {
  it.each(['finding', 'testware'] as const)('opens and cancels untouched %s with zero persistence calls', async (kind) => {
    const { actions } = setup()
    await actions.open(kind)
    expect(actions.current()?.phase.state).toBe('editing')
    expect(await actions.settle()).toBe(true)
    expect(actions.current()).toBeNull()
    expect(bridge.prepareCreationSave).not.toHaveBeenCalled()
    expect(bridge.commitCreationSave).not.toHaveBeenCalled()
    expect(bridge.abortCreationSave).not.toHaveBeenCalled()
  })
  it('keeps authored text on Keep editing and closes only after explicit discard', async () => {
    const { actions } = setup()
    await actions.open('finding')
    actions.update({ title: 'Authored title' })
    const first = actions.settle()
    await actions.decide('keep')
    expect(await first).toBe(false)
    expect(actions.current()?.title).toBe('Authored title')
    const second = actions.settle()
    await actions.decide('discard')
    expect(await second).toBe(true)
    expect(actions.current()).toBeNull()
  })
  it('coalesces duplicate Save and consumes only after exact returned record selection', async () => {
    const { actions, selected } = setup()
    const selection = deferred<boolean>()
    selected.mockReturnValue(selection.promise)
    await actions.open('finding')
    actions.update({ title: 'One result' })
    const first = actions.save()
    expect(actions.save()).toBe(first)
    await vi.waitFor(() => expect(selected).toHaveBeenCalledOnce())
    expect(actions.current()?.phase.state).toBe('saved')
    expect(bridge.commitCreationSave).toHaveBeenCalledTimes(1)
    selection.resolve(true)
    expect(await first).toBe(true)
    expect(actions.current()).toBeNull()
  })
  it('retains title, rich body and metadata after a failed Save and settles the old key before changed payload', async () => {
    const { actions } = setup()
    await actions.open('finding')
    const document = richEditorDocumentFromHtml('<p><strong>Keep all text</strong></p>')
    actions.update({ title: 'Original title', document, metadataJson: '{"severity":"high"}' })
    bridge.commitCreationSave.mockRejectedValueOnce(new Error('Disk full'))
    expect(await actions.save()).toBe(false)
    expect(actions.current()).toMatchObject({ title: 'Original title', document, metadataJson: '{"severity":"high"}', phase: { state: 'editing' } })
    const old = bridge.commitCreationSave.mock.calls[0][0] as CommitCreationSave
    expect(bridge.abortCreationSave).toHaveBeenCalledWith(old.attemptId)
    actions.update({ title: 'Changed deliberate payload' })
    expect(await actions.save()).toBe(true)
    const next = bridge.commitCreationSave.mock.calls[1][0] as CommitCreationSave
    expect(next.attemptId).not.toBe(old.attemptId)
    expect(next.record.title).toBe('Changed deliberate payload')
  })
  it('retries lost response with byte-identical payload/key and locks editing until settled', async () => {
    const { actions } = setup()
    await actions.open('finding')
    actions.update({ title: 'Immutable retry' })
    bridge.commitCreationSave.mockRejectedValueOnce(new Error('Lost response'))
    bridge.abortCreationSave.mockRejectedValueOnce(new Error('Offline'))
    expect(await actions.save()).toBe(false)
    expect(actions.current()?.phase.state).toBe('uncertain')
    const original = JSON.stringify(bridge.commitCreationSave.mock.calls[0][0])
    actions.update({ title: 'Forbidden mutation' })
    expect(actions.current()?.title).toBe('Immutable retry')
    expect(await actions.save()).toBe(true)
    expect(JSON.stringify(bridge.commitCreationSave.mock.calls[1][0])).toBe(original)
  })
  it('adopts a committed receipt when abort races the lost commit response', async () => {
    const { actions, selected } = setup()
    await actions.open('finding')
    actions.update({ title: 'Committed wins' })
    bridge.commitCreationSave.mockRejectedValueOnce(new Error('Lost response'))
    bridge.abortCreationSave.mockResolvedValueOnce(committed)
    expect(await actions.save()).toBe(true)
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ title: 'Committed wins' }), committed.state === 'committed' ? committed.record : null)
    expect(actions.current()).toBeNull()
  })
  it('reports committed-deleted without recreating, then permits closing it', async () => {
    const { actions, selected } = setup()
    await actions.open('finding')
    actions.update({ title: 'Deleted result' })
    bridge.commitCreationSave.mockResolvedValueOnce({ state: 'committedDeleted', recordId: 'deleted-id' })
    expect(await actions.save()).toBe(false)
    expect(actions.current()?.phase).toEqual({ state: 'committed-deleted', recordId: 'deleted-id' })
    expect(await actions.save()).toBe(false)
    expect(selected).not.toHaveBeenCalled()
    expect(bridge.commitCreationSave).toHaveBeenCalledOnce()
    expect(await actions.settle()).toBe(true)
  })
  it('does not consume an intent when the Session changed during Save', async () => {
    const { actions, selected, session } = setup()
    const response = deferred<CreationOutcome>()
    bridge.commitCreationSave.mockReturnValueOnce(response.promise)
    await actions.open('finding')
    actions.update({ title: 'Session bound' })
    const save = actions.save()
    await vi.waitFor(() => expect(bridge.commitCreationSave).toHaveBeenCalledOnce())
    session('session-2')
    response.resolve(committed)
    expect(await save).toBe(false)
    expect(selected).not.toHaveBeenCalled()
  })
  it('keeps borrowed Note images in the shared inventory without owned cleanup', async () => {
    const { actions } = setup()
    await actions.open('finding')
    actions.update({ title: 'Shared evidence', document: richEditorDocumentFromHtml('<p>Evidence</p><img src="qa-scribe-attachment://shared-note" data-attachment-id="shared-note">') })
    expect(await actions.save()).toBe(true)
    const payload = bridge.commitCreationSave.mock.calls[0][0] as CommitCreationSave
    expect(payload.sharedAttachmentIds).toEqual(['shared-note'])
    expect(payload.images).toEqual([])
    expect(payload.record.body).toContain('shared-note')
    expect(bridge.abortCreationSave).not.toHaveBeenCalled()
  })
  it('retains staged image bytes on failure and materializes compact matching HTML/JSON', async () => {
    const { actions } = setup()
    const dataUrl = 'data:image/png;base64,aGVsbG8='
    await actions.open('finding')
    actions.update({ title: 'Local evidence', document: richEditorDocumentFromHtml(`<p>Evidence</p><img src="${dataUrl}" alt="evidence.png">`) })
    bridge.prepareCreationSave.mockImplementation(async (request: PrepareCreationSave) => ({ attemptId: request.attemptId, images: [{ localId: 'image-0', attachmentId: 'reserved-id', filename: 'evidence.png' }], outcome: { state: 'preparing' } }))
    bridge.commitCreationSave.mockRejectedValueOnce(new Error('Save failed'))
    expect(await actions.save()).toBe(false)
    expect(richEditorDocumentToHtml(actions.current()!.document)).toContain(dataUrl)
    const payload = bridge.commitCreationSave.mock.calls[0][0] as CommitCreationSave
    expect(payload.images).toEqual([{ localId: 'image-0', dataUrl }])
    expect(payload.record.body).toContain('qa-scribe-attachment://reserved-id')
    expect(payload.record.body).not.toContain('base64')
    expect(payload.record.bodyJson).toContain('reserved-id')
    expect(payload.record.bodyJson).not.toContain('base64')
  })
})
