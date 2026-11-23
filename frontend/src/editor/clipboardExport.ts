import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { renderToMarkdown } from '@tiptap/static-renderer/pm/markdown'
import { copyHtmlToClipboard } from '../tauri'
import { managedAttachmentImagesInDocument, richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'
import { richTextEditorExtensions } from './editorExtensions'
import { managedAttachmentProtocol } from './editorHtml'
import { escapeHtml, isSafeUrlWithProtocols, managedAttachmentIdFromSrc } from './htmlUtils'

export type ClipboardRecord = {
  title: string
  bodyHtml: string
}

export type ClipboardPayload = {
  plain: string
  html: string
}

export type ClipboardImageReference = {
  attachmentId: string
  alt: string
}

export function formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload {
  const title = record.title.trim()
  const editorDocument = richEditorDocumentFromHtml(record.bodyHtml)
  const codeBlocks: string[] = []
  const plainParts = [title ? `## ${title}` : '', renderMarkdownFromDocument(editorDocument, codeBlocks)]
    .map((part) => trimBlankLines(part))
    .filter(Boolean)

  return {
    plain: restoreCodeBlocks(trimBlankLines(plainParts.join('\n\n')), codeBlocks),
    html: renderClipboardHtml(title, editorDocument),
  }
}

// Semantic tags only, no inline styles — Jira applies its own theme (keeps
// the intent of the old plain-text-only decision). The innerHTML assignment
// is safe: richEditorDocumentToHtml output is DOMPurify-sanitized, and the
// container stays detached from the live document.
function renderClipboardHtml(title: string, editorDocument: RichEditorDocument): string {
  const container = document.createElement('div')
  container.innerHTML = richEditorDocumentToHtml(editorDocument)
  container.querySelectorAll('img').forEach((image) => {
    const src = image.getAttribute('src') ?? ''
    if (src.startsWith(managedAttachmentProtocol) || /^data:image\//i.test(src)) {
      const alt = image.getAttribute('alt')?.trim() || 'Attached image'
      image.replaceWith(document.createTextNode(`Image: ${alt}`))
    }
  })
  const heading = title ? `<h2>${escapeHtml(title)}</h2>` : ''
  return `${heading}${container.innerHTML}`
}

// Preferred order: the native command (macOS WKWebView has no ClipboardItem,
// so the web path cannot write text/html there), then the web clipboard API,
// then plain text as the last resort.
export async function copyRecordForJira(record: ClipboardRecord): Promise<void> {
  const payload = formatRecordForClipboard(record)
  try {
    await copyHtmlToClipboard(payload.html, payload.plain)
    return
  } catch {
    // Not running inside Tauri (tests, storybook-style harnesses) or the
    // command failed; fall through to the web clipboard API.
  }
  const clipboard = navigator.clipboard
  if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
    await clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([payload.html], { type: 'text/html' }),
        'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
      }),
    ])
    return
  }
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
// task lists render checkbox markers, nested lists indent, code blocks have no
// language, inline code outgrows backticks inside it, and label==href links stay bare.
// Each code block renders as a placeholder line, so the white space cleanup between blocks
// leaves its code alone; `restoreCodeBlocks` puts the fenced code back.
function renderMarkdownFromDocument(editorDocument: RichEditorDocument, codeBlocks: string[]): string {
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
          `- [${node.attrs.checked ? 'x' : ' '}] ${indentContinuation(joinChildren(children).trim(), 2)}\n`,
        // A plain code block: no language after the fence, which grows past any fence inside.
        codeBlock: ({ node }: { node: ProseMirrorNode }) => {
          const fence = codeFence(node.textContent)
          codeBlocks.push(`${fence}\n${node.textContent}\n${fence}`)
          return `\n${codeBlockPlaceholder(codeBlocks.length - 1)}\n`
        },
      },
      markMapping: {
        italic: ({ children }: { children?: string | string[] }) => `*${joinChildren(children)}*`,
        code: ({ children }: { children?: string | string[] }) => codeSpan(joinChildren(children)),
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
  const line = `${marker} ${indentContinuation(bodyParts.join('').trim(), marker.length + 1)}`
  return nestedParts.length ? `${line}\n${nestedParts.join('\n')}\n` : `${line}\n`
}

function orderedListPosition(node: ProseMirrorNode, parent: ProseMirrorNode): number {
  const start = Number.isInteger(parent.attrs.start) ? Number(parent.attrs.start) : 1
  let position = start
  parent.forEach((child, _offset, index) => {
    if (child === node) position = start + index
  })
  return position
}

function codeFence(code: string): string {
  let fence = '```'
  while (code.includes(fence)) fence += '`'
  return fence
}

// The fence outgrows every backtick run in the code; a space pads code that starts or ends
// with a backtick, which CommonMark strips again.
function codeSpan(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${code}${pad}${fence}`
}

// Further blocks of a list item (paragraphs, code, quotes, dividers) sit at its content column.
function indentContinuation(body: string, width: number): string {
  const indent = ' '.repeat(width)
  return body
    .split('\n')
    .map((line, index) => (index > 0 && line.trim() ? `${indent}${line}` : line))
    .join('\n')
}

function codeBlockPlaceholder(index: number): string {
  return `\u0000${index}\u0000`
}

// Each placeholder line becomes its fenced code, every line under the placeholder's prefix
// (a list indent or quote marker); an empty code line keeps only the trimmed prefix.
function restoreCodeBlocks(value: string, codeBlocks: string[]): string {
  return value.replace(/^(.*)\u0000(\d+)\u0000$/gm, (_match, prefix: string, index: string) =>
    (codeBlocks[Number(index)] ?? '')
      .split('\n')
      .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
      .join('\n'),
  )
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
