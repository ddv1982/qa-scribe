import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
}))

import { getAttachmentPreviewDataUrl } from '../tauri'
import { copyRecordForJira, formatRecordForClipboard, formatRecordForJiraClipboard, writeRichClipboard } from './clipboardExport'
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

    class MockClipboardItem {
      constructor(_items: Record<string, Blob>) {}
    }

    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await copyRecordForJira({
      title: 'Gmail sign-in issue',
      bodyHtml: '<p><strong>Login</strong> fails</p><ul><li>Open Gmail</li></ul>',
    })

    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(['## Gmail sign-in issue', '**Login** fails', '- Open Gmail'].join('\n\n'))
  })

  it('copies Jira records with managed screenshots as clean rich HTML', async () => {
    vi.mocked(getAttachmentPreviewDataUrl).mockResolvedValue('data:image/png;base64,AAAA')
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)

    class MockClipboardItem {
      items: Record<string, Blob>

      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }

    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await copyRecordForJira({
      title: 'Screenshot evidence',
      bodyHtml: `<p style="color: #111">${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}</p>`,
    })

    expect(getAttachmentPreviewDataUrl).toHaveBeenCalledWith('attachment-1')
    expect(write).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()

    const [[items]] = write.mock.calls as [[MockClipboardItem[]]]
    const html = await items[0].items['text/html'].text()
    const plain = await items[0].items['text/plain'].text()
    expect(html).toContain('<h2>Screenshot evidence</h2>')
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="gmail-error.png" />')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('color')
    expect(html).not.toContain('qa-scribe-attachment://')
    expect(html).not.toContain('data-attachment-id')
    expect(plain).toContain('Image: gmail-error.png')
  })

  it('falls back to plain Jira copy when a managed screenshot preview cannot be resolved', async () => {
    vi.mocked(getAttachmentPreviewDataUrl).mockResolvedValue(null)
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)

    class MockClipboardItem {
      constructor(_items: Record<string, Blob>) {}
    }

    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await copyRecordForJira({
      title: 'Screenshot evidence',
      bodyHtml: `<p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}</p>`,
    })

    expect(getAttachmentPreviewDataUrl).toHaveBeenCalledWith('attachment-1')
    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(['## Screenshot evidence', 'Image: gmail-error.png'].join('\n\n'))
  })

  it('formats direct data images for Jira without copying editor color styles', async () => {
    const payload = await formatRecordForJiraClipboard({
      title: 'Inline evidence',
      bodyHtml: '<p><img src="data:image/png;base64,BBBB" alt="inline.png" style="color: red" /></p>',
    })

    expect(payload.includesInlineImages).toBe(true)
    expect(payload.html).toContain('<img src="data:image/png;base64,BBBB" alt="inline.png" />')
    expect(payload.html).not.toContain('style=')
    expect(payload.html).not.toContain('color')
    expect(payload.plain).toContain('Image: inline.png')
  })

  it('writes rich clipboard data when the browser API is available', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)

    class MockClipboardItem {
      items: Record<string, Blob>

      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }

    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await writeRichClipboard({ html: '<p>Rich</p>', plain: 'Rich' })

    expect(write).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
    const [[items]] = write.mock.calls as [[MockClipboardItem[]]]
    expect(items[0].items['text/html']).toBeInstanceOf(Blob)
    expect(items[0].items['text/plain']).toBeInstanceOf(Blob)
  })

  it('falls back to plain text when rich clipboard writing fails', async () => {
    const write = vi.fn().mockRejectedValue(new Error('rich clipboard denied'))
    const writeText = vi.fn().mockResolvedValue(undefined)

    class MockClipboardItem {
      constructor(_items: Record<string, Blob>) {}
    }

    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await writeRichClipboard({ html: '<p>Rich</p>', plain: 'Rich' })

    expect(write).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('Rich')
  })
})
