import { getAttachmentPreviewDataUrl, importChatImage, readChatClipboardImageDataUrl, type ChatRef, type ChatRevision, type ChatState } from '../tauri'
import { pastedImageFilename, readFileAsDataUrl } from '../editor/editorHtml'
import { chatIsWorking, chatScope, type ChatImageRecovery, type ChatWorkspace, type SessionChatContext } from './sessionChat.types'
import { formatError, toCommandError } from '../ui/format'

type ImageSource = {
  id: string
  filename: string
  size?: number
  load: () => Promise<string | null>
  pending: { scope: ChatRevision; previousIds: string[]; dataUrl: string; recovery: ChatImageRecovery } | null
}
type ImportResolution = { kind: 'not_committed' } | { kind: 'committed'; attachmentIds: string[] }
type ImageActions = {
  active: () => ChatWorkspace | null
  run: (kind: string, action: (entry: ChatWorkspace) => Promise<void>, bound?: ChatWorkspace) => Promise<void>
  saveComposer: (entry: ChatWorkspace) => Promise<boolean>
  acceptChat: (entry: ChatWorkspace, chat: ChatState, inputVersion: number, modeVersion: number) => void
  refresh: (reference: ChatRef) => Promise<void>
  publish: (entry: ChatWorkspace) => void
  scheduleAutosave: (entry: ChatWorkspace) => void
}

