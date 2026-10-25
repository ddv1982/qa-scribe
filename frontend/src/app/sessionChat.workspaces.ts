import { getChat, type ChatRef, type ChatState, type ConversationOwner } from '../tauri'
import { emptyChatSnapshot, type ChatSnapshot, type ChatWorkspace, type SessionChatContext } from './sessionChat.types'

export function sameReference(a: ChatRef | null | undefined, b: ChatRef | null | undefined) {
  return Boolean(a && b && a.sessionId === b.sessionId && a.draftId === b.draftId)
}
export function statusOwns(entry: ChatWorkspace, status: import('../bindings').GenerationJobStatus) {
  return status.action === 'chat' && status.sessionId === entry.sessionId && sameReference(status.chat?.reference, entry.reference)
}
export function createChatWorkspaces(ctx: SessionChatContext, changed: (entry: ChatWorkspace) => void) {
  const workspaces = new Map<string, ChatWorkspace>()
  const notesBySession = new Map<string, ChatRef>()
  const notesLoads = new Map<string, Promise<ChatWorkspace | null>>()
  const notesInput = new Map<string, { composer?: string; mode?: import('../bindings').ChatMode }>()
  const retired = new Set<string>()
  let selected: ChatRef | null = null
  let epoch = 0
  function workspace(reference: ChatRef, owner: ConversationOwner | null = null): ChatWorkspace {
    const existing = workspaces.get(reference.draftId)
    if (existing) {
      if (!sameReference(existing.reference, reference)) throw new Error('Chat returned an unexpected conversation.')
      return existing
    }
    let resolveRetirement = () => {}
    const retirement = new Promise<void>(resolve => { resolveRetirement = resolve })
    const value: ChatWorkspace = { reference: Object.freeze({ ...reference }), owner, sessionId: reference.sessionId,
      chat: null, composer: '', composerIntent: { kind: 'message' }, composerImages: [], imageFailures: [], pendingStart: null, mode: owner?.kind === 'notes' ? 'write_note' : 'chat', inputVersion: 0,
      modeVersion: 0, refreshEpoch: 0, loading: false, error: null, job: null, hydration: null, save: null, operation: null, operationKind: null,
      permissionOperation: null, autosaveTimer: null, retired: retired.has(reference.sessionId), retirement, resolveRetirement, recovery: null }
    workspaces.set(reference.draftId, value)
    return value
  }
  function current(entry: ChatWorkspace) {
    return !entry.retired && !retired.has(entry.sessionId) && !ctx.noteRecovery.isRetired(entry.sessionId) && workspaces.get(entry.reference.draftId) === entry
  }
  function visible(entry: ChatWorkspace) {
    return current(entry) && ctx.session.activeSessionIdRef.current === entry.sessionId && sameReference(selected, entry.reference)
  }
  function select(reference: ChatRef | null) {
    if (!sameReference(selected, reference) || !reference) ++epoch
    selected = reference
  }
  function active() { return selected ? workspaces.get(selected.draftId) ?? null : null }
  async function notes(sessionId: string): Promise<ChatWorkspace | null> {
    const reference = notesBySession.get(sessionId)
    if (reference) return workspace(reference)
    const pending = notesLoads.get(sessionId)
    if (pending) return pending
    const load = (async () => {
      const chat = await getChat(sessionId)
      if (retired.has(sessionId) || ctx.noteRecovery.isRetired(sessionId)) return null
      if (chat.sessionId !== sessionId || chat.owner.kind !== 'notes' || chat.owner.sessionId !== sessionId) throw new Error('Notes returned an unexpected conversation.')
      const entry = workspace({ sessionId, draftId: chat.draftId }, chat.owner)
      notesBySession.set(sessionId, entry.reference)
      initialize(entry, chat)
      const input = notesInput.get(sessionId)
      if (input?.composer !== undefined) { entry.composer = input.composer; ++entry.inputVersion }
      if (input?.mode !== undefined) { entry.mode = input.mode; ++entry.modeVersion }
      notesInput.delete(sessionId)
      return entry
    })().finally(() => { notesLoads.delete(sessionId) })
    notesLoads.set(sessionId, load)
    return load
  }
  function initialize(entry: ChatWorkspace, chat: ChatState) {
    entry.chat = chat; entry.owner = chat.owner; entry.composer = chat.composer; entry.composerIntent = chat.composerIntent
    entry.composerImages = chat.composerImages; entry.mode = chat.mode
    changed(entry)
  }
  function buffer(input: { composer?: string; mode?: import('../bindings').ChatMode }) {
    const sessionId = ctx.session.activeSessionIdRef.current
    if (!sessionId || selected || notesBySession.has(sessionId) || retired.has(sessionId)) return false
    notesInput.set(sessionId, { ...notesInput.get(sessionId), ...input })
    ctx.publish(previous => ({ ...previous, ...input, dirty: true }))
    return true
  }
  function retire(sessionId: string) {
    retired.add(sessionId); notesInput.delete(sessionId); notesBySession.delete(sessionId)
  }
  function loading(sessionId: string) { ctx.publish({ ...emptyChatSnapshot, sessionId, loading: true, ...notesInput.get(sessionId) }) }
  function loadFailed(sessionId: string, error: string) {
    ctx.publish({ ...emptyChatSnapshot, sessionId, error, ...notesInput.get(sessionId), dirty: notesInput.has(sessionId) })
    ctx.feedback.setError(error)
  }
  return { workspaces, notesBySession, notes, workspace, current, visible, active, select, retire, buffer, loading, loadFailed,
    epoch: () => epoch, selected: () => selected, pendingInputs: () => notesInput.size > 0,
    async flushNotes() { await Promise.allSettled(notesLoads.values()) } }
}

export type ConversationAttention = {
  reference: ChatRef
  owner: ConversationOwner | null
  snapshot: ChatSnapshot
}
