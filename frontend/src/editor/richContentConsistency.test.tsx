import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenerationRecord, EditableRichRecord } from '../views/RichRecordView'
import { RichTextEditor } from './RichTextEditor'
import { richEditorDocumentFromHtml } from './editorDocument'

afterEach(cleanup)

const html = '<h2>Requirements</h2><p><strong>Important</strong> <em>context</em> <a href="https://example.test/check">Reference</a></p><ul><li><p>Parent</p><ul><li><p>Nested</p></li></ul></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Verified</p></li></ul>'

describe('shared rich-content surfaces', () => {
  it('keeps supported structure identical in Note, Entry, Draft, Finding and generated previews', async () => {
    const value = richEditorDocumentFromHtml(html)
    const { container } = render(<>
      <RichTextEditor value={value} ariaLabel="Note content" onChange={vi.fn()} />
      <RichTextEditor value={value} ariaLabel="Entry content" readOnly />
      {(['Draft', 'Finding'] as const).flatMap((kind) => [false, true].map((editing) => <EditableRichRecord
        key={`${kind}-${editing}`} record={{ title: kind, body: html }} editing={editing}
        editorId={`${kind}-${editing}`} titleInputLabel={`${kind} title`} bodyAriaLabel={`${kind} ${editing ? 'editor' : 'preview'}`}
        placeholder="" previewFallbackHtml="" previewHeader={<h2>{kind}</h2>} actions={null}
        onTitleChange={vi.fn()} onBodyChange={vi.fn()} onUploadImage={vi.fn()}
      />))}
      <GenerationRecord title="Generated preview" titleAriaLabel="Generated title" bodyAriaLabel="Generated content"
        placeholder="" job={{ jobId: 'job', sessionId: 'session', action: 'testware', state: 'running', aiRunId: null, errorMessage: null, progressMessage: 'Generating', partialText: html }} onCancelGenerationJob={vi.fn(async () => {})} />
    </>)
    await waitFor(() => expect(container.querySelectorAll('.rich-editor h2')).toHaveLength(6))
    const editors = Array.from(container.querySelectorAll('.rich-editor'))
    expect(editors).toHaveLength(6)
    const preview = container.querySelector('[data-renderer="streamdown"]')!
    for (const editor of [...editors, preview]) {
      expect(editor.querySelector('h2')).toHaveTextContent('Requirements')
      expect(editor.querySelector('strong')).toHaveTextContent('Important')
      expect(editor.querySelector('em')).toHaveTextContent('context')
      expect(editor.querySelector('a')).toHaveAttribute('href', 'https://example.test/check')
      expect(editor.querySelector('ul ul')).toHaveTextContent('Nested')
      expect(editor.querySelector('input[type="checkbox"]')).toBeChecked()
    }
    expect(new Set(editors.map((editor) => editor.innerHTML)).size).toBe(1)
  })
})
