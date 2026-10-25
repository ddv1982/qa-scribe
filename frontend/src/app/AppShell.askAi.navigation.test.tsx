import '@testing-library/jest-dom/vitest'
import { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { findingFixture } from '../test/fixtures'
import { chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, getTauriMock, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
let controller: ReturnType<typeof useAppController>
function Subject() { const current = useAppController(); useLayoutEffect(() => { controller = current }); return <AppShell {...current} /> }
beforeEach(() => { setupControllerTest(); api.listFindings.mockResolvedValue([findingFixture({ title: 'A source' }), findingFixture({ id: 'finding-2', title: 'B source', kind: 'risk' })]) })
afterEach(cleanupControllerTest)
async function setup() {
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: 'A saved input' } })
  act(() => controller.conversations.observeJob(chatJobFixture({ chat: { reference: controller.askAi.reference! } })))
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
  await screen.findByRole('button', { name: 'Recover Ask AI · A source' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'title' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Search Issues and risks' }), { target: { value: 'B source' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'risk' } })
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Finding title' }), { target: { value: 'B unsaved title' } })
}
async function requestA() {
  fireEvent.click(screen.getByRole('button', { name: 'Recover Ask AI · A source' }))
  return screen.findByRole('dialog', { name: /Save before leaving/ })
}
it('exact unfinished recovery protects the prior editor on Keep editing and failed Save before exact filtered reveal', async () => {
  await setup()
  const first = await requestA()
  fireEvent.click(within(first).getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveValue('B unsaved title')
  expect(screen.getByRole('textbox', { name: 'Search Issues and risks' })).toHaveValue('B source')
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('risk')
  expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  api.updateFinding.mockRejectedValueOnce(new Error('Synthetic failed Save'))
  const second = await requestA()
  fireEvent.click(within(second).getByRole('button', { name: 'Save and continue' }))
  await waitFor(() => expect(api.updateFinding).toHaveBeenCalledOnce())
  expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveValue('B unsaved title')
  expect(screen.getByRole('textbox', { name: 'Search Issues and risks' })).toHaveValue('B source')
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('risk')
  fireEvent.click(within(second).getByRole('button', { name: 'Discard changes' }))
  const input = await screen.findByRole('textbox', { name: 'Message' })
  expect(input).toHaveValue('A saved input')
  expect(screen.getByRole('region', { name: 'Chat source' })).toHaveTextContent('A source')
  expect(screen.getByRole('textbox', { name: 'Search Issues and risks' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('all')
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('title')
  expect(api.beginRecordChat).toHaveBeenCalledTimes(1)
  expect(api.startChatJob).not.toHaveBeenCalled()
})

it('Recovery on the current source keeps unsaved edits and non-excluding filters without asking to Save', async () => {
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: 'Return to this exact conversation' } })
  act(() => controller.conversations.observeJob(chatJobFixture({ chat: { reference: controller.askAi.reference! } })))
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
  await screen.findByRole('button', { name: 'Recover Ask AI · A source' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Search Issues and risks' }), { target: { value: 'A source' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'bug' } })
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Finding title' }), { target: { value: 'A source unsaved' } })
  fireEvent.click(screen.getByRole('button', { name: 'Recover Ask AI · A source unsaved' }))
  const continued = await screen.findByRole('textbox', { name: 'Message' })
  expect(continued).toBe(input)
  expect(continued).toHaveValue('Return to this exact conversation')
  expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveValue('A source unsaved')
  expect(screen.getByRole('textbox', { name: 'Search Issues and risks' })).toHaveValue('A source')
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('bug')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
})