export function createChatImageActions(ctx: SessionChatContext, actions: ImageActions) {
  const failedSources = new WeakMap<ChatWorkspace, Map<string, ImageSource>>()
  function editable(entry: ChatWorkspace) {
    return !entry.retired && Boolean(entry.chat) && !entry.chat?.archived && !entry.chat?.submission
      && !entry.pendingStart && !(entry.owner?.kind === 'notes' && ctx.noteRecovery.has(entry.sessionId)) && !chatIsWorking(entry.job)
  }

  async function reconcileImport(entry: ChatWorkspace, source: ImageSource, intent: 'retry' | 'remove' = 'retry'): Promise<ImportResolution> {
    const attempt = source.pending
    if (!attempt) return { kind: 'not_committed' }
    const retained = new Set(entry.composerImages.map(image => image.attachmentId))
    const removed = new Set((entry.chat?.composerImages ?? []).filter(image => !retained.has(image.attachmentId)).map(image => image.attachmentId))
    const previousChat = entry.chat
    attempt.recovery = { kind: 'refresh_pending', images: attempt.recovery.images }
    await actions.refresh(entry.reference)
    if (entry.retired) return { kind: 'not_committed' }
    const chat = entry.chat
    if (!chat) throw new Error('Reload the conversation before resolving the failed image.')
    if (chat.draftId !== attempt.scope.draftId) {
      if (intent === 'retry') throw new Error('The conversation changed. Remove the failed image and choose it again.')
      source.pending = null
      return { kind: 'not_committed' }
    }
    if (chat === previousChat && chat.revision <= attempt.scope.expectedRevision) {
      throw new Error('The conversation could not be refreshed. Retry before resolving the failed image.')
    }
    if (chat.revision < attempt.scope.expectedRevision) throw new Error('The conversation is out of date. Reload it before resolving the failed image.')
    entry.composerImages = chat.composerImages.filter(image => !removed.has(image.attachmentId))
    actions.publish(entry)
    const previous = new Set(attempt.previousIds)
    const candidates = chat.composerImages.filter(image => !previous.has(image.attachmentId))
    if (candidates.length) {
      const previews = await Promise.all(candidates.map(image => getAttachmentPreviewDataUrl(image.attachmentId).catch(() => null)))
      const attachmentIds = candidates.filter((_, index) => previews[index] === attempt.dataUrl).map(image => image.attachmentId)
      const unverified = candidates.filter((_, index) => previews[index] === null)
      if (!attachmentIds.length && unverified.length) {
        attempt.recovery = { kind: 'verification_pending', images: unverified }
        if (intent !== 'remove' || unverified.some(image => !removed.has(image.attachmentId))) {
          throw new Error('Image verification is pending. Retry verification, or remove the listed unverified attachments, then remove the failed image.')
        }
        if (!await actions.saveComposer(entry)) throw new Error('Save the removed attachments before removing the failed image.')
      }
      source.pending = null
      return attachmentIds.length ? { kind: 'committed', attachmentIds } : { kind: 'not_committed' }
    }
    source.pending = null
    return { kind: 'not_committed' }
  }

  async function attach(entry: ChatWorkspace, sources: ImageSource[]) {
    if (!editable(entry)) throw new Error('Wait until the conversation is ready to attach images.')
    let failure: Error | null = null
    for (const source of sources) {
      try {
        if (source.pending && (await reconcileImport(entry, source)).kind === 'committed') { dismiss(entry, source.id); continue }
        if (entry.retired) return
        if (entry.composerImages.length >= 4) throw new Error('Attach up to 4 images per message.')
        if ((source.size ?? 0) > 10 * 1024 * 1024) throw new Error('Each image must be 10 MiB or smaller.')
        const dataUrl = await source.load()
        if (entry.retired || !dataUrl) return
        source.load = () => Promise.resolve(dataUrl)
        if (!await actions.saveComposer(entry)) throw new Error('Save the composer before retrying this image.')
        if (entry.retired || !entry.chat) return
        const chat = entry.chat
        const inputVersion = entry.inputVersion
        const modeVersion = entry.modeVersion
        source.pending = { scope: chatScope(chat), previousIds: chat.composerImages.map(image => image.attachmentId), dataUrl,
          recovery: { kind: 'refresh_pending', images: [] } }
        try {
          const saved = await importChatImage(source.pending.scope, source.filename, dataUrl)
          if (entry.retired) return
          if (saved.sessionId !== entry.sessionId || saved.draftId !== chat.draftId) {
            throw new Error('Image import returned an unexpected conversation.')
          }
          ++entry.refreshEpoch
          entry.composerImages = saved.composerImages
          actions.acceptChat(entry, saved, inputVersion, modeVersion)
          source.pending = null
        } catch (cause) {
          if ((await reconcileImport(entry, source)).kind !== 'committed') throw cause
        }
        dismiss(entry, source.id)
      } catch (cause) {
        if (entry.retired) return
        recordFailure(entry, source, cause)
        ++entry.inputVersion
        actions.publish(entry)
        const detail = toCommandError(cause)
        failure = cause instanceof Error ? cause : Object.assign(new Error(detail.message), { kind: detail.kind })
      }
    }
    if (failure) throw failure
  }

  function onAttachImages(files: File[], bound?: ChatWorkspace) {
    if (!files.length) return Promise.resolve()
    return actions.run('attach', entry => attach(entry, files.map(file => ({ id: crypto.randomUUID(), pending: null,
      filename: pastedImageFilename(file), size: file.size, load: () => readFileAsDataUrl(file) }))), bound)
  }

  const onPasteNativeImage = (bound?: ChatWorkspace) => actions.run('attach', entry => attach(entry, [{
    id: crypto.randomUUID(), pending: null, filename: `pasted-image-${Date.now()}.png`, load: readChatClipboardImageDataUrl,
  }]), bound)

  function dismiss(entry: ChatWorkspace, id: string) {
    failedSources.get(entry)?.delete(id)
    entry.imageFailures = entry.imageFailures.filter(value => value.id !== id)
  }

  function recordFailure(entry: ChatWorkspace, source: ImageSource, cause: unknown) {
    const failures = failedSources.get(entry) ?? new Map<string, ImageSource>()
    failures.set(source.id, source)
    failedSources.set(entry, failures)
    entry.imageFailures = [...entry.imageFailures.filter(value => value.id !== source.id),
      { id: source.id, filename: source.filename, message: formatError(cause),
        ...(source.pending ? { recovery: source.pending.recovery } : {}) }]
  }

  const onRetryImage = (id: string, bound?: ChatWorkspace) => actions.run('attach', entry => {
    const source = failedSources.get(entry)?.get(id)
    return source ? attach(entry, [source]) : Promise.resolve()
  }, bound)

  function onDismissImageFailure(id: string, bound?: ChatWorkspace) {
    const entry = bound ?? actions.active()
    if (!entry || entry.operationKind) return Promise.resolve()
    const source = failedSources.get(entry)?.get(id)
    if (source?.pending) {
      return actions.run('remove-image', async current => {
        let resolution: ImportResolution
        try { resolution = await reconcileImport(current, source, 'remove') } catch (cause) {
          if (!current.retired) { recordFailure(current, source, cause); actions.publish(current) }
          throw cause
        }
        if (current.retired) return
        if (resolution.kind === 'committed') {
          const removed = new Set(resolution.attachmentIds)
          current.composerImages = current.composerImages.filter(image => !removed.has(image.attachmentId))
        }
        removeFailure(current, id)
      }, entry)
    }
    removeFailure(entry, id)
    return Promise.resolve()
  }

  function removeFailure(entry: ChatWorkspace, id: string) {
    dismiss(entry, id)
    ++entry.inputVersion
    entry.error = null
    actions.publish(entry)
    actions.scheduleAutosave(entry)
  }

  function clearImageFailures(entry: ChatWorkspace) {
    failedSources.delete(entry)
    entry.imageFailures = []
  }

  function onRemoveImage(attachmentId: string, bound?: ChatWorkspace) {
    const entry = bound ?? actions.active()
    if (!entry || !editable(entry) || entry.operationKind) return
    const images = entry.composerImages.filter(image => image.attachmentId !== attachmentId)
    if (images.length === entry.composerImages.length) return
    entry.composerImages = images
    ++entry.inputVersion
    entry.error = null
    actions.publish(entry)
    actions.scheduleAutosave(entry)
  }

  return { onAttachImages, onPasteNativeImage, onRemoveImage, onRetryImage, onDismissImageFailure, clearImageFailures }
}
