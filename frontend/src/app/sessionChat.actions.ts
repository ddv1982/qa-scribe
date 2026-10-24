import {
  cancelAiActionJob, getChat, restartChat, saveChatComposer, startChatJob,
  type ChatMode, type ChatState, type ChatSubmissionReceipt, type GenerationJobStatus, type StartChatJobResult,
} from '../tauri'
import { formatError } from '../ui/format'
import {
  chatIsDirty, chatInputIsDirty, chatIsWorking, chatScope, emptyChatSnapshot, unresolvedChatReason,
  type ChatWorkspace, type SessionChatContext,
} from './sessionChat.types'
import { createChatPolling } from './sessionChat.polling'
import { submitChatToCanonicalNote } from './sessionChat.noteHandoff'
import { recoverChatCanonicalNote } from './sessionChat.noteRecovery'
import { createChatPermissions } from './sessionChat.permissions'
import { createChatImageActions } from './sessionChat.images'

export function createSessionChatActions(ctx: SessionChatContext) {
  const workspaces = new Map<string, ChatWorkspace>()
  const restartVersions = new WeakMap<ChatWorkspace, number>()
  function restartContent(chat: ChatState | null) {
    return JSON.stringify([chat?.sessionId, chat?.draftId, chat?.messages, chat?.aiRuns, chat?.submission])
  }
  let disposed = false
  let activationEpoch = 0
  let activatedSessionId: string | null = null
  const supersededJobs = new WeakMap<ChatWorkspace, Set<string>>()
  function workspace(sessionId: string): ChatWorkspace {
    let value = workspaces.get(sessionId)
    if (!value) {
      let resolveRetirement: () => void = () => {}
      const retirement = new Promise<void>((resolve) => { resolveRetirement = resolve })
      value = { sessionId, chat: null, composer: '', composerImages: [], imageFailures: [], pendingStart: null, mode: 'write_note', inputVersion: 0,
        modeVersion: 0, refreshEpoch: 0, loading: false, error: null, job: null,
        hydration: null, save: null, operation: null, operationKind: null, permissionOperation: null, autosaveTimer: null,
        retired: false, retirement, resolveRetirement, recovery: null }
      workspaces.set(sessionId, value)
    }
    return value
  }
  function active() {
    const id = ctx.session.activeSessionIdRef.current
    return id && !ctx.noteRecovery.isRetired(id) ? workspace(id) : null
  }
  function isCurrentPermissionScope(sessionId: string | null, jobId: string | null, provider: SessionChatContext['selection']['selectedProvider']) {
    if (disposed || !sessionId || ctx.session.activeSessionIdRef.current !== sessionId
      || ctx.noteRecovery.isRetired(sessionId) || ctx.selection.selectedProvider !== provider) return false
    const entry = workspaces.get(sessionId)
    return Boolean(entry && !entry.retired && (entry.job?.jobId ?? null) === jobId)
  }
  function publish(entry: ChatWorkspace) {
    if (disposed || entry.retired || ctx.session.activeSessionIdRef.current !== entry.sessionId) return
    ctx.publish({ sessionId: entry.sessionId, chat: entry.chat, composer: entry.composer, composerImages: entry.composerImages, imageFailures: entry.imageFailures,
      inputRecoveryPending: entry.pendingStart?.state === 'uncertain',
      mode: entry.mode, job: entry.job, loading: entry.loading, saving: Boolean(entry.save),
      permissionWorking: Boolean(entry.permissionOperation),
      permissionRecoveryPending: permissions.needsRecovery(entry),
      working: Boolean(entry.operationKind) || chatIsWorking(entry.job), error: entry.error, dirty: chatIsDirty(entry) || entry.imageFailures.length > 0 })
  }
  function report(entry: ChatWorkspace, cause: unknown) {
    if (entry.retired || disposed) return
    entry.error = formatError(cause)
    publish(entry)
    if (ctx.session.activeSessionIdRef.current === entry.sessionId) ctx.feedback.setError(entry.error)
  }
  function acceptChat(entry: ChatWorkspace, chat: ChatState, inputVersion: number, modeVersion: number, composerSave = false) {
    if (entry.retired) return
    if (chat.sessionId !== entry.sessionId) throw new Error('Chat returned an unexpected Session.')
    if (entry.chat?.draftId === chat.draftId && chat.revision < entry.chat.revision) return
    const previousChat = entry.chat
    const previousContent = restartContent(previousChat)
    const previousComposer = entry.composer
    const previousMode = entry.mode
    entry.chat = chat
    if (inputVersion === entry.inputVersion) {
      entry.composer = chat.composer
      entry.composerImages = chat.composerImages ?? []
    }
    if (entry.pendingStart?.state === 'uncertain') {
      entry.composerImages = chat.composerImages
      entry.pendingStart = null
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
  async function refresh(sessionId: string, preserveMode = false, rethrow = false, current = () => true) {
    if (ctx.noteRecovery.isRetired(sessionId)) return
    const entry = workspace(sessionId)
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
      const chat = await Promise.race([getChat(sessionId), entry.retirement.then(() => null)])
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
    const pending = refresh(entry.sessionId).finally(() => {
      if (entry.hydration === pending) entry.hydration = null
    })
    entry.hydration = pending
    return pending
  }
  function acceptStatus(status: GenerationJobStatus, newJob = false) {
    if (status.action !== 'chat' || disposed || ctx.noteRecovery.isRetired(status.sessionId)) return
    const entry = workspace(status.sessionId)
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
    entry.job = permissions.filterStatus(entry, status)
    if (status.errorMessage) entry.error = status.errorMessage
    publish(entry)
  }
  const polling = createChatPolling(acceptStatus, refresh, (sessionId, error) => report(workspace(sessionId), error))
  const permissions = createChatPermissions(ctx, {
    active, current: (entry) => !disposed && !entry.retired && !ctx.noteRecovery.isRetired(entry.sessionId)
      && ctx.session.activeSessionIdRef.current === entry.sessionId && workspaces.get(entry.sessionId) === entry,
    epoch: () => activationEpoch, publish, report, observe: observeJob,
    refresh: (sessionId, current) => refresh(sessionId, false, true, current),
  })
  function observeJob(status: GenerationJobStatus, newJob = false) {
    if (disposed || status.action !== 'chat' || ctx.noteRecovery.isRetired(status.sessionId)) return
    acceptStatus(status, newJob)
    const current = workspace(status.sessionId).job
    if (current?.jobId === status.jobId && chatIsWorking(current)) polling.watch(current)
  }
  function receiveStatus(entry: ChatWorkspace, status: GenerationJobStatus) {
    if (entry.retired || status.sessionId !== entry.sessionId || status.action !== 'chat') return
    observeJob(status)
    if (entry.job?.jobId === status.jobId && !chatIsWorking(status)) {
      polling.stop(status.jobId)
      void refresh(entry.sessionId)
    }
  }
  function clearAutosave(entry: ChatWorkspace) {
    if (entry.autosaveTimer) clearTimeout(entry.autosaveTimer)
    entry.autosaveTimer = null
  }
  async function saveComposer(entry: ChatWorkspace): Promise<boolean> {
    if (entry.retired) return true
    if (ctx.noteRecovery.has(entry.sessionId)) return false
    clearAutosave(entry)
    if (entry.save) return entry.save
    if (entry.pendingStart?.state === 'uncertain') {
      try { await refresh(entry.sessionId, false, true) } catch { return false }
    }
    if (!chatIsDirty(entry)) return true
    const pending = (async () => {
      if (!entry.chat) await hydrate(entry)
      if (entry.retired) return true
      if (!entry.chat) return false
      while (chatIsDirty(entry)) {
        const chat = entry.chat
        const inputVersion = entry.inputVersion
        const modeVersion = entry.modeVersion
        const composer = entry.composer
        const attachmentIds = entry.composerImages.map(image => image.attachmentId)
        const mode = entry.mode
        try {
          const saved = await Promise.race([
            saveChatComposer({ scope: chatScope(chat), composer, attachmentIds, mode }), entry.retirement.then(() => null),
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
          if (priorError && ctx.session.activeSessionIdRef.current === entry.sessionId) {
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
  function onSetComposer(text: string) {
    const entry = active()
    if (!entry || ctx.noteRecovery.has(entry.sessionId) || entry.chat?.submission || ['submit', 'restart'].includes(entry.operationKind ?? '')) return
    if (text === entry.composer) return
    entry.composer = text
    ++entry.inputVersion
    entry.error = null
    publish(entry)
    scheduleAutosave(entry)
  }
  function setMode(mode: ChatMode) {
    const entry = active()
    if (!entry || entry.operationKind === 'submit' || mode === entry.mode) return
    entry.mode = mode
    ++entry.modeVersion
    publish(entry)
    if (!entry.chat?.submission) scheduleAutosave(entry)
  }
  const { onAttachImages, onPasteNativeImage, onRemoveImage, onRetryImage, onDismissImageFailure, clearImageFailures } = createChatImageActions(ctx, {
    active, run, saveComposer, acceptChat, refresh: id => refresh(id, false, true), publish, scheduleAutosave,
  })
  function run(kind: string, action: (entry: ChatWorkspace) => Promise<void>): Promise<void> {
    const entry = active()
    if (!entry || entry.operationKind) return Promise.resolve()
    entry.operationKind = kind
    entry.error = null
    ctx.feedback.setError(null)
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
  async function send(entry: ChatWorkspace, retry: boolean) {
    if (entry.pendingStart) throw new Error('Recheck status to recover the previous send before continuing.')
    const context = retry ? undefined : ctx.captureContext?.(entry.sessionId) ?? { kind: 'session' as const }
    const selection = { ...ctx.selection }
    if (selection.modelWritePending?.()) throw new Error('Wait for the model preference to finish saving.')
    if (ctx.noteRecovery.has(entry.sessionId)) throw new Error('Recover the canonical Note before continuing Chat.')
    if (chatIsWorking(entry.job)) throw new Error('Wait for the active turn or cancel it.')
    if (!ctx.provider?.available) throw new Error(ctx.provider?.reason ?? 'AI provider readiness is unavailable.')
    if (ctx.providerWarning) throw new Error(ctx.providerWarning)
    if (entry.imageFailures.length) throw new Error('Retry or remove failed images before sending.')
    if (!entry.chat) await hydrate(entry)
    if (entry.retired) return
    if (!entry.chat) throw new Error('Chat could not be loaded. Reopen the Session to try again.')
    if (entry.chat.submission) throw new Error('Start a new conversation to continue after submission.')
    const reason = unresolvedChatReason(entry.chat, retry)
    if (reason) throw new Error(reason)
    if (retry && (entry.composer.length > 0 || entry.composerImages.length > 0)) throw new Error('Clear the composer before retrying the failed turn.')
    if (!retry && !entry.composer.trim() && !entry.composerImages.length) throw new Error('Enter a message or attach an image before sending.')
    if (!await saveComposer(entry)) return
    if (entry.retired) return
    if (selection.modelWritePending?.()) throw new Error('Wait for the model preference to finish saving.')
    const chat = entry.chat
    const inputVersion = entry.inputVersion
    const modeVersion = entry.modeVersion
    let result: StartChatJobResult
    entry.pendingStart = { state: 'starting' }
    ++entry.refreshEpoch
    try {
      result = await startChatJob({ scope: chatScope(chat), retry, context,
        provider: selection.selectedProvider, model: selection.selectedModel,
        reasoningEffort: selection.selectedReasoningEffort }, (status) => receiveStatus(entry, status))
      if (result.chat.sessionId !== entry.sessionId || result.chat.draftId !== chat.draftId
        || result.status.sessionId !== entry.sessionId || result.status.action !== 'chat') {
        throw new Error('Chat start returned an unexpected conversation.')
      }
    } catch (cause) {
      if (entry.retired) return
      entry.pendingStart = { state: 'uncertain' }
      // Preparation may have durably consumed the composer before spawning
      // failed. Recover that failed turn, never turn a second click into billing.
      await refresh(entry.sessionId)
      if (entry.chat?.draftId === chat.draftId) entry.composerImages = entry.chat.composerImages
      throw cause
    }
    if (entry.retired) return
    ++entry.refreshEpoch
    entry.pendingStart = null
    entry.composerImages = result.chat.composerImages
    acceptChat(entry, result.chat, inputVersion, modeVersion)
    observeJob(result.status, true)
    if (entry.job && !chatIsWorking(entry.job)) await refresh(entry.sessionId)
  }
  const onSend = () => run('send', (entry) => send(entry, false))
  const onRetry = () => run('retry', (entry) => send(entry, true))
  const { onDecidePermission, onRecheck } = permissions
  const onCancel = () => run('cancel', async (entry) => {
    if (!entry.job || !chatIsWorking(entry.job)) return
    const status = await cancelAiActionJob(entry.job.jobId)
    if (entry.retired) return
    if (status.sessionId !== entry.sessionId || status.action !== 'chat') throw new Error('Cancellation returned an unexpected Chat job.')
    observeJob(status)
    if (!chatIsWorking(status)) { polling.stop(status.jobId); await refresh(entry.sessionId) }
  })
  const onSubmit = () => run('submit', async (entry) => {
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
      await refresh(entry.sessionId, true)
      throw cause
    }
    if (entry.retired) return
    ++entry.refreshEpoch
    entry.chat = { ...entry.chat, submission: receipt, mode: 'write_note' }
    entry.mode = 'write_note'
    ++entry.modeVersion
    publish(entry)
    await refresh(entry.sessionId)
  })
  function captureRestart() {
    const entry = active()
    if (!entry?.chat || entry.pendingStart || entry.loading || entry.save || entry.operationKind || entry.permissionOperation
      || permissions.needsRecovery(entry) || ctx.noteRecovery.has(entry.sessionId) || chatIsWorking(entry.job)
      || entry.chat.messages.some(message => message.status === 'running')) return null
    const { job, inputVersion, modeVersion } = entry
    const restartVersion = restartVersions.get(entry)
    const epoch = activationEpoch
    return async () => {
      if (active() !== entry || activationEpoch !== epoch || restartVersions.get(entry) !== restartVersion || entry.job !== job
        || entry.inputVersion !== inputVersion || entry.modeVersion !== modeVersion || entry.loading
        || entry.operationKind || entry.permissionOperation || permissions.needsRecovery(entry)
        || ctx.noteRecovery.has(entry.sessionId)) return
      // onRestart owns the operation and drains an autosave started after capture.
      await onRestart()
    }
  }
  const onRestart = () => run('restart', async (entry) => {
    if (entry.pendingStart) throw new Error('Recheck status to recover the previous send before continuing.')
    if (ctx.noteRecovery.has(entry.sessionId)) throw new Error('Recover the canonical Note before starting a new conversation.')
    if (chatIsWorking(entry.job)) throw new Error('Cancel or finish the active turn before starting a new conversation.')
    if (!entry.chat) await hydrate(entry)
    if (!entry.chat) return
    const { inputVersion, modeVersion, job } = entry
    const epoch = activationEpoch
    const restartVersion = restartVersions.get(entry)
    const draftId = entry.chat.draftId
    const history = JSON.stringify([entry.chat.messages, entry.chat.submission])
    if (!await saveComposer(entry)) return
    if (entry.retired || active() !== entry || activationEpoch !== epoch
      || restartVersions.get(entry) !== restartVersion || entry.inputVersion !== inputVersion || entry.modeVersion !== modeVersion || entry.job !== job
      || entry.loading || entry.permissionOperation || permissions.needsRecovery(entry)
      || ctx.noteRecovery.has(entry.sessionId) || entry.chat?.draftId !== draftId
      || JSON.stringify([entry.chat.messages, entry.chat.submission]) !== history) return
    const next = await restartChat({ scope: chatScope(entry.chat) })
    if (entry.retired) return
    ++entry.refreshEpoch
    if (entry.job) {
      const previous = supersededJobs.get(entry) ?? new Set<string>()
      previous.add(entry.job.jobId)
      supersededJobs.set(entry, previous)
    }
    entry.job = null
    entry.composer = ''
    entry.composerImages = []
    clearImageFailures(entry)
    ++entry.inputVersion
    acceptChat(entry, next, entry.inputVersion, entry.modeVersion)
    entry.mode = 'chat'
    ++entry.modeVersion
    publish(entry)
    await saveComposer(entry)
  })
  async function flush(): Promise<boolean> {
    for (const entry of workspaces.values()) {
      if (entry.operation) await entry.operation
      if (entry.retired) continue
      if (ctx.noteRecovery.has(entry.sessionId) && !await recoverNote(entry)) return false
      if (!await saveComposer(entry)) return false
    }
    return !hasPendingChanges()
  }
  function hasPendingChanges() {
    return ctx.noteRecovery.hasPending()
      || Array.from(workspaces.values()).some((entry) => !entry.retired && (
        ctx.noteRecovery.has(entry.sessionId) || chatIsDirty(entry) || entry.imageFailures.length > 0 || Boolean(entry.pendingStart || entry.save || entry.operationKind)))
  }
  function activate(sessionId: string | null) {
    if (disposed || activatedSessionId !== sessionId) {
      ++activationEpoch
    }
    activatedSessionId = sessionId
    disposed = false
    if (!sessionId || ctx.noteRecovery.isRetired(sessionId)) { ctx.publish(emptyChatSnapshot); return }
    const entry = workspace(sessionId)
    publish(entry)
    void hydrate(entry)
    if (entry.job) polling.watch(entry.job)
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
    const entry = workspaces.get(sessionId)
    if (!entry) return
    entry.retired = true
    entry.permissionOperation = null
    ++entry.refreshEpoch
    clearAutosave(entry)
    if (entry.job) polling.stop(entry.job.jobId)
    entry.resolveRetirement()
    workspaces.delete(sessionId)
  }
  function recoverNote(entry: ChatWorkspace): Promise<boolean> {
    if (entry.retired || !ctx.noteRecovery.has(entry.sessionId)) return Promise.resolve(true)
    if (entry.recovery) return entry.recovery
    const inputVersion = entry.chat && !chatInputIsDirty(entry) ? entry.inputVersion : -1
    const pending = Promise.race([(async () => {
      try {
        const chat = await recoverChatCanonicalNote(ctx, entry.sessionId)
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
    const entry = workspace(sessionId)
    // Session re-selection is a public recovery path. It must share the
    // handoff's operation boundary rather than unlock a still-pending submit.
    if (entry.operation) await entry.operation
    if (entry.retired) return true
    return recoverNote(entry)
  }
  return { activate, dispose, observeJob, flush, hasPendingChanges, setMode, retire, recoverSession,
    onSetComposer, onAttachImages, onPasteNativeImage, onRemoveImage, onRetryImage, onDismissImageFailure, onSend, onRetry, onCancel, onSubmit,
    onRestart, captureRestart, onDecidePermission, onRecheck, isCurrentPermissionScope }
}
