import type { ReactElement } from 'react'
import { Streamdown, defaultUrlTransform, type UrlTransform } from 'streamdown'
import 'streamdown/styles.css'

export function DraftMarkdownView(props: { content: string }): ReactElement {
  return (
    <div className="draft-markdown-view" data-testid="draft-markdown-view">
      <Streamdown
        animated={false}
        controls={false}
        linkSafety={{ enabled: true }}
        mode="static"
        skipHtml
        urlTransform={safeDraftUrlTransform}
      >
        {props.content}
      </Streamdown>
    </div>
  )
}

export const safeDraftUrlTransform: UrlTransform = (url, key, node) => {
  if (node.tagName === 'img') return null
  const trimmed = url.trim()
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null
  return defaultUrlTransform(url, key, node) ?? null
}
