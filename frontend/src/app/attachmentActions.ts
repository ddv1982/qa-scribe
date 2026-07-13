import type { ClipboardEvent } from 'react'
import { importClipboardScreenshot, readClipboardImageDataUrl } from '../tauri'
import {
  containsInlineImageData,
  inlineImageFilename,
  managedAttachmentProtocol,
  pastedImageFilename,
  readFileAsDataUrl,
} from '../editor/editorHtml'
import {
  richEditorDocumentFromHtml,
  richEditorDocumentToHtml,
  type RichEditorDocument,
} from '../editor/editorDocument'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import { richEditorImageInserterForElement, type RichEditorImageInserter } from '../editor/richEditorRegistry'
import { formatError } from '../ui/format'
import type { SessionWorkspace, WorkflowFeedback } from './types'
import { useStableCapability } from './useStableCapability'

const imageFilenamePattern = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif)$/i

export function imageFileFromClipboardData(clipboardData: DataTransfer): File | null {
  const files = Array.from(clipboardData.files)
  const file = files.find(fileLooksLikeImage)
  if (file) return file

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' && !clipboardItemLooksLikeImage(item)) continue
    const itemFile = item.getAsFile()
    if (itemFile && fileLooksLikeImage(itemFile)) return itemFile
  }

  return null
}

export function shouldReadNativeClipboardImage(clipboardData: DataTransfer): boolean {
  if (clipboardHasImageType(clipboardData)) return true
  if (clipboardHtmlLooksLikeImageOnly(clipboardData)) return true
  return !clipboardHasTextData(clipboardData) && clipboardHasNoDomPayload(clipboardData)
}

export type AttachmentActionsContext = {
  session: Pick<SessionWorkspace, 'activeSession' | 'noteEntry' | 'setNoteBody'>
  feedback: WorkflowFeedback
}

