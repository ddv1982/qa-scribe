import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyRecordForJira, formatRecordForClipboard, managedAttachmentReferencesForClipboard } from './clipboardExport'
import { managedAttachmentImageHtml } from './editorHtml'

describe('clipboardExport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('formats title and rich body as HTML plus Markdown-like plain text', () => {
    const payload = formatRecordForClipboard({
      title: 'Gmail sign-in issue',
      bodyHtml: `
        <h2>Finding detail</h2>
        <p><strong>Gmail</strong> sign-in <em>fails</em> for <a href="https://example.test/ticket">ticket</a>.</p>
        <ul><li>Open Gmail</li></ul>
        <ol><li>Enter credentials</li></ol>
      `,
    })

    expect(payload.html).toContain('<h2>Gmail sign-in issue</h2>')
    expect(payload.html).toContain('<strong>Gmail</strong>')
    expect(payload.html).toContain('<em>fails</em>')
    expect(payload.html).toContain('<a href="https://example.test/ticket">ticket</a>')
    expect(payload.html).toContain('<ul><li>Open Gmail</li></ul>')
    expect(payload.html).toContain('<ol><li>Enter credentials</li></ol>')
    expect(payload.plain).toBe(
      [
        '## Gmail sign-in issue',
        '## Finding detail',
        '**Gmail** sign-in *fails* for [ticket](https://example.test/ticket).',
        '- Open Gmail',
        '1. Enter credentials',
      ].join('\n\n'),
    )
  })

  it('converts task list metadata into portable checkbox markers', () => {
    const payload = formatRecordForClipboard({
      title: 'Regression pass',
      bodyHtml: `
        <ul data-type="taskList">
          <li data-type="taskItem" data-checked="true"><input type="checkbox" checked />Verify login</li>
          <li data-type="taskItem" data-checked="false"><input type="checkbox" />Verify logout</li>
        </ul>
      `,
    })

    expect(payload.html).toContain('<li>[x] Verify login</li>')
    expect(payload.html).toContain('<li>[ ] Verify logout</li>')
    expect(payload.html).not.toContain('data-type')
    expect(payload.html).not.toContain('<input')
    expect(payload.plain).toContain('- [x] Verify login')
    expect(payload.plain).toContain('- [ ] Verify logout')
  })

  it('keeps blank bodies blank while still copying the record title', () => {
    const payload = formatRecordForClipboard({
      title: 'Untitled finding',
      bodyHtml: '<p><br></p>',
    })

    expect(payload.html).toBe('<h2>Untitled finding</h2>')
    expect(payload.plain).toBe('## Untitled finding')
  })

  it('replaces managed attachments with portable image placeholders', () => {
    const payload = formatRecordForClipboard({
      title: 'Screenshot evidence',
      bodyHtml: `<p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}</p>`,
    })

    expect(payload.html).toContain('Image: gmail-error.png')
    expect(payload.html).not.toContain('qa-scribe-attachment://')
    expect(payload.plain).toContain('Image: gmail-error.png')
    expect(payload.plain).not.toContain('qa-scribe-attachment://')
  })

  it('copies Jira records as plain Markdown-style text so Jira owns theme colors', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await copyRecordForJira({
      title: 'Gmail sign-in issue',
      bodyHtml: '<p><strong>Login</strong> fails</p><ul><li>Open Gmail</li></ul>',
    })

    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(['## Gmail sign-in issue', '**Login** fails', '- Open Gmail'].join('\n\n'))
  })

  it('copies Jira records with managed screenshots as plain text only', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await copyRecordForJira({
      title: 'Screenshot evidence',
      bodyHtml: `<p style="color: #111">${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}</p>`,
    })

    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(['## Screenshot evidence', 'Image: gmail-error.png'].join('\n\n'))
  })

  it('copies Jira records with direct data images as plain text only', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await copyRecordForJira({
      title: 'Inline evidence',
      bodyHtml: '<p><img src="data:image/png;base64,BBBB" alt="inline.png" style="color: red" /></p>',
    })

    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(['## Inline evidence', 'Image: inline.png'].join('\n\n'))
  })

  it('extracts unique managed screenshot references for explicit screenshot copy actions', () => {
    const references = managedAttachmentReferencesForClipboard({
      title: 'Screenshot evidence',
      bodyHtml: [
        '<p>',
        managedAttachmentImageHtml('attachment-1', 'gmail-error.png'),
        managedAttachmentImageHtml('attachment-1', 'duplicate.png'),
        managedAttachmentImageHtml('attachment-2', 'console.png'),
        '</p>',
      ].join(''),
    })

    expect(references).toEqual([
      { attachmentId: 'attachment-1', alt: 'gmail-error.png' },
      { attachmentId: 'attachment-2', alt: 'console.png' },
    ])
  })

  it('keeps direct data images as placeholders in portable exports', () => {
    const payload = formatRecordForClipboard({
      title: 'Inline evidence',
      bodyHtml: '<p><img src="data:image/png;base64,BBBB" alt="inline.png" style="color: red" /></p>',
    })

    expect(payload.html).not.toContain('style=')
    expect(payload.html).not.toContain('color')
    expect(payload.html).toContain('Image: inline.png')
    expect(payload.plain).toContain('Image: inline.png')
  })
})
