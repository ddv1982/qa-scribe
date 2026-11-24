import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyRecordForJira, formatRecordForClipboard, managedAttachmentReferencesForClipboard } from './clipboardExport'
import { managedAttachmentImageHtml } from './editorHtml'

describe('clipboardExport', () => {
  it('keeps escaped allowed-tag examples literal in both clipboard flavors', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<p>Assistant:</p><p>&lt;img src="https://example.test/tracker"&gt;&lt;strong&gt;literal&lt;/strong&gt;</p>' })
    expect(payload.html).not.toContain('<img')
    expect(payload.html).not.toContain('<strong>literal</strong>')
    expect(payload.html).toContain('&lt;img')
    expect(payload.plain).toContain('<img src="https://example.test/tracker">')
    expect(payload.plain).toContain('<strong>literal</strong>')
  })

  it('fences a code block past any fence inside it', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<pre><code>before\n```\nafter</code></pre>' })
    expect(payload.plain).toBe('````\nbefore\n```\nafter\n````')
  })

  it('keeps a code block exactly, with edge spaces, blank lines and a trailing newline', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<p>Log</p><pre><code>  indented  \n\n\n\nlast  \n</code></pre><p>After</p>' })
    expect(payload.plain).toBe('Log\n\n```\n  indented  \n\n\n\nlast  \n\n```\n\nAfter')
  })

  it('indents a code block, quote and divider inside a list item to its content column', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<ul><li><p>Item</p><pre><code>code\n\n  x</code></pre><blockquote><p>quoted</p></blockquote><hr></li></ul><ol><li><p>One</p><pre><code>c</code></pre></li></ol>',
    })
    expect(payload.plain).toBe(
      ['- Item', '', '  ```', '  code', '', '    x', '  ```', '', '  > quoted', '', '  ---', '', '1. One', '', '   ```', '   c', '   ```'].join('\n'),
    )
  })

  // The schema starts every list item with a paragraph, so an item with only a code block has an empty one first.
  it('writes the list marker once for a list item that holds only a code block', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<ul><li><p></p><pre><code>a\n\nb</code></pre></li></ul><ol start="10"><li><p></p><pre><code>c</code></pre></li></ol>',
    })
    expect(payload.plain).toBe(['- ```', '  a', '', '  b', '  ```', '', '10. ```', '    c', '    ```'].join('\n'))
  })

  it('keeps nested lists in document order at the parent content column', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<ol start="10"><li><p>Outer</p><ul><li><p>inner</p><pre><code>x</code></pre></li></ul><p>after</p></li></ol>',
    })
    expect(payload.plain).toBe(['10. Outer', '    - inner', '', '      ```', '      x', '      ```', '', '    after'].join('\n'))
  })

  // CommonMark lets only an ordered list starting at 1 interrupt a paragraph.
  it('separates a nested ordered list starting past one from the paragraph before it', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<ul><li><p>Parent</p><ol start="3"><li><p>Step</p></li></ol></li><li><p>Other</p><ol><li><p>One</p></li></ol></li></ul>',
    })
    expect(payload.plain).toBe(['- Parent', '', '  3. Step', '- Other', '  1. One'].join('\n'))
  })

  // `- ---` reads as a divider in place of the list item.
  it('writes the list marker on its own line for an item that starts with a divider', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<ul><li><p></p><hr></li><li><p>Next</p></li></ul><ol start="4"><li><p></p><hr><p>x</p></li></ol>',
    })
    expect(payload.plain).toBe(['-', '  ---', '- Next', '', '4.', '   ---', '', '   x'].join('\n'))
  })

  // A bare marker right after a line turns that line into a heading, so the nested list gets a blank line.
  it('separates a nested list that starts with a bare marker from the paragraph before it', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<ul><li><p>Parent</p><ol><li><p></p><hr></li></ol></li></ul><ul><li><p>Other</p><ul><li><p></p><hr></li></ul></li></ul>',
    })
    expect(payload.plain).toBe(['- Parent', '', '  1.', '     ---', '', '- Other', '', '  -', '    ---'].join('\n'))
  })

  it('pads a code span holding a tab or nonbreaking space between edge spaces', () => {
    for (const inner of ['\t', '\u00a0']) {
      const payload = formatRecordForClipboard({ title: '', bodyHtml: `<p>Run<code> ${inner} </code>now</p>` })
      expect(payload.plain).toBe(`Run\`  ${inner}  \`now`)
    }
  })

  it('keeps the trailing spaces of inline code at the end of a paragraph', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<p>Run <code>echo  </code></p>' })
    expect(payload.plain).toBe('Run `echo  `')
    expect(payload.html).toBe('<p>Run <code>echo  </code></p>')
  })

  it('keeps a mark after inline code ending in a space within the paragraph', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<p><code>run </code><em> then</em></p>' })
    expect(payload.plain).toBe('`run `*then*')
  })

  it('keeps literal text that looks like a code block placeholder', () => {
    const literal = '\uE0000\uE001'
    const payload = formatRecordForClipboard({ title: '', bodyHtml: `<p>${literal}</p><pre><code>x</code></pre><p>a ${literal}</p>` })
    expect(payload.plain).toBe([literal, '', '```', 'x', '```', '', `a ${literal}`].join('\n'))
  })

  it('keeps a code block inside a quote exactly', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<blockquote><pre><code>a  \n\n\n b</code></pre></blockquote>' })
    expect(payload.plain).toBe(['> ```', '> a  ', '>', '>', '>  b', '> ```'].join('\n'))
  })

  it('wraps inline code past any backtick run inside it', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<p><code>a`b</code> <code>``x</code> <code>`edge`</code> <code>plain</code></p>' })
    expect(payload.plain).toBe('``a`b`` ``` ``x ``` `` `edge` `` `plain`')
  })

  // CommonMark strips one space from each side of a code span holding more than spaces, so code
  // with a space at both edges gets one more; the plain text reads back as the same code.
  it('keeps the spaces inside inline code in both flavors', () => {
    const spaced = formatRecordForClipboard({ title: '', bodyHtml: '<p>Run <code>echo    hello</code> now</p>' })
    expect(spaced.plain).toBe('Run `echo    hello` now')
    expect(spaced.html).toBe('<p>Run <code>echo    hello</code> now</p>')
    for (const [code, span] of [
      [' fail ', '`  fail  `'],
      ['  x  ', '`   x   `'],
      [' lead', '` lead`'],
      ['trail ', '`trail `'],
      ['   ', '`   `'],
    ]) {
      const payload = formatRecordForClipboard({ title: '', bodyHtml: `<p>Run<code>${code}</code>now</p>` })
      expect(payload.plain).toBe(`Run${span}now`)
      expect(payload.html).toBe(`<p>Run<code>${code}</code>now</p>`)
    }
  })

  it('preserves non-default ordered numbering around separate task lists', () => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: '<ol start="7"><li><p>Seventh</p></li><li><p>Eighth</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul><ol start="10"><li><p>Tenth</p></li></ol>' })
    expect(payload.plain).toContain('7. Seventh')
    expect(payload.plain).toContain('8. Eighth')
    expect(payload.plain).toContain('- [x] Done')
    expect(payload.plain).toContain('10. Tenth')
    expect(payload.html).toContain('<ol start="7">')
    expect(payload.html).toContain('<ol start="10">')
  })

  it('exports submitted Markdown fallbacks with hard breaks and table cell text intact', () => {
    const payload = formatRecordForClipboard({
      title: '',
      bodyHtml: '<p>Assistant:</p><h2>Requirements</h2><p><strong>Important</strong></p><p>select 1;<br>second line</p><p>Name | Result</p><p>α | Pass</p>',
    })
    expect(payload.plain).toContain('## Requirements')
    expect(payload.plain).toContain('**Important**')
    expect(payload.plain).toMatch(/select 1;.*\nsecond line/)
    expect(payload.plain).toContain('α | Pass')
    expect(payload.html).toMatch(/select 1;<br\s*\/?>second line/)
  })

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

  // Phase 2's inline fixes hold inside a cell, and every pipe in a cell, also in code, is escaped.
  it('keeps pipes, code spaces, links and code inside bold intact in a table cell', () => {
    const cell = 'a | b <code>  x  </code>! <a href="https://example.test/a(b)">link</a> <strong>Run<code>c | d</code>now</strong>'
    const payload = formatRecordForClipboard({ title: '', bodyHtml: `<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>${cell}</p></td></tr></tbody></table>` })
    expect(payload.plain).toBe(['| Head |', '| --- |', '| a \\| b `   x   `! [link](<https://example.test/a(b)>) **Run**`c \\| d`**now** |'].join('\n'))
  })

  // A GFM reader takes `<br>` in a cell as a line break and backslash escapes as literal text.
  it.each([
    ['line breaks at the edges', '<br>alpha<br>', '<br>alpha<br>'],
    ['a break-only cell', '<br>', '<br>'],
    ['literal markup', '&lt;br&gt; *lit* _u_ a_b [x] ~s~ `c` \\ &amp;amp;', '\\<br> \\*lit\\* \\_u\\_ a_b \\[x\\] \\~s\\~ \\`c\\` \\\\ \\&amp;'],
    ['bold across a break', '<strong>alpha<br>beta</strong>', '**alpha**<br>**beta**'],
    ['italic inside bold', '<strong>a <em>b</em> c</strong>', '**a *b* c**'],
    ['underline under bold within a word', 'pre<strong><u>fix</u></strong>ed', 'pre<u>**fix**</u>ed'],
    ['underline under bold and italic within a word', 'pre<strong><em><u>fix</u></em></strong>ed', 'pre<u>***fix***</u>ed'],
  ])('writes %s in a table cell so it reads back the same', (_case, cellHtml, cellMarkdown) => {
    const payload = formatRecordForClipboard({ title: '', bodyHtml: `<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>${cellHtml}</p></td></tr></tbody></table>` })
    expect(payload.plain).toBe(['| Head |', '| --- |', `| ${cellMarkdown} |`].join('\n'))
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

  it.each([
    ['https://example.test/?q=)', '<https://example.test/?q=)>'],
    ['https://example.test/a(b', '<https://example.test/a(b>'],
    ['https://example.test/a\\b', '<https://example.test/a\\\\b>'],
    ['https://example.test/a&copy;', 'https://example.test/a\\&copy;'],
  ])('keeps a link to %s whole in paragraphs and table cells', (href, destination) => {
    const link = `<a href="${href.replace(/&/g, '&amp;')}">ticket</a>`
    const payload = formatRecordForClipboard({ title: '', bodyHtml: `<p>${link}</p><table><tbody><tr><th><p>${link}</p></th></tr></tbody></table>` })
    expect(payload.plain).toContain(`[ticket](${destination})`)
    expect(payload.plain).toContain(`| [ticket](${destination}) |`)
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
