import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTranscript } from './chat-authorization-common.mjs'

test('text Chat fixtures read labelled replay without dropping message newlines', () => {
  const input = 'Instructions\nSESSION_CONTEXT_JSON\n"Context"\nMESSAGE user-1 User\nQuestion\n'
    + '\nMESSAGE assistant-1 Assistant\nWhich build and environment did you test?'
    + '\nMESSAGE user-2 User\nBuild 42\n'
  assert.deepEqual(parseTranscript(input, ['app-server']).messages, [
    { role: 'user', text: 'Question\n' },
    { role: 'assistant', text: 'Which build and environment did you test?' },
    { role: 'user', text: 'Build 42\n' },
  ])
})

test('legacy protocol fixture inputs retain JSON replay validation', () => {
  assert.deepEqual(parseTranscript('Instructions\nTRANSCRIPT_JSON\n{"messages":[{"role":"user","text":"Question"}]}', []).messages,
    [{ role: 'user', text: 'Question' }])
  assert.throws(() => parseTranscript('Instructions without any messages', []), /requires completed pairs/)
  assert.throws(() => parseTranscript('Instructions\nMESSAGE assistant-1 Assistant\nWrong role', []), /Invalid Chat role/)
})
