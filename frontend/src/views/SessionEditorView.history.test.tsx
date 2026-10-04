import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ComponentProps } from 'react'
import { closeHistory } from '@tiptap/pm/history'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
  importClipboardScreenshot: vi.fn(),
  deleteAttachment: vi.fn(),
  readClipboardImageDataUrl: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
  PROVIDER_MODEL_DEFAULTS: { claude_code: null, codex_cli: null, copilot_cli: null },
  PROVIDER_REASONING_DEFAULTS: { claude_code: null, codex_cli: null, copilot_cli: null },
}))

import { deleteAttachment, getAttachmentPreviewDataUrl, importClipboardScreenshot } from '../tauri'
import { createAttachmentActions, type AttachmentActionsContext } from '../app/attachmentActions'
import { emptyRichEditorDocument, richEditorDocumentFromHtml, richEditorDocumentToHtml, richEditorDocumentsEqual, type RichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentImageHtml } from '../editor/editorHtml'
import { useRichEditorController, type RichEditorController } from '../editor/richEditorRegistry'
import { entryFixture, providerStatusFixture, sessionFixture } from '../test/fixtures'
import { SessionEditorView } from './SessionEditorView'

type ViewProps = ComponentProps<typeof SessionEditorView>
const preview = vi.mocked(getAttachmentPreviewDataUrl)
const nativeImport = vi.mocked(importClipboardScreenshot)
const nativeDelete = vi.mocked(deleteAttachment)
const sessionA = sessionFixture({ id: 'session-a', title: 'Session A' })
const sessionB = sessionFixture({ id: 'session-b', title: 'Session B' })
const doc = (text: string) => richEditorDocumentFromHtml(`<p>${text}</p>`)

beforeAll(() => {
  const rect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const rects = { 0: rect, length: 1, item: (index: number) => index === 0 ? rect : null, [Symbol.iterator]: function* () { yield rect } } as DOMRectList
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => rects })
  Object.defineProperty(Text.prototype, 'getClientRects', { configurable: true, value: () => rects })
})

