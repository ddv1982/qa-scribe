import { saveChatComposer, type ChatMode, type ChatRef, type ChatState } from '../tauri'
import { chatIsDirty, chatScope, type ChatWorkspace, type SessionChatContext } from './sessionChat.types'
import type { createChatWorkspaces } from './sessionChat.workspaces'

/** Composer text, mode and their debounced autosave for one conversation engine. */
export function createChatComposer(ctx: SessionChatContext, { registry, active, hydrate, refresh, acceptChat, report, publish }: {
  registry: ReturnType<typeof createChatWorkspaces>
  active: () => ChatWorkspace | null
  hydrate: (entry: ChatWorkspace) => Promise<void>
  refresh: (reference: ChatRef, preserveMode?: boolean, rethrow?: boolean) => Promise<void>
  acceptChat: (entry: ChatWorkspace, chat: ChatState, inputVersion: number, modeVersion: number, composerSave?: boolean) => void
  report: (entry: ChatWorkspace, cause: unknown) => void
  publish: (entry: ChatWorkspace) => void
}) {
  function clearAutosave(entry: ChatWorkspace) {
    if (entry.autosaveTimer) clearTimeout(entry.autosaveTimer)
    entry.autosaveTimer = null
  }
  async function saveComposer(entry: ChatWorkspace): Promise<boolean> {
    if (entry.retired) return true
    if (entry.owner?.kind === 'notes' && ctx.noteRecovery.has(entry.sessionId)) return false
    clearAutosave(entry)
    if (entry.save) return entry.save
    if (entry.pendingStart?.state === 'uncertain') {
      try { await refresh(entry.reference, false, true) } catch { return false }
      return !chatIsDirty(entry)
    }
    if (!chatIsDirty(entry)) return true
    const pending = (async () => {
      if (!entry.chat) await hydrate(entry)
      if (entry.retired) return true
      if (!entry.chat || (entry.owner?.kind === 'notes' && ctx.noteRecovery.has(entry.sessionId))) return false
      while (chatIsDirty(entry)) {
        const chat = entry.chat
        const inputVersion = entry.inputVersion
        const modeVersion = entry.modeVersion
        const composer = entry.composer
        const attachmentIds = entry.composerImages.map(image => image.attachmentId)
        const mode = entry.mode
        try {
          const saved = await Promise.race([
            saveChatComposer({ scope: chatScope(chat), composer, intent: entry.composerIntent, attachmentIds, mode }), entry.retirement.then(() => null),
          ])
          if (!saved || entry.retired) return true
          if (saved.sessionId !== chat.sessionId || saved.draftId !== chat.draftId) {
            throw new Error('Composer save returned an unexpected conversation.')
          }
          // A save establishes a new revision, not permission to replace newer input.
          ++entry.refreshEpoch
          const priorError = entry.error
          entry.error = null
          acceptChat(entry, saved, inputVersion, modeVersion, true)
          if (priorError && registry.visible(entry)) {
            ctx.feedback.setError((current) => current === priorError ? null : current)
          }
        } catch (cause) { report(entry, cause); return false }
      }
      return true
    })().finally(() => { entry.save = null; publish(entry) })
    entry.save = pending
    publish(entry)
    return pending
  }
  function scheduleAutosave(entry: ChatWorkspace) {
    if (entry.retired) return
    clearAutosave(entry)
    entry.autosaveTimer = setTimeout(() => {
      entry.autosaveTimer = null
      if (!entry.operationKind) void saveComposer(entry)
    }, 500)
  }
  function onSetComposer(text: string, bound?: ChatWorkspace) {
    const entry = bound ?? active()
    if (!entry) { registry.buffer({ composer: text }); return }
    if (!entry || entry.retired || entry.chat?.archived || (entry.owner?.kind === 'notes' && ctx.noteRecovery.has(entry.sessionId)) || entry.chat?.submission || ['submit', 'restart'].includes(entry.operationKind ?? '')) return
    if (text === entry.composer) return
    entry.composer = text
    ++entry.inputVersion
    entry.error = null
    publish(entry)
    scheduleAutosave(entry)
  }
  function setMode(mode: ChatMode, bound?: ChatWorkspace) {
    const entry = bound ?? active()
    if (!entry) { registry.buffer({ mode }); return }
    if (!entry || entry.retired || entry.chat?.archived || entry.operationKind === 'submit' || mode === entry.mode) return
    entry.mode = mode
    ++entry.modeVersion
    publish(entry)
    if (!entry.chat?.submission) scheduleAutosave(entry)
  }
  return { clearAutosave, saveComposer, scheduleAutosave, onSetComposer, setMode }
}
