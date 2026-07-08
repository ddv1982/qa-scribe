import { describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

import {
  emptyEditorHtml,
  isSafeEditorImageSource,
  isSafeEditorLinkUrl,
  managedAttachmentImageHtml,
  normalizeEditorHtml,
} from './editorHtml'

describe('editorHtml', () => {
  it('normalizes blank and TipTap-empty documents to a true blank value', () => {
    const blankInputs = ['', '   ', '<br>', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '&lt;p&gt;&lt;br&gt;&lt;/p&gt;', '<script>alert("no")</script>']

    for (const input of blankInputs) {
      expect(normalizeEditorHtml(input)).toBe(emptyEditorHtml)
    }

    expect(normalizeEditorHtml('<p><input type="checkbox" /></p>')).not.toBe(emptyEditorHtml)
    expect(normalizeEditorHtml('<p><img src="data:image/png;base64,AAAA" alt="Evidence" /></p>')).not.toBe(emptyEditorHtml)
  })

  it('repairs escaped rich HTML and preserves supported WYSIWYG markup', () => {
    const html = normalizeEditorHtml(`
      &lt;h2&gt;Gmail login&lt;/h2&gt;
      &lt;p&gt;&lt;strong&gt;Bold&lt;/strong&gt; and &lt;em&gt;italic&lt;/em&gt; text.&lt;/p&gt;
      &lt;ul&gt;&lt;li&gt;Open Gmail&lt;/li&gt;&lt;/ul&gt;
      &lt;ol&gt;&lt;li&gt;Attempt login&lt;/li&gt;&lt;/ol&gt;
    `)

    expect(html).toContain('<h2>Gmail login</h2>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<ul><li>Open Gmail</li></ul>')
    expect(html).toContain('<ol><li>Attempt login</li></ol>')
    expect(html).not.toContain('&lt;h2&gt;')
  })

  it('repairs escaped rich HTML when a plain text title comes before tags', () => {
    const html = normalizeEditorHtml(`
      Cannot Log In to Gmail
      &lt;p&gt;Logging in to Gmail fails.&lt;/p&gt;
      &lt;h2&gt;Evidence&lt;/h2&gt;
      &lt;ul&gt;&lt;li&gt;Gmail displayed an error message.&lt;/li&gt;&lt;/ul&gt;
    `)

    expect(html).toContain('Cannot Log In to Gmail')
    expect(html).toContain('<p>Logging in to Gmail fails.</p>')
    expect(html).toContain('<h2>Evidence</h2>')
    expect(html).toContain('<ul><li>Gmail displayed an error message.</li></ul>')
    expect(html).not.toContain('&lt;p&gt;')
    expect(html).not.toContain('&lt;h2&gt;')
  })

  it('sanitizes links, checkboxes, scripts, and managed images for display', () => {
    const html = normalizeEditorHtml(`
      <script>alert("no")</script>
      <p><a href="javascript:alert(1)" onclick="bad()">Unsafe</a></p>
      <p><a href="https://example.test/evidence" onclick="bad()">Evidence</a></p>
      <p><input type="checkbox" checked /> Verified</p>
      ${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}
    `)

    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onclick')
    expect(html).toContain('<a href="https://example.test/evidence" target="_blank" rel="noreferrer">Evidence</a>')
    expect(html).toMatch(/<input type="checkbox" checked(="")?>/)
    expect(html).toContain('src="qa-scribe-attachment://attachment-1"')
    expect(html).toContain('data-attachment-id="attachment-1"')
    expect(html).toContain('alt="gmail-error.png"')
  })

  it('keeps Tiptap task-list metadata while stripping wrapper-only markup', () => {
    const html = normalizeEditorHtml(`
      <ul data-type="taskList" class="unused">
        <li data-type="taskItem" data-checked="true" class="unused">
          <label><input type="checkbox" checked="checked" /><span></span></label>
          <div><p>Verify Gmail login</p></div>
        </li>
      </ul>
    `)

    expect(html).toContain('<ul data-type="taskList">')
    expect(html).toContain('<li data-type="taskItem" data-checked="true">')
    expect(html).toMatch(/<input type="checkbox" checked(="")?>/)
    expect(html).toContain('<p>Verify Gmail login</p>')
    expect(html).not.toContain('<label>')
    expect(html).not.toContain('<span')
    expect(html).not.toContain('<div>')
    expect(html).not.toContain('class=')
  })

  describe('sanitizer characterization (pins behavior for DOMPurify swap)', () => {
    it('strips javascript: hrefs but keeps the link text', () => {
      expect(normalizeEditorHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBe('<p><a>x</a></p>')
    })

    it('removes event handler attributes', () => {
      expect(normalizeEditorHtml('<p><img src="https://a.test/i.png" onerror="alert(1)" /></p>')).toBe(
        '<p><img src="https://a.test/i.png"></p>',
      )
    })

    it('drops script/style/svg/math/iframe including their content', () => {
      for (const html of [
        '<p>a</p><script>alert(1)</script>',
        '<p>a</p><style>p{color:red}</style>',
        '<p>a</p><svg><animate onbegin="alert(1)" /></svg>',
        '<p>a</p><math><mtext>x</mtext></math>',
        '<p>a</p><iframe src="https://a.test"></iframe>',
      ]) {
        expect(normalizeEditorHtml(html)).toBe('<p>a</p>')
      }
    })

    it('unwraps unknown tags but keeps their content', () => {
      expect(normalizeEditorHtml('<div><p>a <span>b</span></p></div>')).toBe('<p>a b</p>')
    })

    it('removes HTML comments', () => {
      expect(normalizeEditorHtml('<p>a<!-- evil --></p>')).toBe('<p>a</p>')
    })

    it('strips id/name attributes (DOM clobbering)', () => {
      expect(normalizeEditorHtml('<p id="location" name="body">a</p>')).toBe('<p>a</p>')
    })

    it('strips per-tag-invalid attributes from allowed tags', () => {
      expect(normalizeEditorHtml('<p href="https://a.test" data-checked="true">a</p>')).toBe('<p>a</p>')
      expect(normalizeEditorHtml('<ol data-type="taskList"><li>a</li></ol>')).toBe('<ol><li>a</li></ol>')
    })

    it('neutralizes mXSS-style nesting', () => {
      const html = normalizeEditorHtml('<p><svg><p><img src="x" onerror="alert(1)"></p></svg></p>')
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('<svg')
    })

    it('removes non-checkbox inputs entirely', () => {
      expect(normalizeEditorHtml('<p><input type="text" value="x" /></p>')).toBe(emptyEditorHtml)
    })

    it('derives task item data-checked from the checkbox when the attribute is missing', () => {
      expect(
        normalizeEditorHtml('<ul data-type="taskList"><li data-type="taskItem"><input type="checkbox" checked />done</li></ul>'),
      ).toBe(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><input type="checkbox" checked="">done</li></ul>',
      )
    })

    it('canonicalizes managed attachment images to an exact shape', () => {
      expect(normalizeEditorHtml('<p><img src="qa-scribe-attachment://abc" class="x" alt="shot" /></p>')).toBe(
        '<p><img data-attachment-id="abc" src="qa-scribe-attachment://abc" alt="shot"></p>',
      )
    })

    it('keeps relative link hrefs (resolved against an http(s) base)', () => {
      expect(normalizeEditorHtml('<p><a href="/tickets/1">t</a></p>')).toBe(
        '<p><a href="/tickets/1" target="_blank" rel="noreferrer">t</a></p>',
      )
    })
  })

  it('accepts only safe rich editor links and images', () => {
    expect(isSafeEditorLinkUrl('https://example.test')).toBe(true)
    expect(isSafeEditorLinkUrl('mailto:qa@example.test')).toBe(true)
    expect(isSafeEditorLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeEditorImageSource('qa-scribe-attachment://attachment-1')).toBe(true)
    expect(isSafeEditorImageSource('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeEditorImageSource('file:///tmp/secret.png')).toBe(false)
  })
})
