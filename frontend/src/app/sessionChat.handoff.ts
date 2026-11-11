import { restartChat, type ChatRef, type ChatState, type ChatSubmissionReceipt } from '../tauri'
import { chatIsWorking, chatScope, unresolvedChatReason, type ChatWorkspace, type SessionChatContext } from './sessionChat.types'
import { submitChatToCanonicalNote } from './sessionChat.noteHandoff'
import type { createChatWorkspaces } from './sessionChat.workspaces'

/** Adding a Notes conversation to the Note, and replacing it with a new conversation. */
export function createChatHandoff(ctx: SessionChatContext, { registry, workspace, active, run, hydrate, refresh, acceptChat, publish, saveComposer, recoverNote, clearImageFailures, needsRecovery, restartVersions, activationEpoch }: {
  registry: ReturnType<typeof createChatWorkspaces>
  workspace: ReturnType<typeof createChatWorkspaces>['workspace']
  active: () => ChatWorkspace | null
  run: (kind: string, action: (entry: ChatWorkspace) => Promise<void>, bound?: ChatWorkspace) => Promise<void>
  hydrate: (entry: ChatWorkspace) => Promise<void>
  refresh: (reference: ChatRef, preserveMode?: boolean, rethrow?: boolean) => Promise<void>
  acceptChat: (entry: ChatWorkspace, chat: ChatState, inputVersion: number, modeVersion: number, composerSave?: boolean) => void
  publish: (entry: ChatWorkspace) => void
  saveComposer: (entry: ChatWorkspace) => Promise<boolean>
  recoverNote: (entry: ChatWorkspace) => Promise<boolean>
  clearImageFailures: (entry: ChatWorkspace) => void
  needsRecovery: (entry: ChatWorkspace) => boolean
  restartVersions: WeakMap<ChatWorkspace, number>
  // Read at call time: activation bumps it after this factory runs.
  activationEpoch: () => number
}) {
  const onSubmit = (bound?: ChatWorkspace) => run('submit',
 async (entry) => {
    if (entry.owner?.kind !== 'notes') throw new Error('Only Notes conversations can be added to the Note.')
    if (ctx.recordWritesPending?.()) throw new Error('Wait for pending record writes before adding the conversation.')
    if (entry.pendingStart) throw new Error('Recheck status to recover the previous send before continuing.')
    if (ctx.noteRecovery.has(entry.sessionId)) { await recoverNote(entry); return }
    if (!entry.chat) await hydrate(entry)
    if (!entry.chat) throw new Error('Load Chat before submitting it.')
    if (entry.chat.submission) { entry.mode = 'write_note'; publish(entry); return }
    if (chatIsWorking(entry.job) || entry.chat.messages.some((message) => message.status !== 'completed')) {
      throw new Error(unresolvedChatReason(entry.chat, false) ?? 'Complete every turn before submitting Chat.')
    }
    if (entry.composer.length > 0 || entry.composerImages.length > 0 || entry.imageFailures.length) throw new Error('Send or clear the composer before submitting Chat.')
    if (!entry.chat.messages.length) throw new Error('Complete a conversation before submitting Chat.')
    if (!await saveComposer(entry)) return
    if (entry.retired) return
    let receipt: ChatSubmissionReceipt
    try {
      receipt = await submitChatToCanonicalNote(ctx, entry.chat)
    } catch (cause) {
      if (entry.retired) return
      // The transaction may have committed even if its response or the Note
      // reload failed. Recover immutable history without pretending adoption succeeded.
      await refresh(entry.reference, true)
      throw cause
    }
    if (entry.retired) return
    ++entry.refreshEpoch
    entry.chat = { ...entry.chat, submission: receipt, mode: 'write_note' }
    entry.mode = 'write_note'
    ++entry.modeVersion
    publish(entry)
    await refresh(entry.reference)
  }, bound)
  function captureRestart(bound?: ChatWorkspace) {
    const entry = bound ?? active()
    if (entry?.chat?.archived || ctx.recordWritesPending?.() || entry?.chat?.proposals?.some(p => p.state.kind === 'staged') || !entry?.chat || entry.pendingStart || entry.loading || entry.save || entry.operationKind || entry.permissionOperation
      || needsRecovery(entry) || ctx.noteRecovery.has(entry.sessionId) || chatIsWorking(entry.job)
      || entry.chat.messages.some(message => message.status === 'running')) return null
    const { job, inputVersion, modeVersion, error } = entry
    const restartVersion = restartVersions.get(entry)
    const epoch = { activation: activationEpoch(), conversation: registry.epoch() }
    return async () => {
      if (entry.error !== error || active() !== entry || activationEpoch() !== epoch.activation || registry.epoch() !== epoch.conversation || restartVersions.get(entry) !== restartVersion || entry.job !== job
        || entry.inputVersion !== inputVersion || entry.modeVersion !== modeVersion || entry.loading
        || entry.operationKind || entry.permissionOperation || needsRecovery(entry)
        || ctx.noteRecovery.has(entry.sessionId)) return
      // onRestart owns the operation and drains an autosave started after capture.
      await onRestart(entry)
    }
  }
  const onRestart = (bound?: ChatWorkspace) => run('restart', async (entry) => {
    if (entry.owner?.kind !== 'notes') throw new Error('Only Notes conversations can be restarted.')
    if (entry.pendingStart) throw new Error('Recheck status to recover the previous send before continuing.')
    if (ctx.recordWritesPending?.() || entry.chat?.proposals?.some(p => p.state.kind === 'staged')) throw new Error('Save, Undo, or Discard the local refinement and wait for pending record writes before starting a new conversation.')
    if (ctx.noteRecovery.has(entry.sessionId)) throw new Error('Recover the canonical Note before starting a new conversation.')
    if (chatIsWorking(entry.job)) throw new Error('Cancel or finish the active turn before starting a new conversation.')
    if (!entry.chat) await hydrate(entry)
    if (!entry.chat) return
    const { inputVersion, modeVersion, job } = entry
    const epoch = { activation: activationEpoch(), conversation: registry.epoch() }
    const restartVersion = restartVersions.get(entry)
    const draftId = entry.chat.draftId
    const history = JSON.stringify([entry.chat.messages, entry.chat.submission, entry.chat.proposals])
    if (!await saveComposer(entry)) return
    if (entry.retired || active() !== entry || activationEpoch() !== epoch.activation || registry.epoch() !== epoch.conversation
      || restartVersions.get(entry) !== restartVersion || entry.inputVersion !== inputVersion || entry.modeVersion !== modeVersion || entry.job !== job
      || entry.loading || entry.permissionOperation || needsRecovery(entry)
      || ctx.noteRecovery.has(entry.sessionId) || ctx.recordWritesPending?.() || entry.chat?.draftId !== draftId
      || JSON.stringify([entry.chat.messages, entry.chat.submission, entry.chat.proposals]) !== history) return
    const next = await restartChat({ scope: chatScope(entry.chat) })
    if (entry.retired) return
    clearImageFailures(entry)
    ++entry.refreshEpoch
    const replacement = workspace({ sessionId: next.sessionId, draftId: next.draftId }, next.owner)
    acceptChat(replacement, next, 0, 0)
    registry.notesBySession.set(next.sessionId, replacement.reference)
    if (registry.visible(entry)) registry.select(replacement.reference)
    replacement.mode = 'chat'; ++replacement.modeVersion
    publish(replacement)
    await saveComposer(replacement)
  }, bound)
  return { onSubmit, captureRestart, onRestart }
}
