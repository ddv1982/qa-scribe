import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanupControllerTest, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, currentRecord } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(['finding', 'test_cases_draft'] as const)('retains an applied %s suggestion when its conversation refresh fails', async kind => {
  const { result, readConversation } = await open(kind)
  const read = api.getConversation.getMockImplementation()!
  let reads = 0
  api.getConversation.mockImplementation(reference => ++reads === 1 ? read(reference) : Promise.reject(new Error('Conversation read unavailable')))
  await act(async () => { await expect(result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage')).resolves.toBeUndefined() })
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  expect(currentRecord(result.current, kind).body).toBe('<p>Refined expected result</p>')
  expect(readConversation('chat-session-1').proposals![0].state.kind).toBe('staged')
  expect(api.resolveRefinement).toHaveBeenCalledTimes(1)
  expect(result.current.sessionChat.proposalControls!.errors['proposal-1']).toContain('Conversation refresh failed')
  expect(result.current.sessionChat.proposalControls!.pending.size).toBe(0)
})

it('preserves the action error when its subsequent refresh also fails', async () => {
  const { result, record } = await open()
  const read = api.getConversation.getMockImplementation()!
  let reads = 0
  api.getConversation.mockImplementation(reference => ++reads === 1 ? read(reference) : Promise.reject(new Error('Conversation read unavailable')))
  api.resolveRefinement.mockRejectedValueOnce(new Error('Stage request rejected'))
  await act(async () => { await expect(result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage')).resolves.toBeUndefined() })
  expect(result.current.findings[0].title).toBe(record.title)
  expect(result.current.findings[0].body).toBe(record.body)
  expect(result.current.sessionChat.proposalControls!.errors['proposal-1']).toContain('Stage request rejected')
  expect(result.current.sessionChat.proposalControls!.pending.size).toBe(0)
  expect(api.resolveRefinement).toHaveBeenCalledTimes(1)
})
