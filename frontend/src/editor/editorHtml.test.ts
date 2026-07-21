import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

import { getAttachmentPreviewDataUrl } from '../tauri'
import {
  createManagedAttachmentPreviewCache,
  emptyEditorHtml,
  hydrateManagedAttachmentPreviews,
  isSafeEditorImageSource,
  isSafeEditorLinkUrl,
  managedAttachmentImageHtml,
  managedAttachmentProtocol,
  normalizeEditorHtml,
} from './editorHtml'

const getAttachmentPreviewDataUrlMock = vi.mocked(getAttachmentPreviewDataUrl)

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

describe('managed attachment preview hydration', () => {
  beforeEach(() => {
    getAttachmentPreviewDataUrlMock.mockReset()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('loads duplicate images once and reuses the preview across text-only editor updates', async () => {
    getAttachmentPreviewDataUrlMock.mockResolvedValue('data:image/png;base64,AAAA')
    const editor = mountEditor(`
      <p>Before typing</p>
      ${managedAttachmentImageHtml('attachment-1', 'first.png')}
      ${managedAttachmentImageHtml('attachment-1', 'duplicate.png')}
    `)
    const cache = createManagedAttachmentPreviewCache()

    await hydrateManagedAttachmentPreviews(editor, () => true, cache)

    expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(1)
    expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledWith('attachment-1')
    expect(Array.from(editor.querySelectorAll('img')).map((image) => image.getAttribute('src'))).toEqual([
      'data:image/png;base64,AAAA',
      'data:image/png;base64,AAAA',
    ])

    editor.querySelector('p')?.append(' and after typing')
    await hydrateManagedAttachmentPreviews(editor, () => true, cache)

    expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates reads that are already in flight', async () => {
    const preview = deferred<string | null>()
    getAttachmentPreviewDataUrlMock.mockReturnValue(preview.promise)
    const editor = mountEditor(managedAttachmentImageHtml('attachment-1', 'evidence.png'))
    const cache = createManagedAttachmentPreviewCache()

    const firstHydration = hydrateManagedAttachmentPreviews(editor, () => true, cache)
    const secondHydration = hydrateManagedAttachmentPreviews(editor, () => true, cache)
    await Promise.resolve()

    expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(1)

    preview.resolve('data:image/png;base64,AAAA')
    await Promise.all([firstHydration, secondHydration])

    expect(editor.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('rejects a stale response after an attachment is replaced', async () => {
    const firstPreview = deferred<string | null>()
    const replacementPreview = deferred<string | null>()
    getAttachmentPreviewDataUrlMock.mockImplementation((attachmentId) =>
      attachmentId === 'attachment-1' ? firstPreview.promise : replacementPreview.promise,
    )
    const editor = mountEditor(managedAttachmentImageHtml('attachment-1', 'first.png'))
    const image = editor.querySelector('img')
    if (!image) throw new Error('managed image missing')
    const cache = createManagedAttachmentPreviewCache()

    const firstHydration = hydrateManagedAttachmentPreviews(editor, () => true, cache)
    await Promise.resolve()
    image.setAttribute('data-attachment-id', 'attachment-2')
    image.setAttribute('src', `${managedAttachmentProtocol}attachment-2`)
    const replacementHydration = hydrateManagedAttachmentPreviews(editor, () => true, cache)
    await Promise.resolve()

    replacementPreview.resolve('data:image/png;base64,BBBB')
    await replacementHydration
    firstPreview.resolve('data:image/png;base64,AAAA')
    await firstHydration

    expect(getAttachmentPreviewDataUrlMock.mock.calls.map(([attachmentId]) => attachmentId)).toEqual(['attachment-1', 'attachment-2'])
    expect(image.getAttribute('data-attachment-id')).toBe('attachment-2')
    expect(image.getAttribute('src')).toBe('data:image/png;base64,BBBB')
  })

  it('drops removed identities so re-adding one starts a fresh read', async () => {
    const removedPreview = deferred<string | null>()
    getAttachmentPreviewDataUrlMock.mockReturnValueOnce(removedPreview.promise).mockResolvedValueOnce('data:image/png;base64,BBBB')
    const editor = mountEditor(managedAttachmentImageHtml('attachment-1', 'first.png'))
    const image = editor.querySelector('img')
    if (!image) throw new Error('managed image missing')
    const cache = createManagedAttachmentPreviewCache()

    const removedHydration = hydrateManagedAttachmentPreviews(editor, () => true, cache)
    await Promise.resolve()
    image.remove()
    await hydrateManagedAttachmentPreviews(editor, () => true, cache)
    removedPreview.resolve('data:image/png;base64,AAAA')
    await removedHydration

    expect(image.getAttribute('src')).toBe(`${managedAttachmentProtocol}attachment-1`)

    editor.append(image)
    await hydrateManagedAttachmentPreviews(editor, () => true, cache)

    expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(2)
    expect(image.getAttribute('src')).toBe('data:image/png;base64,BBBB')
  })

  it('waits for backoff before retrying a failed read and caches success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    getAttachmentPreviewDataUrlMock.mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValueOnce('data:image/png;base64,AAAA')
    const editor = mountEditor(managedAttachmentImageHtml('attachment-1', ''))
    const cache = createManagedAttachmentPreviewCache()

    try {
      expect(await hydrateManagedAttachmentPreviews(editor, () => true, cache)).toBe(250)
      expect(editor.querySelector('img')?.getAttribute('alt')).toBe('Attached image')

      expect(await hydrateManagedAttachmentPreviews(editor, () => true, cache)).toBe(250)
      expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(250)
      expect(await hydrateManagedAttachmentPreviews(editor, () => true, cache)).toBeNull()
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)

      expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(2)
      expect(editor.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds repeated failures to three reads for an unchanged identity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    getAttachmentPreviewDataUrlMock.mockRejectedValue(new Error('unavailable'))
    const editor = mountEditor(managedAttachmentImageHtml('attachment-1', 'evidence.png'))
    const cache = createManagedAttachmentPreviewCache()

    try {
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)
      expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(250)
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)
      expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(1_000)
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)
      await hydrateManagedAttachmentPreviews(editor, () => true, cache)

      expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a retry without waiting for a slower sibling preview', async () => {
    const failedPreview = deferred<string | null>()
    const slowPreview = deferred<string | null>()
    getAttachmentPreviewDataUrlMock.mockImplementation((attachmentId) => (
      attachmentId === 'attachment-1' ? failedPreview.promise : slowPreview.promise
    ))
    const editor = mountEditor(`
      ${managedAttachmentImageHtml('attachment-1', 'failed.png')}
      ${managedAttachmentImageHtml('attachment-2', 'slow.png')}
    `)
    const cache = createManagedAttachmentPreviewCache()
    let retryAfterMs: number | null | undefined
    const hydration = hydrateManagedAttachmentPreviews(editor, () => true, cache)
    void hydration.then((value) => { retryAfterMs = value })
    await vi.waitFor(() => expect(getAttachmentPreviewDataUrlMock).toHaveBeenCalledTimes(2))

    failedPreview.reject(new Error('temporarily unavailable'))
    await vi.waitFor(() => expect(retryAfterMs).toBe(250))
    expect(editor.querySelector('img[data-attachment-id="attachment-2"]')?.getAttribute('src')).toBe(
      `${managedAttachmentProtocol}attachment-2`,
    )

    slowPreview.resolve('data:image/png;base64,BBBB')
    await vi.waitFor(() => {
      expect(editor.querySelector('img[data-attachment-id="attachment-2"]')?.getAttribute('src')).toBe('data:image/png;base64,BBBB')
    })
  })
})

function mountEditor(html: string): HTMLElement {
  const editor = document.createElement('div')
  editor.innerHTML = html
  document.body.append(editor)
  return editor
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}
