import { useEffect, useMemo, useState } from 'react'
import { Streamdown, type Components } from 'streamdown'
import { createManagedAttachmentPreviewCache } from '../editor/editorHtml'
import { isSafeEditorLinkUrl } from '../editor/editorHtml'
import { testwarePreviewHtml } from './testwarePreviewHtml'

function EvidenceImage({ id, alt }: { id: string; alt: string }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    const cache = createManagedAttachmentPreviewCache()
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      const result = await cache.load(id)
      if (!active) return
      if (result.status === 'resolved') setPreview(result.preview)
      else if (result.status === 'failed' && result.retryAfterMs !== null) timer = setTimeout(() => void load(), result.retryAfterMs)
    }
    void load()
    return () => { active = false; clearTimeout(timer); cache.clear() }
  }, [id])
  // Only the native attachment command supplies a displayed source, never the
  // model's HTML. Identity is retained for inspection, not saved from this view.
  return preview
    ? <img src={preview} data-attachment-id={id} alt={alt} />
    : <span data-attachment-id={id}>Image: {alt}</span>
}

const components: Components = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  p: 'p', strong: 'strong', em: 'em', ul: 'ul', ol: 'ol', li: 'li',
  'qa-evidence': ({ node }) => {
    const id = String(node?.properties['attachment-id'] ?? '')
    const alt = String(node?.properties.alt ?? 'Attached image')
    return id ? <EvidenceImage key={id} id={id} alt={alt} /> : <span>Image: {alt}</span>
  },
  a: ({ href, children }) => href && isSafeEditorLinkUrl(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  img: ({ alt }) => <span>Image: {alt || 'Attached image'}</span>,
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? 'Completed check' : 'Pending check'} />,
}
const allowedTags = { 'qa-evidence': ['attachment-id', 'alt'] }
const oneHtmlBlock = (html: string) => [html]

export function TestwareGenerationPreview({ text, fallback, ariaLabel, running }: {
  text: string
  fallback: string
  ariaLabel: string
  running: boolean
}) {
  const html = useMemo(() => testwarePreviewHtml(text), [text])
  return <section role="region" aria-label={ariaLabel} data-renderer="streamdown" className="testware-generation-preview markdown-content">
    {text ? <Streamdown mode="streaming" isAnimating={running} controls={false} parseIncompleteMarkdown={false}
      parseMarkdownIntoBlocksFn={oneHtmlBlock} components={components} allowedTags={allowedTags}
      urlTransform={(url, key) => key === 'href' && isSafeEditorLinkUrl(url) ? url : ''}>
      {html}
    </Streamdown> : <p>{fallback}</p>}
  </section>
}
