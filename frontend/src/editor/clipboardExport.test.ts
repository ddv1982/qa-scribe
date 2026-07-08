import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyRecordForJira, formatRecordForClipboard, managedAttachmentReferencesForClipboard } from './clipboardExport'
import { managedAttachmentImageHtml } from './editorHtml'

describe('clipboardExport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('formats title and rich body as Markdown-like plain text', () => {
    const payload = formatRecordForClipboard({
      title: 'Gmail sign-in issue',
      bodyHtml: `
        <h2>Finding detail</h2>
        <p><strong>Gmail</strong> sign-in <em>fails</em> for <a href="https://example.test/ticket">ticket</a>.</p>
        <ul><li>Open Gmail</li></ul>
        <ol><li>Enter credentials</li></ol>
      `,
    })

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

    expect(payload.plain).toContain('- [x] Verify login')
    expect(payload.plain).toContain('- [ ] Verify logout')
  })

  it('keeps blank bodies blank while still copying the record title', () => {
    const payload = formatRecordForClipboard({
      title: 'Untitled finding',
      bodyHtml: '<p><br></p>',
    })

    expect(payload.plain).toBe('## Untitled finding')
  })

  it('replaces managed attachments with portable image placeholders', () => {
    const payload = formatRecordForClipboard({
      title: 'Screenshot evidence',
      bodyHtml: `<p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}</p>`,
    })

    expect(payload.plain).toContain('Image: gmail-error.png')
    expect(payload.plain).not.toContain('qa-scribe-attachment://')
  })

  it('copies Jira records as plain Markdown-style text when ClipboardItem is unavailable', async () => {
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

  it('copies Jira records with managed screenshots as plain text in the fallback path', async () => {
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

  it('copies Jira records with direct data images as plain text in the fallback path', async () => {
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

  it('renders a kitchen-sink document to markdown (golden)', () => {
    const payload = formatRecordForClipboard({
      title: 'Release check',
      bodyHtml: [
        '<h2>Summary</h2>',
        '<p><strong>Gmail</strong> sign-in <em>fails</em> for <a href="https://example.test/t/1">the ticket</a>.</p>',
        '<p>Line one<br />line two</p>',
        '<ul><li>alpha</li><li>beta<ul><li>nested</li></ul></li></ul>',
        '<ol><li>first</li><li>second</li></ol>',
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><input type="checkbox" checked />done</li><li data-type="taskItem" data-checked="false"><input type="checkbox" />open</li></ul>',
        '<p><img src="qa-scribe-attachment://abc" alt="screenshot" /></p>',
        '<p><img src="https://example.test/ext.png" alt="external" /></p>',
        '<h3>Notes</h3>',
        '<p>literal *stars* and _underscores_ and # hash</p>',
      ].join(''),
    })

    expect(payload.plain).toMatchInlineSnapshot(`
      "## Release check

      ## Summary

      **Gmail** sign-in *fails* for [the ticket](https://example.test/t/1).

      Line one
      line two

      - alpha
      - beta
        - nested

      1. first
      2. second

      - [x] done
      - [ ] open

      Image: screenshot

      ![external](https://example.test/ext.png)

      ### Notes

      literal *stars* and _underscores_ and # hash"
    `)
  })

  it('renders label-equals-href links as bare URLs (golden)', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<p>See <a href="https://example.test/x">https://example.test/x</a> now</p>',
    })

    expect(payload.plain).toMatchInlineSnapshot(`"See https://example.test/x now"`)
  })

  describe('rich clipboard payload', () => {
    it('builds an html flavor with an escaped heading and placeholders for managed images', () => {
      const payload = formatRecordForClipboard({
        title: 'Bug <one>',
        bodyHtml: '<p><strong>bold</strong></p><p><img src="qa-scribe-attachment://abc" alt="shot" /></p><p><img src="https://a.test/i.png" alt="ext" /></p>',
      })

      expect(payload.html).toContain('<h2>Bug &lt;one&gt;</h2>')
      expect(payload.html).toContain('<strong>bold</strong>')
      expect(payload.html).not.toContain('qa-scribe-attachment://')
      expect(payload.html).toContain('Image: shot')
      expect(payload.html).toContain('<img src="https://a.test/i.png"')
    })

    it('writes text/html and text/plain flavors when ClipboardItem is available', async () => {
      const write = vi.fn().mockResolvedValue(undefined)
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { write, writeText } })
      vi.stubGlobal(
        'ClipboardItem',
        class {
          items: Record<string, Blob>
          constructor(items: Record<string, Blob>) {
            this.items = items
          }
        },
      )

      await copyRecordForJira({ title: 'T', bodyHtml: '<p>a</p>' })

      expect(writeText).not.toHaveBeenCalled()
      expect(write).toHaveBeenCalledTimes(1)
      const calls = write.mock.calls as unknown as [[Array<{ items: Record<string, Blob> }>]]
      const item = calls[0][0][0]
      expect(Object.keys(item.items)).toEqual(['text/html', 'text/plain'])
      expect(await item.items['text/html'].text()).toBe('<h2>T</h2><p>a</p>')
      expect(await item.items['text/plain'].text()).toBe('## T\n\na')
    })
  })

  it('does not HTML-entity-escape plain text', () => {
    const payload = formatRecordForClipboard({
      title: 'Q&A',
      bodyHtml: '<p>Fish &amp; chips &lt; more</p>',
    })

    expect(payload.plain).toBe('## Q&A\n\nFish & chips < more')
  })

  it('keeps direct data images as placeholders in portable exports', () => {
    const payload = formatRecordForClipboard({
      title: 'Inline evidence',
      bodyHtml: '<p><img src="data:image/png;base64,BBBB" alt="inline.png" style="color: red" /></p>',
    })

    expect(payload.plain).not.toContain('style=')
    expect(payload.plain).not.toContain('color')
    expect(payload.plain).toContain('Image: inline.png')
  })
})
