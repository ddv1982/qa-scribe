import { describe, expect, it } from 'vitest'
import { deriveChatHandoff } from './sessionChat.presentation'
import { chatJobFixture, completedChatFixture } from './useSessionChat.testSupport'

const ready = () => ({
  sessionId: 'session-1', noteEntry: { id: 'note-1', sessionId: 'session-1' },
  chat: completedChatFixture(), composer: '', job: null, loading: false, saving: false, working: false,
})
const receipt = { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'saved' }

describe('derived Chat handoff', () => {
  it('allows completed saved history independent of local mode dirty state', () => {
    expect(deriveChatHandoff(ready())).toEqual({ kind: 'conversation', reason: '', hydrationPending: false, reviewAvailable: true })
  })
  it.each([' ', '\n', 'Unsent question'])('allows saved review and blocks Add with composer %j', composer => {
    expect(deriveChatHandoff({ ...ready(), composer })).toEqual({ kind: 'conversation',
      reason: 'Send or clear the unsent message before adding the conversation.', hydrationPending: false, reviewAvailable: true })
  })
  it.each([null, 'other-run'])('waits for an associated run with empty partial text and job ID %j', aiRunId => {
    expect(deriveChatHandoff({ ...ready(), job: chatJobFixture({ state: 'completed', aiRunId, partialText: '' }) })).toEqual({
      kind: 'settling', reason: 'Waiting for the completed response to appear in saved conversation history.',
      hydrationPending: true, reviewAvailable: false,
    })
  })
  it('becomes ready only when the completed accepted assistant is associated', () => {
    const state = { ...ready(), job: chatJobFixture({ state: 'completed', partialText: 'Final' }) }
    const waiting = { ...state, chat: completedChatFixture({ messages: [state.chat.messages[0]] }) }
    expect(deriveChatHandoff(waiting).kind).toBe('settling')
    expect(deriveChatHandoff(state)).toEqual({ kind: 'conversation', reason: '', hydrationPending: false, reviewAvailable: true })
  })
  it('does not associate a running assistant or a user with a completed job', () => {
    const chat = completedChatFixture()
    chat.messages[1].status = 'running'
    expect(deriveChatHandoff({ ...ready(), chat, job: chatJobFixture({ state: 'completed' }) }).hydrationPending).toBe(true)
  })
  it('ignores completed jobs from another Session or action for hydration', () => {
    for (const job of [chatJobFixture({ state: 'completed', sessionId: 'other' }), chatJobFixture({ state: 'completed', action: 'testware' })]) {
      expect(deriveChatHandoff({ ...ready(), job }).kind).toBe('conversation')
    }
  })
  it.each(['loading', 'saving', 'working', 'permissionWorking', 'permissionRecoveryPending'] as const)('never advertises success while %s', flag => {
    expect(deriveChatHandoff({ ...ready(), chat: completedChatFixture({ submission: receipt }), [flag]: true })).toEqual({
      kind: 'settling', reason: 'Wait until the conversation is ready to add.', hydrationPending: false, reviewAvailable: false,
    })
  })
  it('requires coherent active Session, receipt draft, and React-state Note identity', () => {
    const state = { ...ready(), chat: completedChatFixture({ submission: receipt }) }
    expect(deriveChatHandoff(state)).toEqual({ kind: 'added', hydrationPending: false, reviewAvailable: true })
    for (const patch of [
      { sessionId: 'other' }, { noteEntry: null }, { noteEntry: { id: 'other', sessionId: 'session-1' } },
      { noteEntry: { id: 'note-1', sessionId: 'other' } },
      { chat: completedChatFixture({ submission: { ...receipt, draftId: 'other' } }) },
    ]) {
      const output = deriveChatHandoff({ ...state, ...patch })
      expect(output.kind).toBe('settling')
      expect(output.reviewAvailable).toBe(false)
    }
  })
  it('gives independent Note protection priority over a coherent receipt', () => {
    const output = deriveChatHandoff({ ...ready(), chat: completedChatFixture({ submission: receipt }), recoveryPending: true })
    expect(output.kind).toBe('recover')
    expect(output.reviewAvailable).toBe(false)
    expect(output).toMatchObject({ disabled: false, reason: 'The conversation was saved, but the Session Note could not be refreshed. The stale Note is write-protected until recovery completes. Recovery reloads the saved Note without adding again.' })
  })
  it('blocks review of failed or empty accepted history', () => {
    const chat = completedChatFixture()
    chat.messages[0].status = 'failed'
    expect(deriveChatHandoff({ ...ready(), chat })).toMatchObject({ kind: 'conversation', reviewAvailable: false,
      reason: 'Resolve unfinished turns before adding the conversation.' })
    expect(deriveChatHandoff({ ...ready(), chat: { ...chat, messages: [] } })).toMatchObject({ kind: 'conversation', reviewAvailable: false,
      reason: 'Complete a conversation before adding it to the note.' })
  })
})
