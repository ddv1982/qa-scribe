import { getAttachmentPreviewDataUrl } from '../tauri'

export const emptyNoteHtml = '<p><br></p>'
export const managedAttachmentProtocol = 'qa-scribe-attachment://'
const allowedEditorTags = new Set(['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'])
const removedEditorTags = new Set(['embed', 'form', 'iframe', 'math', 'meta', 'object', 'script', 'style', 'svg', 'template'])
const editorTagPattern = 'a|b|br|em|h2|h3|i|img|input|li|ol|p|strong|ul'
const escapedEditorOpeningTagPattern = new RegExp(`&lt;(?:${editorTagPattern})(?:\\s|/|&gt;)`, 'i')
const escapedEditorClosingTagPattern = new RegExp(`&lt;/(?:a|b|em|h2|h3|i|li|ol|p|strong|ul)&gt;`, 'i')
const escapedSelfClosingEditorTagPattern = /&lt;(?:br|img|input)(?:\s|\/|&gt;)/i
const literalEditorTagPattern = new RegExp(`</?(?:${editorTagPattern})(?:\\s|/|>)`, 'i')

export function containsInlineImageData(value: string): boolean {
  return /<img\b[^>]*\bsrc=["']data:image\//i.test(value)
}

export async function hydrateManagedAttachmentPreviews(editor: HTMLElement, shouldApply: () => boolean) {
  const images = Array.from(editor.querySelectorAll<HTMLImageElement>('img[data-attachment-id], img[src^="qa-scribe-attachment://"]'))
  await Promise.all(
    images.map(async (image) => {
      const attachmentId = managedAttachmentIdFromImage(image)
      if (!attachmentId) return

      image.setAttribute('data-attachment-id', attachmentId)
      try {
        const preview = await getAttachmentPreviewDataUrl(attachmentId)
        if (preview && shouldApply() && image.isConnected) {
          image.src = preview
        }
      } catch {
        if (shouldApply() && image.isConnected) {
          image.alt = image.alt || 'Attached image'
        }
      }
    }),
  )
}

export function inlineImageFilename(image: HTMLImageElement, index: number, dataUrl: string): string {
  const extension = dataUrlImageExtension(dataUrl)
  const alt = image.getAttribute('alt')?.trim() ?? ''
  const cleaned = alt
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  if (!cleaned) return `inline-image-${index + 1}.${extension}`
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.${extension}`
}

export function insertEditorHtml(html: string) {
  document.execCommand('insertHTML', false, html)
}

export function managedAttachmentImageHtml(attachmentId: string, filename: string, previewSrc = `${managedAttachmentProtocol}${attachmentId}`): string {
  return `<img src="${escapeAttribute(previewSrc)}" data-attachment-id="${escapeAttribute(attachmentId)}" alt="${escapeAttribute(filename)}" />`
}

export function normalizeEditorHtml(value: string): string {
  const trimmed = repairEscapedEditorHtml(value.trim())
  if (!trimmed || trimmed === '<br>') return emptyNoteHtml
  const html = trimmed.startsWith('<') ? trimmed : `<p>${escapeHtml(trimmed).replace(/\n/g, '<br />')}</p>`
  return sanitizeNoteHtml(html) || emptyNoteHtml
}

export function pastedImageFilename(file: File): string {
  if (file.name.trim()) return file.name
  const extension = file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
  return `pasted-image-${Date.now()}.${extension}`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image could not be read')))
    reader.readAsDataURL(file)
  })
}

export function restoreSelection(range: Range | null) {
  if (!range) return
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

export function selectedRangeWithin(element: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return null
  return range.cloneRange()
}

export function serializeEditorHtml(editor: HTMLElement): string {
  return sanitizeNoteHtml(editor.innerHTML)
}

export function stripHtml(value: string): string {
  const documentFragment = new DOMParser().parseFromString(value, 'text/html')
  return documentFragment.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function dataUrlImageExtension(dataUrl: string): string {
  const match = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl)
  const subtype = match?.[1]?.toLowerCase()
  if (subtype === 'jpeg') return 'jpg'
  if (subtype && /^[a-z0-9]+$/.test(subtype)) return subtype
  return 'png'
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

function repairEscapedEditorHtml(value: string): string {
  if (!shouldDecodeEscapedEditorHtml(value)) return value
  return decodeHtmlEntities(value).trim()
}

function shouldDecodeEscapedEditorHtml(value: string): boolean {
  if (!escapedEditorOpeningTagPattern.test(value)) return false
  return escapedEditorClosingTagPattern.test(value) || literalEditorTagPattern.test(value) || escapedSelfClosingEditorTagPattern.test(value)
}

function decodeHtmlEntities(value: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

function managedAttachmentIdFromImage(image: HTMLImageElement): string | null {
  return image.getAttribute('data-attachment-id') || managedAttachmentIdFromSrc(image.getAttribute('src') ?? '')
}

function managedAttachmentIdFromSrc(source: string): string | null {
  if (!source.startsWith(managedAttachmentProtocol)) return null
  return source.slice(managedAttachmentProtocol.length)
}

function sanitizeNoteHtml(value: string): string {
  const documentFragment = new DOMParser().parseFromString(value, 'text/html')
  sanitizeEditorChildren(documentFragment.body)
  return documentFragment.body.innerHTML.trim()
}

function sanitizeEditorChildren(parent: Element) {
  Array.from(parent.childNodes).forEach((node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove()
      return
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      sanitizeEditorElement(node as HTMLElement)
    }
  })
}

function sanitizeEditorElement(element: HTMLElement) {
  const tagName = element.tagName.toLowerCase()
  if (removedEditorTags.has(tagName)) {
    element.remove()
    return
  }

  if (!allowedEditorTags.has(tagName)) {
    sanitizeEditorChildren(element)
    unwrapElement(element)
    return
  }

  sanitizeEditorChildren(element)

  if (tagName === 'a') {
    sanitizeLinkElement(element as HTMLAnchorElement)
    return
  }

  if (tagName === 'img') {
    sanitizeImageElement(element as HTMLImageElement)
    return
  }

  if (tagName === 'input') {
    sanitizeInputElement(element as HTMLInputElement)
    return
  }

  removeAllAttributes(element)
}

function removeAllAttributes(element: Element) {
  Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name))
}

function sanitizeLinkElement(link: HTMLAnchorElement) {
  const href = link.getAttribute('href')?.trim() ?? ''
  removeAllAttributes(link)
  if (!isSafeEditorLinkUrl(href)) return
  link.setAttribute('href', href)
  link.setAttribute('target', '_blank')
  link.setAttribute('rel', 'noreferrer')
}

function sanitizeImageElement(image: HTMLImageElement) {
  const attachmentId = managedAttachmentIdFromImage(image)
  const source = image.getAttribute('src')?.trim() ?? ''
  const alt = image.getAttribute('alt')?.trim() ?? ''
  removeAllAttributes(image)

  if (attachmentId) {
    image.setAttribute('data-attachment-id', attachmentId)
    image.setAttribute('src', `${managedAttachmentProtocol}${attachmentId}`)
    if (alt) image.setAttribute('alt', alt)
    return
  }

  if (!isSafeEditorImageSource(source)) {
    image.remove()
    return
  }

  image.setAttribute('src', source)
  if (alt) image.setAttribute('alt', alt)
}

function sanitizeInputElement(input: HTMLInputElement) {
  const type = input.getAttribute('type')?.trim().toLowerCase() ?? ''
  const checked = input.hasAttribute('checked')
  removeAllAttributes(input)
  if (type !== 'checkbox') {
    input.remove()
    return
  }

  input.setAttribute('type', 'checkbox')
  if (checked) input.setAttribute('checked', '')
}

function unwrapElement(element: Element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  element.remove()
}

export function isSafeEditorImageSource(source: string): boolean {
  if (source.startsWith(managedAttachmentProtocol)) return true
  if (/^data:image\//i.test(source)) return true
  return isSafeUrlWithProtocols(source, new Set(['http:', 'https:']))
}

export function isSafeEditorLinkUrl(source: string): boolean {
  return isSafeUrlWithProtocols(source, new Set(['http:', 'https:', 'mailto:']))
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
