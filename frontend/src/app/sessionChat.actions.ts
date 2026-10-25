import { createChatWorkspaces, sameReference, statusOwns, type ConversationAttention } from './sessionChat.workspaces'
import { createChatSend } from './sessionChat.send'
import {
  cancelAiActionJob, getConversation, activateConversation, restartChat, saveChatComposer,
  type ChatRef, type ChatComposerIntent,
  type ChatMode, type ChatState, type ChatSubmissionReceipt, type GenerationJobStatus,
} from '../tauri'
import { formatError } from '../ui/format'
import {
  chatIsDirty, chatInputIsDirty, chatIsWorking, chatHasCommittedStart, chatScope, emptyChatSnapshot, unresolvedChatReason,
  type ChatWorkspace, type SessionChatContext,
} from './sessionChat.types'
import { createChatPolling } from './sessionChat.polling'
import { submitChatToCanonicalNote } from './sessionChat.noteHandoff'
import { recoverChatCanonicalNote } from './sessionChat.noteRecovery'
import { createChatPermissions } from './sessionChat.permissions'
import { createChatImageActions } from './sessionChat.images'

export function createSessionChatActions(ctx: SessionChatContext) {
  const snapshots = new WeakMap<ChatWorkspace, import('./sessionChat.types').ChatSnapshot>()
  const attentionListeners = new Set<() => void>()
  let selectionRequest = 0
  const listeners = new WeakMap<ChatWorkspace, Set<() => void>>()
  const registry = createChatWorkspaces(ctx, publish)
  const { workspaces, workspace } = registry
  const restartVersions = new WeakMap<ChatWorkspace, number>()
  function restartContent(chat: ChatState | null) {
    return JSON.stringify([chat?.sessionId, chat?.draftId, chat?.messages, chat?.aiRuns, chat?.submission, chat?.proposals])
  }
  let disposed = false
  let activationEpoch = 0
  let activatedSessionId: string | null = null
  const supersededJobs = new WeakMap<ChatWorkspace, Set<string>>()
  const active = () => { const entry = registry.active(); return entry && registry.visible(entry) ? entry : null }
  function isCurrentPermissionScope(sessionId: string | null, jobId: string | null, _provider: SessionChatContext['selection']['selectedProvider']) {
    const entry = active()
    return Boolean(entry && registry.visible(entry) && entry.sessionId === sessionId && (entry.job?.jobId ?? null) === jobId)
  }
  function publish(entry: ChatWorkspace) {
    if (disposed || !registry.current(entry)) return
    const snapshot = { sessionId: entry.sessionId, chat: entry.chat, composer: entry.composer, composerImages: entry.composerImages, imageFailures: entry.imageFailures,
      inputRecoveryPending: entry.pendingStart?.state === 'uncertain', responseStarting: entry.pendingStart?.intent.kind === 'composer' ? entry.composerIntent : entry.pendingStart?.intent,
      composerIntent: entry.composerIntent, mode: entry.mode, job: entry.job, loading: entry.loading, saving: Boolean(entry.save),
      permissionWorking: Boolean(entry.permissionOperation),
      permissionRecoveryPending: permissions.needsRecovery(entry),
      working: Boolean(entry.operationKind) || chatIsWorking(entry.job), error: entry.error, dirty: chatIsDirty(entry) || entry.imageFailures.length > 0 }
    snapshots.set(entry, snapshot)
    for (const listener of attentionListeners) listener()
    for (const listener of listeners.get(entry) ?? []) listener()
    if (registry.visible(entry)) ctx.publish(snapshot)
  }
  function report(entry: ChatWorkspace, cause: unknown) {
    if (entry.retired || disposed) return
    entry.error = formatError(cause)
    publish(entry)
    if (registry.visible(entry)) ctx.feedback.setError(entry.error)
  }
  function acceptChat(entry: ChatWorkspace, chat: ChatState, inputVersion: number, modeVersion: number, composerSave = false) {
    if (entry.retired) return
    if (!sameReference(chat, entry.reference) || (entry.owner && JSON.stringify(entry.owner) !== JSON.stringify(chat.owner))) throw new Error('Chat returned an unexpected conversation.')
    entry.owner = chat.owner
    if (entry.chat?.draftId === chat.draftId && chat.revision < entry.chat.revision) {
      if (chat.lastActiveOrder > entry.chat.lastActiveOrder) { entry.chat = { ...entry.chat, lastActiveOrder: chat.lastActiveOrder, lastActiveAt: chat.lastActiveAt }; publish(entry) }
      return
    }
    const previousChat = entry.chat
    const previousContent = restartContent(previousChat)
    const previousComposer = entry.composer
    const previousMode = entry.mode
    if (previousChat && previousChat.lastActiveOrder > chat.lastActiveOrder) chat = { ...chat, lastActiveOrder: previousChat.lastActiveOrder, lastActiveAt: previousChat.lastActiveAt }
    if (entry.pendingStart?.state === 'uncertain' && chatHasCommittedStart(chat, entry.pendingStart)) {
      entry.pendingStart = null
      entry.composerImages = chat.composerImages
    }
    entry.chat = chat
    if (inputVersion === entry.inputVersion) {
      entry.composer = chat.composer
      entry.composerIntent = chat.composerIntent
      entry.composerImages = chat.composerImages ?? []
    }
    if (modeVersion === entry.modeVersion) entry.mode = chat.mode
    // A save acknowledgment advances storage revision without changing the
    // confirmed subject. Refreshes that change durable input still invalidate it.
    if (previousContent !== restartContent(chat) || previousComposer !== entry.composer || previousMode !== entry.mode
      || (!composerSave && (previousChat?.composer !== chat.composer || previousChat?.mode !== chat.mode
        || JSON.stringify(previousChat?.composerImages) !== JSON.stringify(chat.composerImages)))) {
      restartVersions.set(entry, (restartVersions.get(entry) ?? 0) + 1)
    }
    const reason = unresolvedChatReason(chat, true)
    if (reason?.includes('earlier turn')) entry.error = reason
    publish(entry)
  }
  async function refresh(reference: ChatRef, preserveMode = false, rethrow = false, current = () => true) {
    if (ctx.noteRecovery.isRetired(reference.sessionId)) return
    const entry = workspace(reference)
    const epoch = ++entry.refreshEpoch
    // Already-dirty input is authored intent too, even when no edit happens
    // during this particular refresh (for example a terminal-job reload).
    const inputDirty = entry.chat ? chatInputIsDirty(entry) : entry.inputVersion > 0
    const modeDirty = entry.chat ? entry.mode !== entry.chat.mode : entry.modeVersion > 0
    const inputVersion = inputDirty ? -1 : entry.inputVersion
    const modeVersion = modeDirty || preserveMode ? -1 : entry.modeVersion
    entry.loading = !entry.chat
    publish(entry)
    try {
      const chat = await Promise.race([getConversation(reference), entry.retirement.then(() => null)])
      if (!chat || disposed || entry.retired || epoch !== entry.refreshEpoch || !current()) return
      acceptChat(entry, chat, inputVersion, modeVersion)
    } catch (cause) {
      if (!disposed && epoch === entry.refreshEpoch && current()) report(entry, cause)
      if (rethrow) throw cause
    } finally {
      if (epoch === entry.refreshEpoch) { entry.loading = false; if (current()) publish(entry) }
    }
  }
  function hydrate(entry: ChatWorkspace) {
    if (entry.hydration) return entry.hydration
    const pending = refresh(entry.reference).finally(() => {
      if (entry.hydration === pending) entry.hydration = null
    })
    entry.hydration = pending
    return pending
  }
  function acceptStatus(status: GenerationJobStatus, newJob = false) {
    if (status.action !== 'chat' || disposed || ctx.noteRecovery.isRetired(status.sessionId)) return
    const reference = status.chat?.reference
    if (!reference || reference.sessionId !== status.sessionId || typeof reference.draftId !== 'string' || !reference.draftId.trim()) { ctx.feedback.setError('Chat job status is missing a valid conversation reference.'); return }
    const entry = workspace(reference)
    if (entry.retired || supersededJobs.get(entry)?.has(status.jobId)) return
    if (entry.job?.jobId === status.jobId && !chatIsWorking(entry.job) && chatIsWorking(status)) return
    if (entry.job?.jobId === status.jobId && !chatIsWorking(entry.job) && entry.job.state !== status.state) return
    if (entry.job && entry.job.jobId !== status.jobId && chatIsWorking(entry.job)) return
    if (entry.job && entry.job.jobId !== status.jobId) {
      // Foreign terminal events cannot replace the current job. Remember jobs
      // displaced by a new active job so their late events cannot resurrect them.
      if (!newJob && !chatIsWorking(status)) return
      const previous = supersededJobs.get(entry) ?? new Set<string>()
      previous.add(entry.job.jobId)
      supersededJobs.set(entry, previous)
      polling.stop(entry.job.jobId)
    }
    const filtered = permissions.filterStatus(entry, status)
    if (!filtered) return
    entry.job = filtered
    if (status.errorMessage) entry.error = status.errorMessage
    if (entry.pendingStart && status.jobId !== entry.pendingStart.previousJobId && status.chat && statusOwns(entry, status)) entry.pendingStart = null
    publish(entry)
  }
  const polling = createChatPolling(acceptStatus, refresh, (reference, error) => report(workspace(reference), error))
  const permissions = createChatPermissions(ctx, {
    active, current: (entry) => !disposed && registry.current(entry),
    epoch: registry.epoch, publish, report, observe: observeJob,
    refresh: (reference, current) => refresh(reference, false, true, current),
  })
  function observeJob(status: GenerationJobStatus, newJob = false) {
    if (disposed || status.action !== 'chat' || ctx.noteRecovery.isRetired(status.sessionId)) return
    const previous = status.chat?.reference ? workspace(status.chat.reference).job : null
    acceptStatus(status, newJob)
    const current = (status.chat?.reference ? workspace(status.chat.reference).job : null)
    if (current?.jobId === status.jobId && chatIsWorking(current)) polling.watch(current)
    if (current?.jobId === status.jobId && !chatIsWorking(current) && chatIsWorking(previous) && status.chat) { polling.stop(status.jobId); void refresh(status.chat.reference) }
  }
  function receiveStatus(entry: ChatWorkspace, status: GenerationJobStatus) {
    if (entry.retired || !statusOwns(entry, status)) return
    observeJob(status)

  }
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
  const { onAttachImages, onPasteNativeImage, onRemoveImage, onRetryImage, onDismissImageFailure } = createChatImageActions(ctx, {
    active, run, saveComposer, acceptChat, refresh: id => refresh(id, false, true), publish, scheduleAutosave,
  })
  function run(kind: string, action: (entry: ChatWorkspace) => Promise<void>, bound?: ChatWorkspace): Promise<void> {
    const entry = bound ?? active()
    if (!entry || entry.operationKind) return Promise.resolve()
    entry.operationKind = kind
    entry.error = null
    if (registry.visible(entry)) ctx.feedback.setError(null)
    clearAutosave(entry)
    const operation = Promise.race([action(entry), entry.retirement]).catch((cause: unknown) => report(entry, cause)).finally(() => {
      entry.operation = null
      entry.operationKind = null
      publish(entry)
      if (!entry.retired && chatIsDirty(entry) && !entry.error) scheduleAutosave(entry)
    })
    entry.operation = operation
    publish(entry)
    return operation
  }
  const { onSend, onRefine, onDraftJira, onAnswerQuestion, onPrepareAction, onRetry } = createChatSend(ctx, {
    active, run, saveComposer, hydrate, refresh: id => refresh(id, false, true), publish, acceptChat, receiveStatus, observeJob, onSetComposer,
  })
  const { onDecidePermission, onRecheck } = permissions
  const onCancel = (bound?: ChatWorkspace) => run('cancel', async (entry) => {
    if (!entry.job || !chatIsWorking(entry.job)) return
    const status = await cancelAiActionJob(entry.job.jobId)
    if (entry.retired) return
    if (!statusOwns(entry, status)) throw new Error('Cancellation returned an unexpected Chat job.')
    observeJob(status)
    if (!chatIsWorking(status)) { polling.stop(status.jobId); await refresh(entry.reference) }
  }, bound)
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
      || permissions.needsRecovery(entry) || ctx.noteRecovery.has(entry.sessionId) || chatIsWorking(entry.job)
      || entry.chat.messages.some(message => message.status === 'running')) return null
    const { job, inputVersion, modeVersion, error } = entry
    const restartVersion = restartVersions.get(entry)
    const epoch = { activation: activationEpoch, conversation: registry.epoch() }
    return async () => {
      if (entry.error !== error || active() !== entry || activationEpoch !== epoch.activation || registry.epoch() !== epoch.conversation || restartVersions.get(entry) !== restartVersion || entry.job !== job
        || entry.inputVersion !== inputVersion || entry.modeVersion !== modeVersion || entry.loading
        || entry.operationKind || entry.permissionOperation || permissions.needsRecovery(entry)
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
    const epoch = { activation: activationEpoch, conversation: registry.epoch() }
    const restartVersion = restartVersions.get(entry)
    const draftId = entry.chat.draftId
    const history = JSON.stringify([entry.chat.messages, entry.chat.submission, entry.chat.proposals])
    if (!await saveComposer(entry)) return
    if (entry.retired || active() !== entry || activationEpoch !== epoch.activation || registry.epoch() !== epoch.conversation
      || restartVersions.get(entry) !== restartVersion || entry.inputVersion !== inputVersion || entry.modeVersion !== modeVersion || entry.job !== job
      || entry.loading || entry.permissionOperation || permissions.needsRecovery(entry)
      || ctx.noteRecovery.has(entry.sessionId) || ctx.recordWritesPending?.() || entry.chat?.draftId !== draftId
      || JSON.stringify([entry.chat.messages, entry.chat.submission, entry.chat.proposals]) !== history) return
    const next = await restartChat({ scope: chatScope(entry.chat) })
    if (entry.retired) return
    ++entry.refreshEpoch
    const replacement = workspace({ sessionId: next.sessionId, draftId: next.draftId }, next.owner)
    acceptChat(replacement, next, 0, 0)
    registry.notesBySession.set(next.sessionId, replacement.reference)
    if (registry.visible(entry)) registry.select(replacement.reference)
    replacement.mode = 'chat'; ++replacement.modeVersion
    publish(replacement)
    await saveComposer(replacement)
  }, bound)
  async function flush(): Promise<boolean> {
    for (const entry of workspaces.values()) {
      if (entry.operation && ['attach', 'remove-image', 'submit', 'restart'].includes(entry.operationKind ?? '')) await entry.operation
      if (entry.retired) continue
      if (entry.owner?.kind === 'notes' && ctx.noteRecovery.has(entry.sessionId) && !await recoverNote(entry)) return false
      if (!await saveComposer(entry)) return false
    }
    return !hasPendingChanges()
  }
  function hasPendingChanges() {
    return registry.pendingInputs() || ctx.noteRecovery.hasPending()
      || Array.from(workspaces.values()).some((entry) => !entry.retired && (
        (entry.owner?.kind === 'notes' && ctx.noteRecovery.has(entry.sessionId)) || chatIsDirty(entry) || entry.imageFailures.length > 0 || Boolean(entry.save || (entry.operationKind && ['attach', 'remove-image', 'submit', 'restart'].includes(entry.operationKind)))))
  }
  function activate(sessionId: string | null) {
    if (disposed || activatedSessionId !== sessionId) {
      ++activationEpoch
    }
    activatedSessionId = sessionId
    disposed = false
    if (!sessionId || ctx.noteRecovery.isRetired(sessionId)) { ctx.publish(emptyChatSnapshot); return }
    const epoch = activationEpoch
    const known = registry.notesBySession.has(sessionId)
    const current = registry.active()
    if (current?.sessionId !== sessionId || current.owner?.kind !== 'notes') registry.select(null)
    registry.loading(sessionId)
    return registry.notes(sessionId).then(async entry => {
      if (!entry || disposed || epoch !== activationEpoch || activatedSessionId !== sessionId) return
      registry.select(entry.reference)
      const reason = entry.chat && unresolvedChatReason(entry.chat, true)
      if (reason?.includes('earlier turn')) entry.error = reason
      publish(entry)
      if (known) await refresh(entry.reference)
      if (chatIsDirty(entry)) scheduleAutosave(entry)
      if (entry.job) polling.watch(entry.job)
    }).catch(cause => { if (epoch === activationEpoch) ctx.feedback.setError(formatError(cause)) })
  }
  function dispose() {
    ++activationEpoch
    disposed = true
    polling.dispose()
    for (const entry of workspaces.values()) {
      entry.permissionOperation = null
      clearAutosave(entry)
    }
  }
  function retire(sessionId: string) {
    registry.retire(sessionId)
    for (const entry of workspaces.values()) {
      if (entry.sessionId !== sessionId) continue
      entry.retired = true; entry.permissionOperation = null; ++entry.refreshEpoch
      clearAutosave(entry)
      if (entry.job) polling.stop(entry.job.jobId)
      entry.resolveRetirement(); workspaces.delete(entry.reference.draftId)
    }
    for (const listener of attentionListeners) listener()
  }
  function recoverNote(entry: ChatWorkspace): Promise<boolean> {
    if (entry.retired || !ctx.noteRecovery.has(entry.sessionId)) return Promise.resolve(true)
    if (entry.recovery) return entry.recovery
    const inputVersion = entry.chat && !chatInputIsDirty(entry) ? entry.inputVersion : -1
    const pending = Promise.race([(async () => {
      try {
        const chat = await recoverChatCanonicalNote(ctx, entry.reference)
        if (entry.retired || !chat) return true
        ++entry.refreshEpoch
        acceptChat(entry, chat, inputVersion, -1)
        if (chat.submission) { entry.mode = 'write_note'; ++entry.modeVersion }
        entry.error = null
        ctx.feedback.setError(null)
        ctx.feedback.setNotice(chat.submission ? 'Submitted Chat Note recovered' : 'Canonical Note recovered. Submission was not recorded; review before submitting again.')
        publish(entry)
        return true
      } catch (cause) { report(entry, cause); return false }
    })(), entry.retirement.then(() => true)]).finally(() => { entry.recovery = null })
    entry.recovery = pending
    return pending
  }
  async function recoverSession(sessionId: string): Promise<boolean> {
    if (ctx.noteRecovery.isRetired(sessionId)) return true
    const entry = await registry.notes(sessionId)
    if (!entry) return true
    // Session re-selection is a public recovery path. It must share the
    // handoff's operation boundary rather than unlock a still-pending submit.
    if (entry.operation) await entry.operation
    if (entry.retired) return true
    return recoverNote(entry)
  }
  function setIntent(intent: ChatComposerIntent, entry = active()) {
    if (!entry || entry.retired || entry.pendingStart || entry.chat?.archived || entry.chat?.submission || entry.operationKind) return
    if (JSON.stringify(intent) === JSON.stringify(entry.composerIntent)) return
    entry.composerIntent = intent; ++entry.inputVersion; publish(entry); scheduleAutosave(entry)
  }
  const handles = new WeakMap<ChatWorkspace, ConversationHandle>()
  function bind(reference: ChatRef): ConversationHandle {
    const entry = workspace(reference)
    const existing = handles.get(entry)
    if (existing) return existing
    publish(entry)
    const handle = { reference: entry.reference,
      snapshot: () => snapshots.get(entry) ?? emptyChatSnapshot,
      subscribe(listener: () => void) { const set = listeners.get(entry) ?? new Set(); set.add(listener); listeners.set(entry, set); return () => { set.delete(listener) } },
      refresh: () => refresh(reference, false, true), flush: () => saveComposer(entry),
      async prepareComposer(intent: ChatComposerIntent, text: string) {
        if (!entry.chat) await refresh(reference, false, true)
        if (entry.chat?.archived || entry.chat?.submission) throw new Error('This conversation is read-only.')
        if (entry.retired || entry.pendingStart || entry.operation || entry.save || entry.imageFailures.length || entry.composer || entry.composerImages.length || entry.composerIntent.kind !== 'message' || chatIsWorking(entry.job) || entry.chat?.submission) throw new Error('Your existing input is retained. Complete or clear it before preparing a new action.')
        entry.composer = text; entry.composerIntent = intent; ++entry.inputVersion; publish(entry)
        return saveComposer(entry)
      },
      setComposer: (text: string) => onSetComposer(text, entry), setIntent: (intent: ChatComposerIntent) => setIntent(intent, entry),
      setMode: (mode: ChatMode) => setMode(mode, entry),
      submit: () => onSubmit(entry), restart: () => onRestart(entry), captureRestart: () => captureRestart(entry), prepareAction: (id: string) => onPrepareAction(id, entry),
      send: () => onSend(entry), retry: () => onRetry(entry),
      answer: (id: string, text: string) => onAnswerQuestion(id, text, entry),
      cancel: () => onCancel(entry), attachImages: (files: File[]) => onAttachImages(files, entry), pasteImage: () => onPasteNativeImage(entry),
      removeImage: (id: string) => onRemoveImage(id, entry), retryImage: (id: string) => onRetryImage(id, entry), dismissImage: (id: string) => onDismissImageFailure(id, entry),
      decidePermission: (id: string, decision: import('../bindings').ChatPermissionDecision) => onDecidePermission(id, decision, entry),
      recheck: () => onRecheck(entry),
    }
    handles.set(entry, handle)
    return handle
  }
  async function select(reference: ChatRef) {
    const handle = bind(reference)
    const request = ++selectionRequest
    await handle.refresh()
    const entry = workspace(reference)
    const activated = await activateConversation(reference)
    acceptChat(entry, activated, -1, -1)
    if (selectionRequest === request && ctx.session.activeSessionIdRef.current === reference.sessionId) { registry.select(reference); publish(entry) }
    return handle
  }
  function attention(sessionId: string): ConversationAttention[] {
    return [...workspaces.values()].filter(entry => entry.sessionId === sessionId && !entry.retired).map(entry => ({ reference: entry.reference, owner: entry.owner, snapshot: snapshots.get(entry) ?? emptyChatSnapshot }))
  }
  return { bind, select, attention, subscribeAttention(listener: () => void) { attentionListeners.add(listener); return () => { attentionListeners.delete(listener) } }, flushInputs: flush, selectionEpoch: registry.epoch, refresh, onRefine, onDraftJira, onAnswerQuestion, onPrepareAction, activate, dispose, observeJob, flush, hasPendingChanges, setMode, retire, recoverSession,
    onSetComposer, onAttachImages, onPasteNativeImage, onRemoveImage, onRetryImage, onDismissImageFailure, onSend, onRetry, onCancel, onSubmit,
    onRestart, captureRestart, onDecidePermission, onRecheck, isCurrentPermissionScope }
}

export type ConversationEngine = ReturnType<typeof createSessionChatActions>
export type ConversationHandle = { reference: ChatRef; snapshot: () => import('./sessionChat.types').ChatSnapshot; subscribe: (listener: () => void) => () => void; refresh: () => Promise<void>; flush: () => Promise<boolean>; prepareComposer: (intent: ChatComposerIntent, text: string) => Promise<boolean>; setComposer: (text: string) => void; setIntent: (intent: ChatComposerIntent) => void; setMode: (mode: ChatMode) => void; submit: () => Promise<void>; restart: () => Promise<void>; captureRestart: () => (() => Promise<void>) | null; prepareAction: (id: string) => Promise<void>; send: () => Promise<void>; retry: () => Promise<void>; answer: (id: string, text: string) => Promise<void>; cancel: () => Promise<void>; attachImages: (files: File[]) => Promise<void>; pasteImage: () => Promise<void>; removeImage: (id: string) => void; retryImage: (id: string) => Promise<void>; dismissImage: (id: string) => Promise<void>; decidePermission: (id: string, decision: import('../bindings').ChatPermissionDecision) => Promise<void>; recheck: () => Promise<void> }
