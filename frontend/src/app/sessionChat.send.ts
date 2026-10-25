import { startChatJob, type ChatRequestIntent, type ChatState, type GenerationJobStatus, type StartChatJobResult } from '../tauri'
import { chatIsWorking, chatScope, unresolvedChatReason, type ChatWorkspace, type SessionChatContext } from './sessionChat.types'
import { actionRequestText, occupiedChoiceReason, questionReason, sameChatTarget } from './sessionChat.questions'

type Dependencies = {
  active: () => ChatWorkspace | null
  run: (kind: string, action: (entry: ChatWorkspace) => Promise<void>) => Promise<void>
  saveComposer: (entry: ChatWorkspace) => Promise<boolean>
  hydrate: (entry: ChatWorkspace) => Promise<void>
  refresh: (id: string) => Promise<void>
  publish: (entry: ChatWorkspace) => void
  acceptChat: (entry: ChatWorkspace, chat: ChatState, inputVersion: number, modeVersion: number) => void
  receiveStatus: (entry: ChatWorkspace, status: GenerationJobStatus) => void
  observeJob: (status: GenerationJobStatus, authoritative?: boolean) => void
  onSetComposer: (text: string) => void
}
export function createChatSend(ctx: SessionChatContext, dependencies: Dependencies) {
  const { run, saveComposer, hydrate, refresh, publish, acceptChat, receiveStatus, observeJob } = dependencies
  async function send(entry: ChatWorkspace, intent: ChatRequestIntent) {
    const retry = intent.kind === 'retry'
    const direct = intent.kind === 'question_reply'
    const startVersion = entry.inputVersion
    if (direct && (entry.composer !== '' || entry.composerImages.length || entry.imageFailures.length)) throw new Error(occupiedChoiceReason)
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
    if (!retry && !direct && intent.kind !== 'draft_jira' && !entry.composer.trim() && !entry.composerImages.length) throw new Error('Enter a message or attach an image before sending.')
    if (direct && context) {
      const message = entry.chat.messages.find(item => item.id === intent.assistantMessageId)
      const reason = message ? questionReason(entry.chat.messages, message, context) : 'This question is no longer active.'
      if (reason) throw new Error(reason)
      if (!message?.response?.question?.choices.includes(intent.text)) throw new Error('This reply is not one of the displayed choices.')
    }
    if (!await saveComposer(entry)) return
    if (entry.retired) return
    if (direct) {
      const current = ctx.captureContext?.(entry.sessionId) ?? { kind: 'session' as const }
      if (!context || !sameChatTarget(context, current)) throw new Error('The source changed before replying. Your input is retained.')
      if (entry.inputVersion !== startVersion || entry.composer !== '' || entry.composerImages.length || entry.imageFailures.length) throw new Error(occupiedChoiceReason)
    }
    if (selection.modelWritePending?.()) throw new Error('Wait for the model preference to finish saving.')
    const chat = entry.chat
    const inputVersion = entry.inputVersion
    const modeVersion = entry.modeVersion
    let result: StartChatJobResult
    entry.pendingStart = { state: 'starting', intent }; publish(entry)
    ++entry.refreshEpoch
    try {
      result = await startChatJob({ scope: chatScope(chat), intent, context,
        provider: selection.selectedProvider, model: selection.selectedModel,
        reasoningEffort: selection.selectedReasoningEffort }, (status) => receiveStatus(entry, status))
      if (result.chat.sessionId !== entry.sessionId || result.chat.draftId !== chat.draftId
        || result.status.sessionId !== entry.sessionId || result.status.action !== 'chat') {
        throw new Error('Chat start returned an unexpected conversation.')
      }
    } catch (cause) {
      if (entry.retired) return
      entry.pendingStart = { state: 'uncertain', intent }
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
  const onSend = () => run('send', entry => send(entry, { kind: 'message' }))
  const onRefine = () => run('send', entry => send(entry, { kind: 'refine_record' }))
  const onDraftJira = () => run('send', entry => send(entry, { kind: 'draft_jira' }))
  const onRetry = () => run('retry', entry => send(entry, { kind: 'retry' }))
  const onAnswerQuestion = (assistantMessageId: string, text: string) => run('send', entry => send(entry, { kind: 'question_reply', assistantMessageId, text }))
  const onPrepareAction = (assistantMessageId: string) => run('prepare-action', async entry => {
    if (entry.composer !== '' || entry.composerImages.length || entry.imageFailures.length) throw new Error(occupiedChoiceReason)
    if (entry.pendingStart || chatIsWorking(entry.job) || entry.chat?.submission || ctx.noteRecovery.has(entry.sessionId)) throw new Error('Wait until the conversation is ready. Your input is retained.')
    const message = entry.chat?.messages.find(item => item.id === assistantMessageId)
    const target = ctx.captureContext?.(entry.sessionId) ?? { kind: 'session' as const }
    if (!message || message.response?.purpose.kind !== 'jira_drafting' || message.response.question || message.response.warning) throw new Error('Review a completed Jira draft before preparing an action message.')
    const reason = questionReason(entry.chat?.messages ?? [], message, target)
    if (reason) throw new Error(reason)
    dependencies.onSetComposer(actionRequestText)
    await saveComposer(entry)
  })
  return { onSend, onRefine, onDraftJira, onRetry, onAnswerQuestion, onPrepareAction }
}
