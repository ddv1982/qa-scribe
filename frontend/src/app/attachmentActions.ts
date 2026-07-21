import type { ClipboardEvent } from 'react'
import { deleteAttachment, importClipboardScreenshot, readClipboardImageDataUrl } from '../tauri'
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
import { richEditorImageInserterForElement, richEditorImageInserterForId, type RichEditorImageInserter } from '../editor/richEditorRegistry'
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
  session: Pick<SessionWorkspace, 'activeSession' | 'noteEntry'>
  feedback: WorkflowFeedback
  registerImportedAttachment: (owner: AttachmentUploadOwner, attachmentId: string) => void
}

export type AttachmentUploadOwner = { kind: 'note' | 'draft' | 'finding'; id: string }

export type InlineImageMaterialization = {
  document: RichEditorDocument
  importedAttachmentIds: string[]
}

export function createAttachmentActions(ctx: AttachmentActionsContext) {
  const pendingMutations = new Set<Promise<unknown>>()
  const pendingCleanupIds = new Set<string>()
  let activeAttachmentActions = 0

  function trackMutation<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => pendingMutations.delete(tracked))
    pendingMutations.add(tracked)
    return tracked
  }

  function runAttachmentAction(action: () => Promise<void>): Promise<void> {
    activeAttachmentActions += 1
    ctx.feedback.setBusyAction('attach-image')
    const operation = action().finally(() => {
      activeAttachmentActions -= 1
      if (activeAttachmentActions === 0) {
        ctx.feedback.setBusyAction((current) => current === 'attach-image' ? null : current)
      }
    })
    return trackMutation(operation)
  }

  async function waitForPendingAttachmentMutations(): Promise<void> {
    while (pendingMutations.size > 0) {
      await Promise.allSettled(Array.from(pendingMutations))
    }
  }

  async function cleanupMaterializedAttachments(attachmentIds: string[]): Promise<boolean> {
    for (const id of attachmentIds) pendingCleanupIds.add(id)
    let cleaned = true
    for (const id of Array.from(pendingCleanupIds)) {
      try {
        const deleted = await trackMutation(deleteAttachment(id))
        if (deleted) {
          pendingCleanupIds.delete(id)
        } else {
          cleaned = false
          ctx.feedback.setError('An imported image is still referenced. Save the latest content before closing.')
        }
      } catch (cause) {
        cleaned = false
        ctx.feedback.setError(`Could not discard an imported image. ${formatError(cause)}`)
      }
    }
    return cleaned
  }

  function hasPendingAttachmentMutations(): boolean {
    return pendingMutations.size > 0 || pendingCleanupIds.size > 0
  }

  function hasPendingAttachmentOperations(): boolean {
    return pendingMutations.size > 0
  }

  function retryPendingAttachmentCleanup(): Promise<boolean> {
    return cleanupMaterializedAttachments([])
  }

  async function discardImportedAttachment(attachmentId: string): Promise<void> {
    if (!await cleanupMaterializedAttachments([attachmentId])) {
      throw new Error('The stale imported image could not be discarded.')
    }
  }

  function notePasteIsCurrent(
    sessionId: string,
    entryId: string,
    editor: HTMLElement,
    insertImage: RichEditorImageInserter,
  ): boolean {
    return ctx.session.activeSession?.id === sessionId
      && ctx.session.noteEntry?.id === entryId
      && richEditorImageInserterForElement(editor) === insertImage
  }
  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    const editor = target?.closest<HTMLElement>('.rich-editor')
    if (!editor || !editor.classList.contains('note-rich-editor')) return

    const insertImage = richEditorImageInserterForElement(editor)
    if (!insertImage) return

    const file = imageFileFromClipboardData(event.clipboardData)
    if (file) {
      event.preventDefault()
      void runAttachmentAction(() => importPastedImage(file, insertImage, editor))
      return
    }

    if (shouldReadNativeClipboardImage(event.clipboardData)) {
      event.preventDefault()
      void runAttachmentAction(() => importNativeClipboardImage(insertImage, editor))
    }
  }

  async function importPastedImage(file: File, insertImage: RichEditorImageInserter, editor: HTMLElement) {
    if (!ctx.session.activeSession || !ctx.session.noteEntry) {
      ctx.feedback.setError('Open a Session before pasting images.')
      return
    }

    const sessionId = ctx.session.activeSession.id
    const entryId = ctx.session.noteEntry.id
    try {
      ctx.feedback.setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      if (!notePasteIsCurrent(sessionId, entryId, editor, insertImage)) return
      const filename = pastedImageFilename(file)
      const attachment = await trackMutation(importClipboardScreenshot({
        sessionId,
        entryId,
        filename,
        dataUrl,
      }))
      if (!notePasteIsCurrent(sessionId, entryId, editor, insertImage)) {
        await discardImportedAttachment(attachment.id)
        return
      }
      try {
        if (!insertImage(attachment.id, attachment.filename, dataUrl)) {
          await discardImportedAttachment(attachment.id)
          return
        }
        ctx.registerImportedAttachment({ kind: 'note', id: entryId }, attachment.id)
      } catch (cause) {
        await discardImportedAttachment(attachment.id)
        throw cause
      }
      ctx.feedback.setNotice('Image attached')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    }
  }

  async function importNativeClipboardImage(insertImage: RichEditorImageInserter, editor: HTMLElement) {
    if (!ctx.session.activeSession || !ctx.session.noteEntry) {
      ctx.feedback.setError('Open a Session before pasting images.')
      return
    }

    const sessionId = ctx.session.activeSession.id
    const entryId = ctx.session.noteEntry.id
    try {
      ctx.feedback.setError(null)
      const dataUrl = await readClipboardImageDataUrl()
      if (!dataUrl) {
        ctx.feedback.setError('Clipboard image could not be read.')
        return
      }
      if (!notePasteIsCurrent(sessionId, entryId, editor, insertImage)) return
      const attachment = await trackMutation(importClipboardScreenshot({
        sessionId,
        entryId,
        filename: `pasted-image-${Date.now()}.png`,
        dataUrl,
      }))
      if (!notePasteIsCurrent(sessionId, entryId, editor, insertImage)) {
        await discardImportedAttachment(attachment.id)
        return
      }
      try {
        if (!insertImage(attachment.id, attachment.filename, dataUrl)) {
          await discardImportedAttachment(attachment.id)
          return
        }
        ctx.registerImportedAttachment({ kind: 'note', id: entryId }, attachment.id)
      } catch (cause) {
        await discardImportedAttachment(attachment.id)
        throw cause
      }
      ctx.feedback.setNotice('Image attached')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    }
  }

  function uploadEditorImage(input: RichEditorImageUpload, owner: AttachmentUploadOwner): Promise<void> {
    return runAttachmentAction(() => uploadEditorImageNow(input, owner))
  }

  async function uploadEditorImageNow({ editorId, file, insertImage }: RichEditorImageUpload, owner: AttachmentUploadOwner) {
    if (!ctx.session.activeSession) {
      ctx.feedback.setError('Open a Session before uploading images.')
      return
    }

    if (owner.kind === 'note' && !ctx.session.noteEntry) {
      ctx.feedback.setError('Open a Session with an editable Note Entry before uploading images.')
      return
    }

    const sessionId = ctx.session.activeSession.id
    const expectedEntryId = owner.kind === 'note' ? owner.id : null
    const isCurrent = () => (
      ctx.session.activeSession?.id === sessionId
      && (expectedEntryId === null || ctx.session.noteEntry?.id === expectedEntryId)
      && richEditorImageInserterForId(editorId) === insertImage
    )
    try {
      ctx.feedback.setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      if (!isCurrent()) return
      const filename = pastedImageFilename(file)
      const attachment = await trackMutation(importClipboardScreenshot({
        sessionId,
        entryId: expectedEntryId,
        filename,
        dataUrl,
      }))
      if (!isCurrent()) {
        await discardImportedAttachment(attachment.id)
        return
      }
      try {
        if (!insertImage(attachment.id, attachment.filename, dataUrl)) {
          await discardImportedAttachment(attachment.id)
          return
        }
        ctx.registerImportedAttachment(owner, attachment.id)
      } catch (cause) {
        await discardImportedAttachment(attachment.id)
        throw cause
      }
      ctx.feedback.setNotice('Image attached')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    }
  }

  async function materializeInlineImages(
    document: RichEditorDocument,
    options: { entryId?: string | null; isCurrent?: () => boolean } = {},
  ): Promise<InlineImageMaterialization> {
    const html = richEditorDocumentToHtml(document)
    if (!containsInlineImageData(html)) {
      return { document, importedAttachmentIds: [] }
    }

    if (!ctx.session.activeSession) {
      throw new Error('Open a Session before storing embedded images.')
    }
    const sessionId = ctx.session.activeSession.id

    const entryId = Object.prototype.hasOwnProperty.call(options, 'entryId') ? options.entryId : ctx.session.noteEntry?.id
    if (entryId === undefined) {
      throw new Error('Open a Session with an editable Note Entry before storing embedded images.')
    }

    const documentFragment = new DOMParser().parseFromString(html, 'text/html')
    const images = Array.from(documentFragment.body.querySelectorAll<HTMLImageElement>('img')).filter((image) =>
      (image.getAttribute('src') ?? '').startsWith('data:image/'),
    )
    const importedAttachmentIds: string[] = []

    try {
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index]
        const dataUrl = image.getAttribute('src')
        if (!dataUrl) continue

        const filename = inlineImageFilename(image, index, dataUrl)
        const attachment = await trackMutation(importClipboardScreenshot({
          sessionId,
          entryId,
          filename,
          dataUrl,
        }))
        importedAttachmentIds.push(attachment.id)
        if (options.isCurrent && !options.isCurrent()) {
          await cleanupMaterializedAttachments(importedAttachmentIds)
          return { document, importedAttachmentIds: [] }
        }
        image.setAttribute('data-attachment-id', attachment.id)
        image.setAttribute('src', `${managedAttachmentProtocol}${attachment.id}`)
        image.setAttribute('alt', image.getAttribute('alt') || attachment.filename)
        image.removeAttribute('srcset')
      }
    } catch (cause) {
      await cleanupMaterializedAttachments(importedAttachmentIds)
      throw cause
    }

    const body = richEditorDocumentFromHtml(documentFragment.body.innerHTML)
    return { document: body, importedAttachmentIds }
  }

  return {
    cleanupMaterializedAttachments,
    handlePaste,
    hasPendingAttachmentOperations,
    hasPendingAttachmentMutations,
    materializeInlineImages,
    retryPendingAttachmentCleanup,
    uploadEditorImage,
    waitForPendingAttachmentMutations,
  }
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
