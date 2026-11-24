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
  const codeBlocks: CodeBlocks = { opener: placeholderOpener(`${title}${JSON.stringify(editorDocument.doc)}`), fenced: [] }
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
// task lists render checkbox markers, list item blocks stay in order at the item's
// content column, code blocks have no language, inline code outgrows backticks inside
// it, and label==href links stay bare.
// Each code block renders as a placeholder line, so the white space cleanup between blocks
// leaves its code alone; `restoreCodeBlocks` puts the fenced code back.
function renderMarkdownFromDocument(editorDocument: RichEditorDocument, codeBlocks: CodeBlocks): string {
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
          codeBlocks.fenced.push(`${fence}\n${node.textContent}\n${fence}`)
          return `\n${codeBlocks.opener}${codeBlocks.fenced.length - 1}${placeholderCloser}\n`
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
  let body = ''
  node.forEach((child, _offset, index) => {
    const part = rendered[index] ?? ''
    // A nested list follows the line before it directly, so the list stays tight, except an
    // ordered list starting past 1, which CommonMark reads right after a line as its text.
    const isList = child.type.name === 'bulletList' || child.type.name === 'orderedList'
    const separator = child.type.name === 'orderedList' && orderedListStart(child) !== 1 ? '\n\n' : '\n'
    body = isList ? `${body.replace(/\n+$/, '')}${separator}${part.trim()}\n` : `${body}${part}`
  })

  const marker = parent?.type.name === 'orderedList' ? `${orderedListPosition(node, parent)}.` : '-'
  return `${marker} ${indentContinuation(body.trim(), marker.length + 1)}\n`
}

function orderedListStart(list: ProseMirrorNode): number {
  return Number.isInteger(list.attrs.start) ? Number(list.attrs.start) : 1
}

function orderedListPosition(node: ProseMirrorNode, parent: ProseMirrorNode): number {
  const start = orderedListStart(parent)
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
// with a backtick, or starts and ends with a space while holding more than spaces, since
// CommonMark strips one space each side then.
function codeSpan(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const spaced = code.startsWith(' ') && code.endsWith(' ') && code.trim() !== ''
  const pad = code.startsWith('`') || code.endsWith('`') || spaced ? ' ' : ''
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

type CodeBlocks = { opener: string; fenced: string[] }

const placeholderCloser = '\uE001'

// A placeholder starts with a run of private-use characters longer than any run in the record,
// so literal text never reads as a placeholder.
function placeholderOpener(source: string): string {
  let opener = '\uE000'
  while (source.includes(opener)) opener += '\uE000'
  return opener
}

// Each placeholder line becomes its fenced code. The first line keeps the placeholder's prefix
// (list markers, indent, quote markers); later lines take it with each list marker turned into
// spaces, so they sit at the item's content column. An empty code line keeps the trimmed prefix.
function restoreCodeBlocks(value: string, codeBlocks: CodeBlocks): string {
  const placeholder = new RegExp(`^(.*?)${codeBlocks.opener}(\\d+)${placeholderCloser}$`, 'gm')
  return value.replace(placeholder, (_match, prefix: string, index: string) => {
    const continuation = prefix.replace(/(?:[-*+]|\d+[.)])(?= |$)/g, (marker) => ' '.repeat(marker.length))
    return (codeBlocks.fenced[Number(index)] ?? '')
      .split('\n')
      .map((line, lineIndex) => {
        const linePrefix = lineIndex === 0 ? prefix : continuation
        return line ? `${linePrefix}${line}` : linePrefix.trimEnd()
      })
      .join('\n')
  })
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
