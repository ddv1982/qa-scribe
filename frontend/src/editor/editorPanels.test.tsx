import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { notesText } from '../testware/testRunNotes'
import { formatRecordForClipboard } from './clipboardExport'
import { normalizeRichEditorDocument, richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'
import { normalizeEditorHtml } from './editorHtml'
import { RichTextEditor } from './RichTextEditor'

afterEach(cleanup)

const kinds = [
  ['note', 'Note'],
  ['info', 'Info'],
  ['success', 'Success'],
  ['warning', 'Warning'],
  ['error', 'Error'],
] as const

const panelDocument = (kind: unknown): RichEditorDocument => ({
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'panel', attrs: { kind }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check it.' }] }] }] },
})

describe('panels', () => {
  it('keep their kind from JSON to HTML to JSON', () => {
    for (const [kind] of kinds) {
      const html = richEditorDocumentToHtml(panelDocument(kind))
      expect(html).toBe(`<aside data-panel="${kind}"><p>Check it.</p></aside>`)
      expect(richEditorDocumentFromHtml(html)).toEqual(panelDocument(kind))
    }
  })

  it('keep only a known kind through the sanitiser, and an unknown or missing one becomes a note', () => {
    expect(normalizeEditorHtml('<aside data-panel="warning" class="x" role="note" onclick="alert(1)"><p>A</p></aside>')).toBe('<aside data-panel="warning"><p>A</p></aside>')
    for (const tag of ['<aside data-panel="evil">', '<aside data-panel="WARNING">', '<aside>']) {
      expect(normalizeEditorHtml(`${tag}<p>A</p></aside>`)).toBe('<aside data-panel="note"><p>A</p></aside>')
    }
    expect(normalizeRichEditorDocument(panelDocument('evil'))).toEqual(panelDocument('note'))
    expect(normalizeRichEditorDocument(panelDocument(undefined))).toEqual(panelDocument('note'))
  })

  it('trims surrounding whitespace from panel kinds in HTML and JSON', () => {
    const html = '<aside data-panel=" warning "><p>Check it.</p></aside>'
    expect(normalizeEditorHtml(html)).toBe('<aside data-panel="warning"><p>Check it.</p></aside>')
    expect(richEditorDocumentFromHtml(html)).toEqual(panelDocument('warning'))
    expect(normalizeRichEditorDocument(panelDocument(' warning '))).toEqual(panelDocument('warning'))
  })

  it('count as content when empty, like a divider', () => {
    expect(normalizeEditorHtml('<aside data-panel="note"><p></p></aside>')).toBe('<aside data-panel="note"><p></p></aside>')
    expect(richEditorDocumentFromHtml('<aside data-panel="note"><p></p></aside>').doc.content?.[0]?.type).toBe('panel')
  })

  it('are a named note in the editor', () => {
    render(<RichTextEditor value={panelDocument('warning')} readOnly ariaLabel="Body" />)
    return expect(screen.findByRole('note', { name: 'Warning panel' })).resolves.toHaveTextContent('Check it.')
  })

  it('copy as a quote with a bold label, and name their kind in Result notes', () => {
    for (const [kind, label] of kinds) {
      const payload = formatRecordForClipboard({ title: '', bodyHtml: richEditorDocumentToHtml(panelDocument(kind)) })
      expect(payload.html).toBe(`<blockquote><p><strong>${label}</strong></p><p>Check it.</p></blockquote>`)
      expect(payload.plain).toBe(`> **${label}**\n>\n> Check it.`)
      expect(notesText(panelDocument(kind))).toBe(`${label}:\nCheck it.`)
    }
  })

  it.each([
    ['a numbered list starting at two', '<ol start="2"><li><p>Second</p></li></ol>', '> 2. Second'],
    ['a list item starting with a rule', '<ul><li><p></p><hr></li></ul>', '> -\n>   ---'],
  ])('separates the clipboard label from %s', (_label, list, markdown) => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: `<aside data-panel="warning">${list}</aside>` })
    expect(payload.plain).toBe(`> **Warning**\n>\n${markdown}`)
  })
})
