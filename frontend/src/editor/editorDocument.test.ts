import { describe, expect, it } from 'vitest'

import {
  emptyRichEditorDocument,
  parseRichEditorDocument,
  preserveManagedImageNodes,
  richEditorDocumentFromHtml,
  richEditorDocumentFromStoredBody,
  richEditorDocumentToHtml,
  richEditorDocumentToPlainText,
  richEditorDocumentToStoredBody,
} from './editorDocument'
import { managedAttachmentImageHtml } from './editorHtml'

describe('editorDocument', () => {
  it('imports legacy escaped HTML into a Tiptap document and projects pretty HTML', () => {
    const document = richEditorDocumentFromHtml(`
      Cannot Log In to Gmail
      &lt;p&gt;Logging in to Gmail fails.&lt;/p&gt;
      &lt;h2&gt;Evidence&lt;/h2&gt;
    `)

    const html = richEditorDocumentToHtml(document)

    expect(html).toContain('Cannot Log In to Gmail')
    expect(html).toContain('<p>Logging in to Gmail fails.</p>')
    expect(html).toContain('<h2>Evidence</h2>')
    expect(html).not.toContain('&lt;p&gt;')
  })

  it('stores canonical JSON alongside derived compatibility HTML', () => {
    const document = richEditorDocumentFromHtml(`<p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}</p>`)
    const stored = richEditorDocumentToStoredBody(document)

    expect(stored.bodyFormat).toBe('tiptap_json')
    expect(stored.body).toContain('data-attachment-id="attachment-1"')
    expect(stored.bodyJson).toContain('"schemaVersion":1')
    expect(parseRichEditorDocument(stored.bodyJson)).not.toBeNull()
  })

  it('prefers stored JSON and falls back to legacy HTML', () => {
    const stored = richEditorDocumentToStoredBody(richEditorDocumentFromHtml('<p>Canonical body</p>'))
    const fromJson = richEditorDocumentFromStoredBody({ body: '<p>Legacy body</p>', bodyJson: stored.bodyJson, bodyFormat: stored.bodyFormat })
    const fromHtml = richEditorDocumentFromStoredBody({ body: '<p>Legacy body</p>', bodyJson: null, bodyFormat: 'html' })

    expect(richEditorDocumentToPlainText(fromJson)).toBe('Canonical body')
    expect(richEditorDocumentToPlainText(fromHtml)).toBe('Legacy body')
  })

  it('rejects invalid stored JSON and normalizes empty documents', () => {
    expect(parseRichEditorDocument('not json')).toBeNull()
    expect(richEditorDocumentToHtml(emptyRichEditorDocument)).toBe('')
  })

  it('preserves missing managed image nodes from the original document', () => {
    const original = richEditorDocumentFromHtml(`
      <p>Original evidence.</p>
      ${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}
    `)
    const generated = richEditorDocumentFromHtml('<p>Rewritten evidence.</p>')

    const html = richEditorDocumentToHtml(preserveManagedImageNodes(original, generated))

    expect(html).toContain('Rewritten evidence.')
    expect(html).not.toContain('Original evidence.')
    expect(html).toContain('src="qa-scribe-attachment://attachment-1"')
    expect(html).toContain('data-attachment-id="attachment-1"')
  })

  it('does not duplicate managed image nodes already returned by generation', () => {
    const original = richEditorDocumentFromHtml(`<p>Original</p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}`)
    const generated = richEditorDocumentFromHtml(`<p>Generated</p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}`)

    const html = richEditorDocumentToHtml(preserveManagedImageNodes(original, generated))

    expect(html.match(/data-attachment-id="attachment-1"/g)).toHaveLength(1)
  })

  it('preserves safe external image nodes from the original document', () => {
    const imageSource = 'https://example.com/evidence.png'
    const original = richEditorDocumentFromHtml(`<p>Original</p><img src="${imageSource}" alt="Evidence screenshot" />`)
    const generated = richEditorDocumentFromHtml('<p>Generated summary.</p>')

    const html = richEditorDocumentToHtml(preserveManagedImageNodes(original, generated))

    expect(html).toContain('Generated summary.')
    expect(html).toContain(`src="${imageSource}"`)
    expect(html).toContain('alt="Evidence screenshot"')
  })

  it('scrubs an unsafe link href from the parsed JSON doc itself, not just derived HTML', () => {
    const maliciousJson = JSON.stringify({
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Click me', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
          },
        ],
      },
    })

    // This is the JSON doc handed straight to `editor.commands.setContent` by RichTextEditor,
    // so asserting on it (not just derived HTML) proves the live-editor DOM never sees the unsafe href.
    const document = richEditorDocumentFromStoredBody({ body: '<p>Click me</p>', bodyJson: maliciousJson, bodyFormat: 'tiptap_json' })
    const textNode = document.doc.content?.[0]?.content?.[0]
    const linkMark = textNode?.marks?.find((mark) => mark.type === 'link')

    expect(linkMark?.attrs?.href).toBeFalsy()

    const html = richEditorDocumentToHtml(document)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('Click me')
  })

  it('scrubs an unsafe image src from the parsed JSON doc itself, not just derived HTML', () => {
    const maliciousJson = JSON.stringify({
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'file:///etc/passwd' } }] }],
      },
    })

    const document = richEditorDocumentFromStoredBody({ body: '', bodyJson: maliciousJson, bodyFormat: 'tiptap_json' })
    const imageNode = document.doc.content?.[0]?.content?.[0]

    expect(imageNode).toBeUndefined()

    const html = richEditorDocumentToHtml(document)
    expect(html).not.toContain('file://')
    expect(html).not.toContain('<img')
  })

  it('preserves safe links and managed images in stored bodyJson unchanged', () => {
    const safeJson = JSON.stringify({
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Evidence', marks: [{ type: 'link', attrs: { href: 'https://example.test/evidence' } }] }],
          },
          { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'qa-scribe-attachment://attachment-1', attachmentId: 'attachment-1', alt: 'gmail-error.png' } }] },
        ],
      },
    })

    const document = richEditorDocumentFromStoredBody({ body: '', bodyJson: safeJson, bodyFormat: 'tiptap_json' })
    const html = richEditorDocumentToHtml(document)

    expect(html).toContain('href="https://example.test/evidence"')
    expect(html).toContain('src="qa-scribe-attachment://attachment-1"')
    expect(html).toContain('data-attachment-id="attachment-1"')
  })

  it('drops a managed-protocol image src that does not match its attachmentId attribute', () => {
    const spoofedJson = JSON.stringify({
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'qa-scribe-attachment://attachment-1', attachmentId: 'attachment-2', alt: 'evidence.png' } }] }],
      },
    })

    const document = richEditorDocumentFromStoredBody({ body: '', bodyJson: spoofedJson, bodyFormat: 'tiptap_json' })
    const imageNode = document.doc.content?.[0]?.content?.[0]

    expect(imageNode?.attrs?.src).toBe('qa-scribe-attachment://attachment-2')
  })
})