beforeEach(() => {
  vi.resetAllMocks()
  preview.mockResolvedValue('data:image/png;base64,AAAA')
  nativeDelete.mockResolvedValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// Only the native boundary is mocked. The probe reads the production registry.
function ControllerProbe({ capture }: { capture: (controller: RichEditorController | null) => void }) {
  const controller = useRichEditorController('note-body-editor')
  useEffect(() => capture(controller))
  return null
}

function mountSession(initialBody = doc('A original'), onUploadImage: ViewProps['onUploadImage'] = () => {}) {
  let session = sessionA
  let body = initialBody
  let controller: RichEditorController | null = null
  let presentation: Partial<ViewProps> = {}
  const mounted: { current?: ReturnType<typeof render> } = {}
  const bodies = new Map<string, RichEditorDocument>([[sessionA.id, body]])
  // setEditable can report the unchanged mount value. Track semantic edits,
  // including foreign-history callbacks, rather than baseline notifications.
  const changed = vi.fn((next: RichEditorDocument) => {
    body = next
    bodies.set(session.id, next)
    mounted.current?.rerender(view())
  })
  const onSetNoteBody = (next: RichEditorDocument) => {
    if (!richEditorDocumentsEqual(body, next)) changed(next)
  }
  const view = () => <>
    <SessionEditorView
      activeProviderAvailable activeSession={session} busyAction={null} copySucceeded={false}
      canUndoLatestGeneration={false} screenshotCopySucceeded={false} filteredSessions={[sessionA, sessionB]}
      isBusy={false} noteBody={body} noteIsReady noteScreenshotCount={0} sessionTitle={session.title}
      noteWordCount={2} notice={null} error={null} pendingAiActions={{}} selectedProvider="codex_cli"
      selectedModel="default" activeProvider={providerStatusFixture().providers[0]}
      onAiAction={async () => {}} onUndoLatestGeneration={async () => {}} onCopyNote={async () => {}}
      onCopyNoteScreenshot={async () => {}} onDeleteSession={() => {}} onOpenSession={async () => {}}
      onSetNoteBody={onSetNoteBody} onSetSessionTitle={() => {}} onUploadImage={onUploadImage} {...presentation}
    />
    <ControllerProbe capture={(next) => { controller = next }} />
  </>
  mounted.current = render(view())
  return {
    changed,
    async ready() {
      await waitFor(() => {
        if (!controller) throw new Error('Session editor is not registered')
        expect(controller.editor.isDestroyed).toBe(false)
        expect(controller.editor.view.dom).toBe(screen.getByRole('textbox', { name: 'Note body' }))
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Bold' }).disabled).toBe(false)
      })
      return screen.getByRole('textbox', { name: 'Note body' })
    },
    get controller() {
      if (!controller) throw new Error('Session editor is not registered')
      return controller
    },
    get html() { return richEditorDocumentToHtml(body) },
    switchTo(next: typeof sessionA, nextBody?: RichEditorDocument) {
      session = next
      body = nextBody ?? bodies.get(next.id) ?? emptyRichEditorDocument
      bodies.set(next.id, body)
      mounted.current?.rerender(view())
    },
    update(next: Partial<ViewProps>) { presentation = next; mounted.current?.rerender(view()) },
  }
}

function selectParagraph(editor: HTMLElement, index = 0, end = false) {
  editor.focus()
  const node = editor.querySelectorAll('p')[index]?.firstChild
  if (!node?.textContent) throw new Error('Editor paragraph text missing')
  const range = document.createRange()
  if (end) { range.setStart(node, node.textContent.length); range.collapse(true) }
  else range.selectNodeContents(node)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  fireEvent.mouseUp(editor)
}

function historyKey(redo = false) {
  const editor = screen.getByRole('textbox', { name: 'Note body' })
  editor.focus()
  fireEvent.keyDown(editor, { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: redo })
}

async function expectEmptyHistory(harness: ReturnType<typeof mountSession>, text: string) {
  harness.changed.mockClear()
  historyKey()
  expect(screen.getByRole('textbox', { name: 'Note body' }).textContent).toBe(text)
  historyKey(true)
  expect(screen.getByRole('textbox', { name: 'Note body' }).textContent).toBe(text)
  expect(harness.changed).not.toHaveBeenCalled()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SessionEditorView Session-scoped editor lifetime', () => {
  it('isolates immediate undo and redo callbacks across A -> B -> A', async () => {
    const harness = mountSession()
    selectParagraph(await harness.ready(), 0, true)
    await userEvent.setup().keyboard(' edited')
    await waitFor(() => expect(harness.html).toContain('A original edited'))
    harness.switchTo(sessionB, doc('B original'))
    await harness.ready()
    await expectEmptyHistory(harness, 'B original')
    harness.switchTo(sessionA)
    await harness.ready()
    await expectEmptyHistory(harness, 'A original edited')
  })

  it('isolates identical Note bodies with different prior history', async () => {
    const harness = mountSession(doc('A private history'))
    await harness.ready()
    act(() => {
      const editor = harness.controller.editor
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor.commands.insertContentAt({ from: 0, to: editor.state.doc.content.size }, '<p>Shared body</p>')
    })
    expect(harness.html).toBe('<p>Shared body</p>')
    harness.switchTo(sessionB, doc('Shared body'))
    await harness.ready()
    await expectEmptyHistory(harness, 'Shared body')
    harness.switchTo(sessionA)
    await harness.ready()
    await expectEmptyHistory(harness, 'Shared body')
  })

  it('does not carry a pending redo into a blank new Session', async () => {
    const harness = mountSession()
    selectParagraph(await harness.ready(), 0, true)
    await userEvent.setup().keyboard(' edited')
    historyKey()
    expect(harness.html).toBe('<p>A original</p>')
    harness.switchTo(sessionFixture({ id: 'session-new' }), emptyRichEditorDocument)
    await harness.ready()
    harness.changed.mockClear()
    historyKey(true)
    expect(screen.getByRole('textbox', { name: 'Note body' }).textContent).toBe('')
    historyKey()
    expect(screen.getByRole('textbox', { name: 'Note body' }).textContent).toBe('')
    expect(harness.changed).not.toHaveBeenCalled()
  })

  it('retains typing and node history for fresh same-ID Session objects and title/save updates', async () => {
    const harness = mountSession()
    selectParagraph(await harness.ready(), 0, true)
    const originalEditor = harness.controller.editor
    await userEvent.setup().keyboard(' edited')
    act(() => originalEditor.view.dispatch(closeHistory(originalEditor.state.tr)))
    fireEvent.change(screen.getByRole('combobox', { name: 'Block style' }), { target: { value: 'h2' } })
    await waitFor(() => expect(harness.html).toBe('<h2>A original edited</h2><p></p>'))
    harness.switchTo({ ...sessionA, title: 'Renamed Session' })
    harness.update({ sessionTitle: 'Renamed Session', sessionSaveState: 'saving' })
    await harness.ready()
    expect(harness.controller.editor).toBe(originalEditor)
    expect(screen.getByText('Saving...').closest('[role="status"]')?.textContent).toContain('Saving...')
    historyKey()
    expect(harness.html).toBe('<p>A original edited</p>')
    historyKey()
    expect(harness.html).toBe('<p>A original</p>')
    harness.update({ sessionTitle: 'Renamed Session', sessionSaveState: 'saved' })
    historyKey(true)
    expect(harness.html).toBe('<p>A original edited</p>')
    historyKey(true)
    expect(harness.html).toBe('<h2>A original edited</h2><p></p>')
    expect(harness.controller.editor).toBe(originalEditor)
  })

  it('preserves same-Session link state but clears open popover and error on a switch', async () => {
    const harness = mountSession()
    selectParagraph(await harness.ready())
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Link URL' }), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }))
    expect(screen.getByRole('alert').textContent).toContain('Use an http, https, or mailto link.')
    harness.switchTo({ ...sessionA, title: 'Renamed' })
    harness.update({ sessionSaveState: 'saving' })
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Link URL' }).value).toBe('javascript:alert(1)')
    expect(screen.getByRole('alert')).toBeTruthy()
    harness.switchTo(sessionB, doc('B original'))
    await harness.ready()
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    harness.switchTo(sessionA)
    await harness.ready()
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull()
  })

  it('does not apply a saved toolbar selection to the next Session', async () => {
    const harness = mountSession(richEditorDocumentFromHtml('<p>A first</p><p>A second</p>'))
    selectParagraph(await harness.ready())
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    harness.switchTo(sessionB, richEditorDocumentFromHtml('<p>B first</p><p>B second</p>'))
    selectParagraph(await harness.ready(), 1, true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Block style' }), { target: { value: 'h2' } })
    await waitFor(() => expect(harness.html).toBe('<p>B first</p><h2>B second</h2><p></p>'))
  })

  it('rejects delayed preview hydration from old A and displays the latest A preview', async () => {
    const oldPreview = deferred<string>()
    const latestPreview = deferred<string>()
    preview.mockReturnValueOnce(oldPreview.promise).mockReturnValue(latestPreview.promise)
    const harness = mountSession(richEditorDocumentFromHtml(`<p>A evidence</p>${managedAttachmentImageHtml('attachment-a', 'a.png')}`))
    await harness.ready()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    // Initial trailing-node normalization is baseline, not preview hydration.
    harness.changed.mockClear()
    harness.switchTo(sessionB, doc('B original'))
    await harness.ready()
    harness.switchTo(sessionA)
    await harness.ready()
    await act(async () => { oldPreview.resolve('data:image/png;base64,OLD'); await oldPreview.promise })
    expect(screen.getByRole('textbox', { name: 'Note body' }).querySelector('img')?.getAttribute('src')).not.toBe('data:image/png;base64,OLD')
    expect(preview).toHaveBeenCalledTimes(2)
    await act(async () => { latestPreview.resolve('data:image/png;base64,LATEST'); await latestPreview.promise })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note body' }).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,LATEST'))
    expect(harness.changed).not.toHaveBeenCalled()
  })

  it('deletes a deferred real toolbar import after A -> B -> A with the same Session and Entry IDs', async () => {
    const pendingImport = deferred<Awaited<ReturnType<typeof importClipboardScreenshot>>>()
    nativeImport.mockReturnValueOnce(pendingImport.promise)
    const noteA = entryFixture({ id: 'entry-a', sessionId: sessionA.id })
    const ctx: AttachmentActionsContext = {
      session: { activeSession: sessionA, noteEntry: noteA },
      feedback: { setBusyAction: vi.fn(), setError: vi.fn(), setNotice: vi.fn() },
      registerImportedAttachment: vi.fn(),
    }
    const actions = createAttachmentActions(ctx)
    const harness = mountSession(doc('A original'), (input) => actions.uploadEditorImage(input, { kind: 'note', id: ctx.session.noteEntry!.id }))
    await harness.ready()
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
    fireEvent.change(screen.getByLabelText('Upload image file'), { target: { files: [new File(['image'], 'late.png', { type: 'image/png' })] } })
    await waitFor(() => expect(nativeImport).toHaveBeenCalledTimes(1))
    expect(nativeImport).toHaveBeenCalledWith({ sessionId: sessionA.id, entryId: noteA.id, filename: 'late.png', dataUrl: expect.stringMatching(/^data:image\/png;base64,/) })
    ctx.session.activeSession = sessionB
    ctx.session.noteEntry = entryFixture({ id: 'entry-b', sessionId: sessionB.id })
    harness.switchTo(sessionB, doc('B original'))
    await harness.ready()
    ctx.session.activeSession = sessionA
    ctx.session.noteEntry = noteA
    harness.switchTo(sessionA)
    await harness.ready()
    harness.changed.mockClear()
    await act(async () => {
      pendingImport.resolve({ id: 'attachment-stale', filename: 'late.png' } as Awaited<ReturnType<typeof importClipboardScreenshot>>)
      await actions.waitForPendingAttachmentMutations()
    })
    expect(nativeDelete).toHaveBeenCalledWith('attachment-stale')
    expect(ctx.registerImportedAttachment).not.toHaveBeenCalled()
    expect(ctx.feedback.setError).toHaveBeenLastCalledWith(null)
    expect(harness.changed).not.toHaveBeenCalled()
    expect(harness.html).toBe('<p>A original</p>')
    expect(screen.getByRole('textbox', { name: 'Note body' }).querySelector('img')).toBeNull()
  })
})
