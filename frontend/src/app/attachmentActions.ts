import type { ClipboardEvent } from 'react'
import { importClipboardScreenshot } from '../tauri'
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
import type { AppWorkflowContext } from './types'

export function createAttachmentActions(ctx: AppWorkflowContext) {
  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    const editor = target?.closest<HTMLElement>('.rich-editor')
    if (!editor || !editor.classList.contains('note-rich-editor')) return

    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'))
    if (!file) return

    const insertImage = richEditorImageInserterForElement(editor)
    if (!insertImage) return

    event.preventDefault()
    void importPastedImage(file, insertImage)
  }

  async function importPastedImage(file: File, insertImage: RichEditorImageInserter) {
    if (!ctx.activeSession || !ctx.noteEntry) {
      ctx.setError('Open a note before pasting images.')
      return
    }

    try {
      ctx.setBusyAction('attach-image')
      ctx.setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      const filename = pastedImageFilename(file)
      const attachment = await importClipboardScreenshot({
        sessionId: ctx.activeSession.id,
        entryId: ctx.noteEntry.id,
        filename,
        dataUrl,
      })
      insertImage(attachment.id, attachment.filename, dataUrl)
      ctx.setNotice('Image attached')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function uploadEditorImage({ file, insertImage }: RichEditorImageUpload, entryId: string | null) {
    if (!ctx.activeSession) {
      ctx.setError('Open a note before uploading images.')
      return
    }

    if (entryId && !ctx.noteEntry) {
      ctx.setError('Open an editable note before uploading note images.')
      return
    }

    try {
      ctx.setBusyAction('attach-image')
      ctx.setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      const filename = pastedImageFilename(file)
      const attachment = await importClipboardScreenshot({
        sessionId: ctx.activeSession.id,
        entryId,
        filename,
        dataUrl,
      })
      insertImage(attachment.id, attachment.filename, dataUrl)
      ctx.setNotice('Image attached')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function materializeInlineImages(document: RichEditorDocument): Promise<RichEditorDocument> {
    const html = richEditorDocumentToHtml(document)
    if (!ctx.activeSession || !ctx.noteEntry || !containsInlineImageData(html)) {
      return document
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
        sessionId: ctx.activeSession.id,
        entryId: ctx.noteEntry.id,
        filename,
        dataUrl,
      })
      image.setAttribute('data-attachment-id', attachment.id)
      image.setAttribute('src', `${managedAttachmentProtocol}${attachment.id}`)
      image.setAttribute('alt', image.getAttribute('alt') || attachment.filename)
      image.removeAttribute('srcset')
    }

    const body = richEditorDocumentFromHtml(documentFragment.body.innerHTML)
    ctx.setNoteBody(body)
    return body
  }

  return { handlePaste, materializeInlineImages, uploadEditorImage }
}
