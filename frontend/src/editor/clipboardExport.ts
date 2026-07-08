import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { renderToMarkdown } from '@tiptap/static-renderer/pm/markdown'
import { managedAttachmentImagesInDocument, richEditorDocumentFromHtml, type RichEditorDocument } from './editorDocument'
import { richTextEditorExtensions } from './editorExtensions'
import { managedAttachmentProtocol } from './editorHtml'
import { isSafeUrlWithProtocols, managedAttachmentIdFromSrc } from './htmlUtils'

export type ClipboardRecord = {
  title: string
  bodyHtml: string
}

export type ClipboardPayload = {
  plain: string
}

export type ClipboardImageReference = {
  attachmentId: string
  alt: string
}

export function formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload {
  const title = record.title.trim()
  const editorDocument = richEditorDocumentFromHtml(record.bodyHtml)
  const plainParts = [title ? `## ${title}` : '', renderMarkdownFromDocument(editorDocument)]
    .map((part) => trimBlankLines(part))
    .filter(Boolean)

  return {
    plain: trimBlankLines(plainParts.join('\n\n')),
  }
}

export async function copyRecordForJira(record: ClipboardRecord): Promise<void> {
  const payload = formatRecordForClipboard(record)
  await writePlainClipboard(payload.plain)
}

export async function writePlainClipboard(value: string): Promise<void> {
  const clipboard = navigator.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('Clipboard text writing is not available')
  await clipboard.writeText(value)
}

export function managedAttachmentReferencesForClipboard(record: ClipboardRecord): ClipboardImageReference[] {
  return managedAttachmentImagesInDocument(richEditorDocumentFromHtml(record.bodyHtml))
}

// The default renderToMarkdown mappings are overridden where the pinned
// clipboard format differs: text is not HTML-entity-escaped (this is plain
// text, not markup), italic uses `*`, headings get a separating blank line,
// task lists render checkbox markers, nested lists indent, and label==href
// links stay bare.
function renderMarkdownFromDocument(editorDocument: RichEditorDocument): string {
  if (!editorDocument.doc.content?.length) return ''

  return renderToMarkdown({
    extensions: richTextEditorExtensions(),
    content: editorDocument.doc,
    options: {
      nodeMapping: {
        text: ({ node }: { node: ProseMirrorNode }) => node.text ?? '',
        heading: ({ node, children }: { node: ProseMirrorNode; children?: string | string[] }) =>
          `\n${'#'.repeat(Number(node.attrs.level) || 2)} ${joinChildren(children)}\n`,
        // ManagedImage is a block node in this schema, so it separates itself
        // from neighboring blocks instead of relying on a paragraph wrapper.
        image: ({ node }: { node: ProseMirrorNode }) => `\n${imageMarkdown(node.attrs)}\n`,
        listItem: ({ node, children, parent }: { node: ProseMirrorNode; children?: string | string[]; parent?: ProseMirrorNode }) =>
          listItemMarkdown(node, children, parent),
        taskList: ({ children }: { children?: string | string[] }) => `\n${joinChildren(children)}`,
        taskItem: ({ node, children }: { node: ProseMirrorNode; children?: string | string[] }) =>
          `- [${node.attrs.checked ? 'x' : ' '}] ${joinChildren(children).trim()}\n`,
      },
      markMapping: {
        italic: ({ children }: { children?: string | string[] }) => `*${joinChildren(children)}*`,
        link: ({ mark, children }: { mark: Mark; children?: string | string[] }) => {
          const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : ''
          const label = joinChildren(children)
          if (!href) return label
          if (!label || label === href) return href
          return `[${label}](${href})`
        },
      },
    },
  })
}

function listItemMarkdown(node: ProseMirrorNode, children: string | string[] | undefined, parent?: ProseMirrorNode): string {
  const rendered = Array.isArray(children) ? children : [children ?? '']
  const bodyParts: string[] = []
  const nestedParts: string[] = []

  node.forEach((child, _offset, index) => {
    const part = rendered[index] ?? ''
    if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
      nestedParts.push(indentLines(part.trim()))
    } else {
      bodyParts.push(part)
    }
  })

  const marker = parent?.type.name === 'orderedList' ? `${orderedListPosition(node, parent)}.` : '-'
  const line = `${marker} ${bodyParts.join('').trim()}`
  return nestedParts.length ? `${line}\n${nestedParts.join('\n')}\n` : `${line}\n`
}

function orderedListPosition(node: ProseMirrorNode, parent: ProseMirrorNode): number {
  let position = Number(parent.attrs.start) || 1
  parent.forEach((child, _offset, index) => {
    if (child === node) position = index + 1
  })
  return position
}

function indentLines(value: string): string {
  return value
    .split('\n')
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join('\n')
}

function joinChildren(children: string | string[] | undefined): string {
  return (Array.isArray(children) ? children : [children ?? '']).filter(Boolean).join('')
}

function imageMarkdown(attrs: Record<string, unknown>): string {
  const src = typeof attrs.src === 'string' ? attrs.src.trim() : ''
  const alt = (typeof attrs.alt === 'string' && attrs.alt.trim()) || 'Attached image'
  const isManaged = Boolean(attrs.attachmentId) || Boolean(managedAttachmentIdFromSrc(src)) || src.startsWith(managedAttachmentProtocol)
  // Managed and data: images cannot render outside the app -> text placeholder.
  if (isManaged || /^data:image\//i.test(src) || !isSafeUrlWithProtocols(src, new Set(['http:', 'https:']))) {
    return `Image: ${alt}`
  }
  return `![${alt}](${src})`
}

function trimBlankLines(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
