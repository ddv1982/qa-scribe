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
    expect(deriveChatHandoff(ready())).toEqual({ kind: 'conversation', disabled: false, reason: '', hydrationPending: false, reviewAvailable: true })
  })
  it.each([' ', '\n', 'Unsent question'])('allows saved review and blocks Add with composer %j', composer => {
    expect(deriveChatHandoff({ ...ready(), composer })).toEqual({ kind: 'conversation', disabled: false,
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
    expect(deriveChatHandoff(state)).toEqual({ kind: 'conversation', disabled: false, reason: '', hydrationPending: false, reviewAvailable: true })
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
  it.each(['loading', 'working', 'permissionWorking', 'permissionRecoveryPending'] as const)('never advertises success while %s', flag => {
    expect(deriveChatHandoff({ ...ready(), chat: completedChatFixture({ submission: receipt }), [flag]: true })).toEqual({
      kind: 'settling', reason: 'Wait until the conversation is ready to add.', hydrationPending: false, reviewAvailable: false,
    })
  })
  it.each(['', 'Unsent question'])('keeps completed review and its explanation stable during autosave with composer %j', composer => {
    const input = { ...ready(), composer }
    const before = deriveChatHandoff(input)
    expect(deriveChatHandoff({ ...input, saving: true })).toEqual({ ...before, disabled: true })
    expect(deriveChatHandoff({ ...input, saving: false })).toEqual(before)
  })
  it('retains a coherent submitted receipt during autosave', () => {
    expect(deriveChatHandoff({ ...ready(), saving: true, chat: completedChatFixture({ submission: receipt }) })).toEqual({
      kind: 'added', hydrationPending: false, reviewAvailable: true,
    })
  })
  it.each(['starting', 'running', 'cancelling'] as const)('blocks review and Add during an active %s job even while saving', jobState => {
    expect(deriveChatHandoff({ ...ready(), saving: true, job: chatJobFixture({ state: jobState }) })).toMatchObject({
      kind: 'settling', reviewAvailable: false,
    })
  })
  it('keeps unsafe histories unavailable even during a composer save', () => {
    const failed = completedChatFixture()
    failed.messages[1].status = 'failed'
    for (const patch of [
      { sessionId: 'other' }, { loading: true }, { working: true },
      { permissionWorking: true }, { permissionRecoveryPending: true }, { recoveryPending: true },
      { chat: failed }, { job: chatJobFixture({ state: 'completed', aiRunId: 'not-hydrated' }) },
      { chat: completedChatFixture({ submission: { ...receipt, draftId: 'stale' } }) },
    ]) {
      expect(deriveChatHandoff({ ...ready(), saving: true, ...patch }).reviewAvailable).toBe(false)
    }
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

it('a foreign same-Session completed job cannot delay or authorize Notes handoff', () => {
  const state = ready()
  const job = chatJobFixture({ state: 'completed', aiRunId: 'foreign-run', chat: { reference: { sessionId: 'session-1', draftId: 'record-A' } } })
  expect(deriveChatHandoff({ ...state, job })).toEqual(deriveChatHandoff(state))
})
it('Record ownership cannot authorize Notes handoff even for completed history', () => {
  const state = ready()
  const chat = { ...state.chat, owner: { kind: 'record' as const, sessionId: 'session-1', record: { kind: 'finding' as const, recordId: 'A' } } }
  expect(deriveChatHandoff({ ...state, chat }).kind).toBe('settling')
  expect(deriveChatHandoff({ ...state, chat }).reviewAvailable).toBe(false)
})