export function createAttachmentActions(ctx: AttachmentActionsContext) {
  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    const editor = target?.closest<HTMLElement>('.rich-editor')
    if (!editor || !editor.classList.contains('note-rich-editor')) return

    const insertImage = richEditorImageInserterForElement(editor)
    if (!insertImage) return

    const file = imageFileFromClipboardData(event.clipboardData)
    if (file) {
      event.preventDefault()
      void importPastedImage(file, insertImage)
      return
    }

    if (shouldReadNativeClipboardImage(event.clipboardData)) {
      event.preventDefault()
      void importNativeClipboardImage(insertImage)
    }
  }

  async function importPastedImage(file: File, insertImage: RichEditorImageInserter) {
    if (!ctx.session.activeSession || !ctx.session.noteEntry) {
      ctx.feedback.setError('Open a Session before pasting images.')
      return
    }

    try {
      ctx.feedback.setBusyAction('attach-image')
      ctx.feedback.setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      const filename = pastedImageFilename(file)
      const attachment = await importClipboardScreenshot({
        sessionId: ctx.session.activeSession.id,
        entryId: ctx.session.noteEntry.id,
        filename,
        dataUrl,
      })
      insertImage(attachment.id, attachment.filename, dataUrl)
      ctx.feedback.setNotice('Image attached')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function importNativeClipboardImage(insertImage: RichEditorImageInserter) {
    if (!ctx.session.activeSession || !ctx.session.noteEntry) {
      ctx.feedback.setError('Open a Session before pasting images.')
      return
    }

    try {
      ctx.feedback.setBusyAction('attach-image')
      ctx.feedback.setError(null)
      const dataUrl = await readClipboardImageDataUrl()
      if (!dataUrl) {
        ctx.feedback.setError('Clipboard image could not be read.')
        return
      }
      const attachment = await importClipboardScreenshot({
        sessionId: ctx.session.activeSession.id,
        entryId: ctx.session.noteEntry.id,
        filename: `pasted-image-${Date.now()}.png`,
        dataUrl,
      })
      insertImage(attachment.id, attachment.filename, dataUrl)
      ctx.feedback.setNotice('Image attached')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function uploadEditorImage({ file, insertImage }: RichEditorImageUpload, entryId: string | null) {
    if (!ctx.session.activeSession) {
      ctx.feedback.setError('Open a Session before uploading images.')
      return
    }

    if (entryId && !ctx.session.noteEntry) {
      ctx.feedback.setError('Open a Session with an editable Note Entry before uploading images.')
      return
    }

    try {
      ctx.feedback.setBusyAction('attach-image')
      ctx.feedback.setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      const filename = pastedImageFilename(file)
      const attachment = await importClipboardScreenshot({
        sessionId: ctx.session.activeSession.id,
        entryId,
        filename,
        dataUrl,
      })
      insertImage(attachment.id, attachment.filename, dataUrl)
      ctx.feedback.setNotice('Image attached')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function materializeInlineImages(
    document: RichEditorDocument,
    options: { entryId?: string | null; updateNoteBody?: boolean } = {},
  ): Promise<RichEditorDocument> {
    const html = richEditorDocumentToHtml(document)
    if (!containsInlineImageData(html)) {
      return document
    }

    if (!ctx.session.activeSession) {
      throw new Error('Open a Session before storing embedded images.')
    }

    const entryId = Object.prototype.hasOwnProperty.call(options, 'entryId') ? options.entryId : ctx.session.noteEntry?.id
    if (entryId === undefined) {
      throw new Error('Open a Session with an editable Note Entry before storing embedded images.')
    }

    const documentFragment = new DOMParser().parseFromString(html, 'text/html')
    const images = Array.from(documentFragment.body.querySelectorAll<HTMLImageElement>('img')).filter((image) =>
      (image.getAttribute('src') ?? '').startsWith('data:image/'),
    )

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      const dataUrl = image.getAttribute('src')
      if (!dataUrl) continue

      const filename = inlineImageFilename(image, index, dataUrl)
      const attachment = await importClipboardScreenshot({
        sessionId: ctx.session.activeSession.id,
        entryId,
        filename,
        dataUrl,
      })
      image.setAttribute('data-attachment-id', attachment.id)
      image.setAttribute('src', `${managedAttachmentProtocol}${attachment.id}`)
      image.setAttribute('alt', image.getAttribute('alt') || attachment.filename)
      image.removeAttribute('srcset')
    }

    const body = richEditorDocumentFromHtml(documentFragment.body.innerHTML)
    if (options.updateNoteBody) ctx.session.setNoteBody(body)
    return body
  }

  return { handlePaste, materializeInlineImages, uploadEditorImage }
}

export function useAttachmentActions(ctx: AttachmentActionsContext) {
  return useStableCapability(ctx, createAttachmentActions)
}

function fileLooksLikeImage(file: File): boolean {
  return file.type.startsWith('image/') || (!file.type && imageFilenamePattern.test(file.name))
}

function clipboardItemLooksLikeImage(item: DataTransferItem): boolean {
  return item.type.startsWith('image/') || (item.kind === 'file' && clipboardTypeLooksLikeImage(item.type))
}

function clipboardHasImageType(clipboardData: DataTransfer): boolean {
  return Array.from(clipboardData.items).some(clipboardItemLooksLikeImage) || Array.from(clipboardData.types).some(clipboardTypeLooksLikeImage)
}

function clipboardTypeLooksLikeImage(type: string): boolean {
  const normalized = type.trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.startsWith('image/') ||
    normalized.includes('png') ||
    normalized.includes('jpeg') ||
    normalized.includes('jpg') ||
    normalized.includes('gif') ||
    normalized.includes('webp') ||
    normalized.includes('tiff') ||
    normalized.includes('bitmap') ||
    normalized.includes('pict')
  )
}

function clipboardHtmlLooksLikeImageOnly(clipboardData: DataTransfer): boolean {
  const html = clipboardDataText(clipboardData, 'text/html').trim()
  if (!/<img\b/i.test(html) || typeof DOMParser === 'undefined') return false

  const documentFragment = new DOMParser().parseFromString(html, 'text/html')
  if (documentFragment.body.querySelectorAll('img').length !== 1) return false

  const text = documentFragment.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return text.length === 0
}

function clipboardHasTextData(clipboardData: DataTransfer): boolean {
  return Boolean(clipboardDataText(clipboardData, 'text/plain').trim() || clipboardDataText(clipboardData, 'text/html').trim())
}

function clipboardHasNoDomPayload(clipboardData: DataTransfer): boolean {
  return clipboardData.files.length === 0 && clipboardData.items.length === 0 && clipboardData.types.length === 0
}

function clipboardDataText(clipboardData: DataTransfer, type: string): string {
  try {
    return clipboardData.getData(type)
  } catch {
    return ''
  }
}
