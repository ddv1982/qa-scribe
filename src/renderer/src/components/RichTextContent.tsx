import type { JSONContent } from '@tiptap/core'
import { Fragment, type ReactElement, type ReactNode } from 'react'
import { parseRichTextMetadata } from '../domain/richText'

export function RichTextContent(props: { body: string; metadataJson: string | null }): ReactElement {
  const metadata = parseRichTextMetadata(props.metadataJson)
  if (!metadata) return <p>{props.body}</p>

  return <div className="rich-entry-content">{renderNodes(metadata.json.content ?? [])}</div>
}

function renderNodes(nodes: JSONContent[]): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, index)}</Fragment>)
}

function renderNode(node: JSONContent, index: number): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p>{renderNodes(node.content ?? [])}</p>
    case 'bulletList':
      return <ul>{renderNodes(node.content ?? [])}</ul>
    case 'orderedList':
      return <ol>{renderNodes(node.content ?? [])}</ol>
    case 'listItem':
      return <li>{renderNodes(node.content ?? [])}</li>
    case 'hardBreak':
      return <br />
    case 'text':
      return renderText(node, index)
    default:
      return renderNodes(node.content ?? [])
  }
}

function renderText(node: JSONContent, index: number): ReactNode {
  let content: ReactNode = node.text ?? ''

  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') content = <strong key={`bold-${index}`}>{content}</strong>
    if (mark.type === 'italic') content = <em key={`italic-${index}`}>{content}</em>
    if (mark.type === 'code') content = <code key={`code-${index}`}>{content}</code>
  }

  return content
}
