import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]

// No base URL: relative, local-resource and executable schemes stay inert.
function safeMarkdownUrl(value: string): string {
  if (Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return ''
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol) ? value : ''
  } catch {
    return ''
  }
}

const components: Components = {
  a: ({ href, title, children }) => href
    ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  // Assistant content must not trigger image requests as it streams.
  img: ({ alt }) => <span className="markdown-image-text">{alt || 'Image'}</span>,
  table: ({ children }) => (
    <div className="markdown-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <pre tabIndex={0} aria-label="Code block">{children}</pre>,
}

export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="chat-message-text markdown-content">
      <Markdown remarkPlugins={plugins} components={components} urlTransform={safeMarkdownUrl}>{text}</Markdown>
    </div>
  )
})
