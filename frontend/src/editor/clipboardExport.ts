import { isSafeEditorLinkUrl, managedAttachmentProtocol, normalizeEditorHtml } from './editorHtml'
import { isSafeUrlWithProtocols, managedAttachmentIdFromImage } from './htmlUtils'

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
  return renderClipboardPayload(record.title, createNormalizedBody(record.bodyHtml))
}

function createNormalizedBody(bodyHtml: string): HTMLDivElement {
  const body = document.createElement('div')
  body.innerHTML = normalizeEditorHtml(bodyHtml)
  return body
}

function renderClipboardPayload(titleInput: string, body: ParentNode): ClipboardPayload {
  const title = titleInput.trim()

  const plainParts = [title ? `## ${title}` : '', renderPlainChildren(body)]
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
  const body = createNormalizedBody(record.bodyHtml)
  const images = Array.from(
    body.querySelectorAll<HTMLImageElement>('img[data-attachment-id], img[src^="qa-scribe-attachment://"]'),
  )
  const references = new Map<string, ClipboardImageReference>()

  images.forEach((image) => {
    const attachmentId = managedAttachmentIdFromImage(image)
    if (!attachmentId || references.has(attachmentId)) return

    references.set(attachmentId, {
      attachmentId,
      alt: image.getAttribute('alt')?.trim() || 'Attached image',
    })
  })

  return Array.from(references.values())
}

function renderPlainChildren(parent: ParentNode): string {
  return Array.from(parent.childNodes).map((child) => renderPlainNode(child, 0)).join('').trim()
}

function renderPlainNode(node: ChildNode, depth: number): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()

  if (tagName === 'br') return '\n'
  if (tagName === 'input') return checkboxMarker(element as HTMLInputElement)
  if (tagName === 'img') return renderPlainImage(element as HTMLImageElement)

  const children = renderPlainInline(element, depth)

  if (tagName === 'h2') return `\n\n## ${collapseWhitespace(children)}\n\n`
  if (tagName === 'h3') return `\n\n### ${collapseWhitespace(children)}\n\n`
  if (tagName === 'p') return `\n\n${trimBlankLines(children)}\n\n`
  if (tagName === 'b' || tagName === 'strong') return children ? `**${children}**` : ''
  if (tagName === 'em' || tagName === 'i') return children ? `*${children}*` : ''

  if (tagName === 'a') {
    const href = safeLinkHref(element as HTMLAnchorElement)
    const label = collapseWhitespace(children)
    if (!href) return label
    if (!label || label === href) return href
    return `[${label}](${href})`
  }

  if (tagName === 'ul') return `\n${renderPlainList(element, depth, false)}\n`
  if (tagName === 'ol') return `\n${renderPlainList(element, depth, true)}\n`
  if (tagName === 'li') return renderPlainListItem(element, depth, false, 1)

  return children
}

function renderPlainInline(parent: ParentNode, depth: number): string {
  return Array.from(parent.childNodes).map((child) => renderPlainNode(child, depth)).join('')
}

function renderPlainList(list: Element, depth: number, ordered: boolean): string {
  return Array.from(list.children)
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((item, index) => renderPlainListItem(item as HTMLElement, depth, ordered, index + 1))
    .filter(Boolean)
    .join('\n')
}

function renderPlainListItem(item: HTMLElement, depth: number, ordered: boolean, index: number): string {
  const marker = item.getAttribute('data-type') === 'taskItem' ? `- ${taskItemMarker(item)}` : ordered ? `${index}.` : '-'
  const bodyParts: string[] = []
  const nestedLists: string[] = []

  for (const child of Array.from(item.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childElement = child as HTMLElement
      const tagName = childElement.tagName.toLowerCase()
      if (tagName === 'input') continue
      if (tagName === 'ul' || tagName === 'ol') {
        nestedLists.push(renderPlainList(childElement, depth + 1, tagName === 'ol'))
        continue
      }
    }
    bodyParts.push(renderPlainNode(child, depth + 1))
  }

  const indent = '  '.repeat(depth)
  const body = collapseWhitespace(trimBlankLines(bodyParts.join('')))
  const line = `${indent}${marker}${body ? ` ${body}` : ''}`
  if (!nestedLists.length) return line
  return [line, ...nestedLists.map((nested) => nested.trimEnd())].join('\n')
}

function taskItemMarker(item: HTMLElement): string {
  const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]')
  const checked = item.getAttribute('data-checked') === 'true' || Boolean(checkbox?.checked || checkbox?.hasAttribute('checked'))
  return checked ? '[x]' : '[ ]'
}

function checkboxMarker(checkbox: HTMLInputElement): string {
  return checkbox.checked || checkbox.hasAttribute('checked') ? '[x]' : '[ ]'
}

function renderPlainImage(image: HTMLImageElement): string {
  const source = image.getAttribute('src')?.trim() ?? ''
  const alt = image.getAttribute('alt')?.trim() || 'Attached image'

  if (source.startsWith(managedAttachmentProtocol) || isDataImageSource(source) || !isSafeImageSource(source)) {
    return `Image: ${alt}`
  }

  return `![${alt}](${source})`
}

function safeLinkHref(link: HTMLAnchorElement): string | null {
  const href = link.getAttribute('href')?.trim() ?? ''
  return isSafeEditorLinkUrl(href) ? href : null
}

// Not a duplicate of editorHtml.ts's `isSafeEditorImageSource`: that function
// answers "is this URL acceptable to keep in the editor's sanitized HTML"
// (where managed-attachment and data: URIs are acceptable). This answers a
// different question for plain-text clipboard export — "is this a plain
// remote URL worth emitting as a markdown image link" — where
// managed-attachment and data: sources are deliberately excluded (they can't
// render outside the app / would bloat the exported text) and fall back to a
// text placeholder instead. Only the underlying http(s)-only primitive is
// shared, via `isSafeUrlWithProtocols`.
function isSafeImageSource(source: string): boolean {
  return isSafeUrlWithProtocols(source, new Set(['http:', 'https:']))
}

function isDataImageSource(source: string): boolean {
  return /^data:image\//i.test(source)
}

function trimBlankLines(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t\n\r]+/g, ' ').trim()
}
