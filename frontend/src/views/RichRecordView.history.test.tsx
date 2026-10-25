import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoredRichBody } from '../editor/editorDocument'
import { useRichEditorController } from '../editor/richEditorRegistry'
import { EditableRichRecord } from './RichRecordView'

type RecordId = 'a' | 'b'
type RecordBody = StoredRichBody & { title: string }

function EditorProbe({ editorId, onEditor }: { editorId: string; onEditor: (editor: Editor) => void }) {
  const controller = useRichEditorController(editorId)
  useEffect(() => {
    if (controller) onEditor(controller.editor)
  }, [controller, onEditor])
  return null
}

function RecordWorkspace({ onBodyChange, onEditor }: { onBodyChange: (id: RecordId, body: string) => void; onEditor: (editor: Editor) => void }) {
  const [records, setRecords] = useState<Record<RecordId, RecordBody>>({
    a: { title: 'A', body: '<p>AAA original body</p>', bodyJson: null, bodyFormat: null },
    b: { title: 'B', body: '<p>BBB original body</p>', bodyJson: null, bodyFormat: null },
  })
  const [selected, setSelected] = useState<RecordId>('a')
  const [editing, setEditing] = useState(false)
  const [original, setOriginal] = useState(records.a)
  const record = records[selected]
  const editorId = `record-${selected}`
  return <>
    <button disabled={editing} onClick={() => setSelected('a')}>View A</button>
    <button disabled={editing} onClick={() => setSelected('b')}>View B</button>
    <EditableRichRecord
      record={record} editing={editing} editorId={editorId}
      titleInputLabel="Record title" bodyAriaLabel={`${record.title} ${editing ? 'body' : 'preview'}`}
      placeholder="Record body" previewFallbackHtml="<p>Empty record</p>"
      previewHeader={<h2>{record.title}</h2>}
      actions={editing ? <>
        <button onClick={() => setEditing(false)}>Save</button>
        <button onClick={() => { setRecords(current => ({ ...current, [selected]: original })); setEditing(false) }}>Discard</button>
      </> : <button onClick={() => { setOriginal(record); setEditing(true) }}>Edit</button>}
      onTitleChange={title => setRecords(current => ({ ...current, [selected]: { ...current[selected], title } }))}
      onBodyChange={patch => {
        onBodyChange(selected, patch.body)
        setRecords(current => ({ ...current, [selected]: { ...current[selected], ...patch } }))
      }}
      onUploadImage={() => undefined}
    />
    <EditorProbe editorId={editorId} onEditor={onEditor} />
  </>
}

function renderWorkspace() {
  const emitted: Array<{ id: RecordId; body: string }> = []
  let editor: Editor | null = null
  render(<RecordWorkspace onBodyChange={(id, body) => emitted.push({ id, body })} onEditor={current => { editor = current }} />)
  return {
    emitted,
    user: userEvent.setup(),
    editor: async (label: string) => {
      const body = await screen.findByRole('textbox', { name: label })
      await waitFor(() => {
        expect(body).toHaveAttribute('contenteditable', 'true')
        expect(editor?.view.dom).toBe(body)
      })
      return editor!
    },
  }
}

afterEach(async () => {
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 1))
})

describe('real rich-record editor history ownership', () => {
  it('keeps B and its emitted body isolated after A preview, B preview, B Edit and Undo', async () => {
    const workspace = renderWorkspace()
    const preview = await screen.findByRole('textbox', { name: 'A preview' })
    await workspace.user.click(screen.getByRole('button', { name: 'View B' }))
    expect(screen.getByRole('textbox', { name: 'B preview' })).toHaveTextContent('BBB original body')
    await workspace.user.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await workspace.editor('B body')
    let undone = false
    act(() => { undone = editor.commands.undo() })
    expect({ undone, body: editor.getHTML(), emitted: workspace.emitted }).toEqual({
      undone: false, body: '<p>BBB original body</p>', emitted: [],
    })
    expect(editor.view.dom).toBe(preview)
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' authored') })
    expect(workspace.emitted).toEqual([{ id: 'b', body: '<p>BBB original body authored</p>' }])
    act(() => { editor.commands.undo() })
    expect(editor.getHTML()).toBe('<p>BBB original body</p>')
    expect(workspace.emitted).toEqual([
      { id: 'b', body: '<p>BBB original body authored</p>' },
      { id: 'b', body: '<p>BBB original body</p>' },
    ])
  })

  it('discards the previous edit session history without replacing the editor DOM', async () => {
    const workspace = renderWorkspace()
    const preview = await screen.findByRole('textbox', { name: 'A preview' })
    await workspace.user.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await workspace.editor('A body')
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' discarded') })
    expect(workspace.emitted).toEqual([{ id: 'a', body: '<p>AAA original body discarded</p>' }])
    await workspace.user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('textbox', { name: 'A preview' })).toHaveTextContent('AAA original body')
    await workspace.user.click(screen.getByRole('button', { name: 'Edit' }))
    const reopened = await workspace.editor('A body')
    let undone = false
    act(() => { undone = reopened.commands.undo() })
    expect({ undone, body: reopened.getHTML(), emitted: workspace.emitted }).toEqual({
      undone: false, body: '<p>AAA original body</p>',
      emitted: [{ id: 'a', body: '<p>AAA original body discarded</p>' }],
    })
    expect(reopened.view.dom).toBe(preview)
  })

  it('starts a fresh history after Save while retaining undo and redo for new authored edits', async () => {
    const workspace = renderWorkspace()
    const preview = await screen.findByRole('textbox', { name: 'A preview' })
    await workspace.user.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await workspace.editor('A body')
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' saved') })
    await workspace.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('textbox', { name: 'A preview' })).toHaveTextContent('AAA original body saved')
    await workspace.user.click(screen.getByRole('button', { name: 'Edit' }))
    const reopened = await workspace.editor('A body')
    let undone = false
    act(() => { undone = reopened.commands.undo() })
    expect({ undone, body: reopened.getHTML(), emitted: workspace.emitted }).toEqual({
      undone: false, body: '<p>AAA original body saved</p>',
      emitted: [{ id: 'a', body: '<p>AAA original body saved</p>' }],
    })
    act(() => { reopened.commands.insertContentAt(reopened.state.doc.content.size - 1, ' next') })
    act(() => { reopened.commands.undo() })
    act(() => { reopened.commands.redo() })
    expect(reopened.getHTML()).toBe('<p>AAA original body saved next</p>')
    expect(workspace.emitted).toEqual([
      { id: 'a', body: '<p>AAA original body saved</p>' },
      { id: 'a', body: '<p>AAA original body saved next</p>' },
      { id: 'a', body: '<p>AAA original body saved</p>' },
      { id: 'a', body: '<p>AAA original body saved next</p>' },
    ])
    expect(reopened.view.dom).toBe(preview)
  })
})
