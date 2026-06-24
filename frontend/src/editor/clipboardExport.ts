import { getAttachmentPreviewDataUrl } from '../tauri'
import { managedAttachmentProtocol, normalizeEditorHtml } from './editorHtml'

export type ClipboardRecord = {
  title: string
  bodyHtml: string
}

export type ClipboardPayload = {
  html: string
  plain: string
}

export type JiraClipboardPayload = ClipboardPayload & {
  includesInlineImages: boolean
}

type HtmlRenderOptions = {
  inlineDataImages?: boolean
}

export function formatRecordForClipboard(record: ClipboardRecord): ClipboardPayload {
  return renderClipboardPayload(record.title, createNormalizedBody(record.bodyHtml), {})
}

export async function formatRecordForJiraClipboard(record: ClipboardRecord): Promise<JiraClipboardPayload> {
  const body = createNormalizedBody(record.bodyHtml)
  await resolveManagedImagesForJira(body)
  return {
    ...renderClipboardPayload(record.title, body, { inlineDataImages: true }),
    includesInlineImages: containsInlineDataImage(body),
  }
}

function createNormalizedBody(bodyHtml: string): HTMLDivElement {
  const body = document.createElement('div')
  body.innerHTML = normalizeEditorHtml(bodyHtml)
  return body
}

function renderClipboardPayload(titleInput: string, body: ParentNode, options: HtmlRenderOptions): ClipboardPayload {
  const title = titleInput.trim()

  const htmlParts = [title ? `<h2>${escapeHtml(title)}</h2>` : '', renderHtmlChildren(body, options)]
    .map((part) => part.trim())
    .filter(Boolean)
  const plainParts = [title ? `## ${title}` : '', renderPlainChildren(body)]
    .map((part) => trimBlankLines(part))
    .filter(Boolean)

  return {
    html: htmlParts.join('\n'),
    plain: trimBlankLines(plainParts.join('\n\n')),
  }
}

export async function copyRecordForJira(record: ClipboardRecord): Promise<void> {
  const payload = await formatRecordForJiraClipboard(record)
  if (payload.includesInlineImages) {
    await writeRichClipboard(payload)
    return
  }

  await writePlainClipboard(payload.plain)
}

export async function writeRichClipboard(payload: ClipboardPayload): Promise<void> {
  const clipboard = navigator.clipboard
  if (!clipboard) throw new Error('Clipboard is not available')

  if (typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([payload.html], { type: 'text/html' }),
          'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
        }),
      ])
      return
    } catch (cause) {
      if (typeof clipboard.writeText !== 'function') throw cause
    }
  }

  if (typeof clipboard.writeText !== 'function') throw new Error('Clipboard text writing is not available')
  await clipboard.writeText(payload.plain)
}

export async function writePlainClipboard(value: string): Promise<void> {
  const clipboard = navigator.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('Clipboard text writing is not available')
  await clipboard.writeText(value)
}

async function resolveManagedImagesForJira(parent: ParentNode): Promise<void> {
  const images = Array.from(
    parent.querySelectorAll<HTMLImageElement>('img[data-attachment-id], img[src^="qa-scribe-attachment://"]'),
  )

  await Promise.all(
    images.map(async (image) => {
      const attachmentId = managedAttachmentIdFromImage(image)
      if (!attachmentId) return

      try {
        const preview = await getAttachmentPreviewDataUrl(attachmentId)
        if (preview && isDataImageSource(preview)) {
          image.setAttribute('src', preview)
        }
      } catch {
        // The plain-text fallback still names the image if preview lookup fails.
      }
    }),
  )
}

function containsInlineDataImage(parent: ParentNode): boolean {
  return Array.from(parent.querySelectorAll<HTMLImageElement>('img')).some((image) =>
    isDataImageSource(image.getAttribute('src')?.trim() ?? ''),
  )
}

function managedAttachmentIdFromImage(image: HTMLImageElement): string | null {
  return image.getAttribute('data-attachment-id') || managedAttachmentIdFromSrc(image.getAttribute('src') ?? '')
}

function managedAttachmentIdFromSrc(source: string): string | null {
  if (!source.startsWith(managedAttachmentProtocol)) return null
  return source.slice(managedAttachmentProtocol.length)
}

function renderHtmlChildren(parent: ParentNode, options: HtmlRenderOptions): string {
  return Array.from(parent.childNodes).map((node) => renderHtmlNode(node, options)).join('').trim()
}

function renderHtmlNode(node: ChildNode, options: HtmlRenderOptions): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()

  if (tagName === 'br') return '<br />'
  if (tagName === 'input') return checkboxMarker(element as HTMLInputElement)
  if (tagName === 'img') return renderHtmlImage(element as HTMLImageElement, options)

  const children = renderHtmlChildren(element, options)
  if (!children && tagName !== 'p') return ''

  if (tagName === 'a') {
    const href = safeLinkHref(element as HTMLAnchorElement)
    return href ? `<a href="${escapeAttribute(href)}">${children}</a>` : children
  }

  if (tagName === 'b' || tagName === 'strong') return `<strong>${children}</strong>`
  if (tagName === 'em' || tagName === 'i') return `<em>${children}</em>`
  if (tagName === 'h2' || tagName === 'h3' || tagName === 'ol' || tagName === 'p') return `<${tagName}>${children}</${tagName}>`

  if (tagName === 'ul') {
    return `<ul>${Array.from(element.children).map((child) => renderHtmlListItem(child as HTMLElement, options)).join('')}</ul>`
  }

  if (tagName === 'li') return renderHtmlListItem(element, options)
  return children
}

function renderHtmlListItem(item: HTMLElement, options: HtmlRenderOptions): string {
  const taskMarker = item.getAttribute('data-type') === 'taskItem' ? `${taskItemMarker(item)} ` : ''
  const children = Array.from(item.childNodes)
    .filter((child) => !(child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === 'input'))
    .map((node) => renderHtmlNode(node, options))
    .join('')
    .trim()

  return `<li>${taskMarker}${children}</li>`
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

function renderHtmlImage(image: HTMLImageElement, options: HtmlRenderOptions): string {
  const source = image.getAttribute('src')?.trim() ?? ''
  const alt = image.getAttribute('alt')?.trim() || 'Attached image'

  if (isDataImageSource(source)) {
    if (options.inlineDataImages) return `<img src="${escapeAttribute(source)}" alt="${escapeAttribute(alt)}" />`
    return `Image: ${escapeHtml(alt)}`
  }

  if (source.startsWith(managedAttachmentProtocol)) {
    return `Image: ${escapeHtml(alt)}`
  }

  return isSafeImageSource(source) ? `<img src="${escapeAttribute(source)}" alt="${escapeAttribute(alt)}" />` : `Image: ${escapeHtml(alt)}`
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
  return isSafeUrlWithProtocols(href, new Set(['http:', 'https:', 'mailto:'])) ? href : null
}

function isSafeImageSource(source: string): boolean {
  return isSafeUrlWithProtocols(source, new Set(['http:', 'https:']))
}

function isDataImageSource(source: string): boolean {
  return /^data:image\//i.test(source)
}

function isSafeUrlWithProtocols(source: string, protocols: Set<string>): boolean {
  if (!source) return false
  try {
    const base = window.location.href || 'https://qa-scribe.local/'
    return protocols.has(new URL(source, base).protocol)
  } catch {
    return false
  }
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

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
