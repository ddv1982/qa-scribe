import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, saveCurrent, storageOutcome, editTitle } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each([['finding', false], ['finding', true], ['test_cases_draft', false], ['test_cases_draft', true]] as const)('%s nonconflict Undo remains saveable and confirmed writes advance the base; status failure %s', async (kind, statusFailure) => {
  const { result, record, base } = await open(kind)
  const storage = storageOutcome(record, kind)
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  if (statusFailure) api.resolveRefinement.mockRejectedValueOnce(new Error('Synthetic Undo status write failed'))
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  act(() => editTitle(result.current, kind, 'Saved after Undo'))
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Saved after Undo')
  expect(save.mock.calls.at(-1)?.[2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
  const nextBase = await recordWriteGuard(storage.read(), kind === 'finding' ? 'findings' : 'drafts')
  act(() => editTitle(result.current, kind, 'Saved after a confirmed write'))
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Saved after a confirmed write')
  expect(save.mock.calls.at(-1)?.[2]).toEqual(nextBase)
})
