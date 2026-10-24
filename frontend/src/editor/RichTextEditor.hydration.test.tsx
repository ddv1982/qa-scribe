import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RichTextEditor } from './RichTextEditor'
import { richEditorDocumentFromHtml } from './editorDocument'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn().mockResolvedValue(null),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

afterEach(async () => {
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 1))
  vi.restoreAllMocks()
})

it('does not report the previous document as an edit when value and editability change together', async () => {
  const onChange = vi.fn()
  const original = richEditorDocumentFromHtml('<p>Previous document</p>')
  const selected = richEditorDocumentFromHtml('<h2>Feature</h2><p>Selected Gherkin</p>')
  const view = render(<RichTextEditor value={original} onChange={onChange} readOnly />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note body' }).getAttribute('contenteditable')).toBe('false'))
  onChange.mockClear()
  view.rerender(<RichTextEditor value={selected} onChange={onChange} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note body' }).textContent).toContain('Selected Gherkin'))
  expect(onChange).not.toHaveBeenCalled()
})
