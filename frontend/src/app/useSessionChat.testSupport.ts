import type { ChatState, GenerationJobStatus } from '../bindings'

export function chatFixture(patch: Partial<ChatState> = {}): ChatState {
  return {
    sessionId: 'session-1', draftId: 'chat-1', revision: 0,
    composer: '', composerImages: [], mode: 'write_note', aiRuns: [], messages: [], submission: null,
    ...patch,
  }
}

export function completedChatFixture(patch: Partial<ChatState> = {}): ChatState {
  return chatFixture({
    revision: 3, mode: 'chat',
    messages: [
      { id: 'message-1', turnId: 'turn-1', role: 'user', text: 'Payment failed', images: [],
        status: 'completed', errorMessage: null, aiRunId: 'run-chat', createdAt: '2026-10-14T10:00:00Z' },
      { id: 'message-2', turnId: 'turn-1', role: 'assistant', text: 'Which build?', images: [],
        status: 'completed', errorMessage: null, aiRunId: 'run-chat', createdAt: '2026-10-14T10:00:01Z' },
    ],
    ...patch,
  })
}

export function chatJobFixture(patch: Partial<GenerationJobStatus> = {}): GenerationJobStatus {
  return {
    jobId: 'job-chat', sessionId: 'session-1', action: 'chat', state: 'running',
    progressMessage: 'Gathering information', aiRunId: 'run-chat', errorMessage: null,
    partialText: 'Which', ...patch,
  }
}
