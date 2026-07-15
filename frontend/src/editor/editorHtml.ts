import DOMPurify, { type Config } from 'dompurify'
import { EDITOR_HTML_TAGS, SELF_CLOSING_EDITOR_HTML_TAGS, getAttachmentPreviewDataUrl } from '../tauri'
import { escapeAttribute, escapeHtml, isSafeUrlWithProtocols, managedAttachmentIdFromImage, managedAttachmentProtocol } from './htmlUtils'

export { managedAttachmentProtocol } from './htmlUtils'

export const emptyEditorHtml = ''
// Single-sourced from Rust (`core::generation::html`/`response`): the
// managed-attachment protocol, the allowed editor tag list, and its
// void/self-closing subset are all exported as bindings constants so the
// sanitizer here and the response-repair pass in core can never silently
// diverge.
const selfClosingEditorTags = new Set<string>(SELF_CLOSING_EDITOR_HTML_TAGS)
const nonSelfClosingEditorTags = EDITOR_HTML_TAGS.filter((tag) => !selfClosingEditorTags.has(tag))
const editorTagPattern = EDITOR_HTML_TAGS.join('|')
const escapedEditorOpeningTagPattern = new RegExp(`&lt;(?:${editorTagPattern})(?:\\s|/|&gt;)`, 'i')
const escapedEditorClosingTagPattern = new RegExp(`&lt;/(?:${nonSelfClosingEditorTags.join('|')})&gt;`, 'i')
const escapedSelfClosingEditorTagPattern = new RegExp(`&lt;(?:${SELF_CLOSING_EDITOR_HTML_TAGS.join('|')})(?:\\s|/|&gt;)`, 'i')
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

export function managedAttachmentImageHtml(attachmentId: string, filename: string, previewSrc = `${managedAttachmentProtocol}${attachmentId}`): string {
  return `<img src="${escapeAttribute(previewSrc)}" data-attachment-id="${escapeAttribute(attachmentId)}" alt="${escapeAttribute(filename)}" />`
}

export function normalizeEditorHtml(value: string): string {
  const trimmed = repairEscapedEditorHtml(value.trim())
  if (!trimmed || trimmed === '<br>') return emptyEditorHtml
  const html = trimmed.startsWith('<') || literalEditorTagPattern.test(trimmed) ? trimmed : `<p>${escapeHtml(trimmed).replace(/\n/g, '<br />')}</p>`
  const sanitized = sanitizeNoteHtml(html)
  return isVisuallyEmptyEditorHtml(sanitized) ? emptyEditorHtml : sanitized
}

export function pastedImageFilename(file: File): string {
  if (file.name.trim()) return file.name
  const extension = file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
  return `pasted-image-${Date.now()}.${extension}`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      // `readAsDataURL` always yields a string; guard the union so we never
      // stringify an ArrayBuffer into "[object ArrayBuffer]".
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Image could not be read'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image could not be read')))
    reader.readAsDataURL(file)
  })
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

// DOMPurify owns dangerous-markup removal (mXSS, namespace confusion, event
// handlers, comments, DOM clobbering). The post-pass below only enforces app
// semantics: per-tag attribute allowlists, URL policy, managed-attachment
// canonicalization, and task-list normalization.
const editorPurifyConfig = {
  ALLOWED_TAGS: [...EDITOR_HTML_TAGS],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'data-attachment-id', 'type', 'checked', 'data-type', 'data-checked'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  // DOMPurify's default URI policy rejects the qa-scribe-attachment: scheme;
  // extend it. Per-context tightening (http/https/mailto only for links, and
  // so on) still happens in the post-pass helpers.
  ALLOWED_URI_REGEXP: managedProtocolAwareUriRegexp(),
  // These drop their CONTENT too; all other disallowed tags unwrap via
  // DOMPurify's default KEEP_CONTENT behavior.
  FORBID_CONTENTS: ['embed', 'form', 'iframe', 'math', 'meta', 'object', 'script', 'style', 'svg', 'template'],
  RETURN_DOM: true,
} satisfies Config & { RETURN_DOM: true }

function managedProtocolAwareUriRegexp(): RegExp {
  const scheme = managedAttachmentProtocol.replace(/:\/\/$/, '')
  return new RegExp(`^(?:(?:(?:f|ht)tps?|mailto|${scheme}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i')
}

function sanitizeNoteHtml(value: string): string {
  // With RETURN_DOM the runtime value is always the sanitized <body> element,
  // but the type declarations only promise Node.
  const body = DOMPurify.sanitize(value, editorPurifyConfig) as HTMLElement
  applyEditorAttributePolicy(body)
  return body.innerHTML.trim()
}

function applyEditorAttributePolicy(root: HTMLElement) {
  // Inputs before list items: taskItem normalization reads checkbox state.
  root.querySelectorAll('input').forEach((input) => sanitizeInputElement(input))
  root.querySelectorAll('a').forEach((link) => sanitizeLinkElement(link))
  root.querySelectorAll('img').forEach((image) => sanitizeImageElement(image))
  root.querySelectorAll('ul').forEach((list) => sanitizeUnorderedListElement(list))
  root.querySelectorAll('li').forEach((item) => sanitizeListItemElement(item))
  root.querySelectorAll('b, br, em, h2, h3, i, ol, p, strong').forEach(removeAllAttributes)
}

function isVisuallyEmptyEditorHtml(value: string): boolean {
  if (!value.trim()) return true
  const documentFragment = new DOMParser().parseFromString(value, 'text/html')
  if (documentFragment.body.querySelector('img, input')) return false
  return !(documentFragment.body.textContent ?? '').replace(/\u00a0/g, ' ').trim()
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
  const checked = input.checked || input.hasAttribute('checked')
  removeAllAttributes(input)
  if (type !== 'checkbox') {
    input.remove()
    return
  }

  input.setAttribute('type', 'checkbox')
  if (checked) input.setAttribute('checked', '')
}

function sanitizeUnorderedListElement(list: HTMLUListElement) {
  const dataType = list.getAttribute('data-type')?.trim()
  removeAllAttributes(list)
  if (dataType === 'taskList') {
    list.setAttribute('data-type', 'taskList')
  }
}

function sanitizeListItemElement(item: HTMLLIElement) {
  const dataType = item.getAttribute('data-type')?.trim()
  const dataChecked = item.getAttribute('data-checked')?.trim().toLowerCase()
  const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]')
  removeAllAttributes(item)
  if (dataType !== 'taskItem') return

  item.setAttribute('data-type', 'taskItem')
  item.setAttribute('data-checked', dataChecked === 'true' || checkbox?.checked || checkbox?.hasAttribute('checked') ? 'true' : 'false')
}

export function isSafeEditorImageSource(source: string): boolean {
  if (source.startsWith(managedAttachmentProtocol)) return true
  if (/^data:image\//i.test(source)) return true
  return isSafeUrlWithProtocols(source, new Set(['http:', 'https:']))
}

export function isSafeEditorLinkUrl(source: string): boolean {
  return isSafeUrlWithProtocols(source, new Set(['http:', 'https:', 'mailto:']))
}
