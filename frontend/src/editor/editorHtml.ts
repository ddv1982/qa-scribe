import { getAttachmentPreviewDataUrl } from '../tauri'

export const emptyNoteHtml = '<p><br></p>'
export const managedAttachmentProtocol = 'qa-scribe-attachment://'

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
  const trimmed = value.trim()
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

function managedAttachmentIdFromImage(image: HTMLImageElement): string | null {
  return image.getAttribute('data-attachment-id') || managedAttachmentIdFromSrc(image.getAttribute('src') ?? '')
}

function managedAttachmentIdFromSrc(source: string): string | null {
  if (!source.startsWith(managedAttachmentProtocol)) return null
  return source.slice(managedAttachmentProtocol.length)
}

function sanitizeNoteHtml(value: string): string {
  const documentFragment = new DOMParser().parseFromString(value, 'text/html')
  documentFragment.body.querySelectorAll('img').forEach((image) => {
    const attachmentId = managedAttachmentIdFromImage(image)
    if (attachmentId) {
      image.setAttribute('data-attachment-id', attachmentId)
      image.setAttribute('src', `${managedAttachmentProtocol}${attachmentId}`)
      image.removeAttribute('srcset')
      return
    }

    const source = image.getAttribute('src') ?? ''
    if (source.startsWith('data:') && !source.startsWith('data:image/')) {
      image.removeAttribute('src')
      image.removeAttribute('srcset')
      image.setAttribute('alt', image.getAttribute('alt') || 'Embedded image omitted')
    } else if (source.startsWith('data:')) {
      image.removeAttribute('srcset')
    }
  })
  return documentFragment.body.innerHTML.trim()
}
