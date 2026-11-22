import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { GenerationReadSourcesSetting } from './GenerationReadSourcesSetting'
import { settingsFixture } from '../test/fixtures'

vi.mock('./CodexAtlassianSignIn', () => ({ CodexAtlassianSignIn: () => <p>Codex sign-in row</p> }))

afterEach(cleanup)

it('starts with every read source off and turns sources on in a stable order', async () => {
  const user = userEvent.setup()
  const updateSettingsDraft = vi.fn()
  const { rerender } = render(<GenerationReadSourcesSetting settingsDraft={settingsFixture()} updateSettingsDraft={updateSettingsDraft} codexAvailable />)
  const group = screen.getByRole('group', { name: 'Generate may read' })
  expect(group).toHaveAccessibleDescription(/run without tools/)
  for (const name of ['Jira issues', 'Confluence pages', 'Teams channels', 'Teams chats']) {
    expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
  }

  await user.click(screen.getByRole('checkbox', { name: 'Teams chats' }))
  expect(updateSettingsDraft).toHaveBeenLastCalledWith({ generationReadSources: ['teamsChats'] })

  rerender(<GenerationReadSourcesSetting settingsDraft={{ ...settingsFixture(), generationReadSources: ['teamsChats'] }} updateSettingsDraft={updateSettingsDraft} codexAvailable />)
  await user.click(screen.getByRole('checkbox', { name: 'Jira issues' }))
  expect(updateSettingsDraft).toHaveBeenLastCalledWith({ generationReadSources: ['jira', 'teamsChats'] })

  rerender(<GenerationReadSourcesSetting settingsDraft={{ ...settingsFixture(), generationReadSources: ['jira', 'teamsChats'] }} updateSettingsDraft={updateSettingsDraft} codexAvailable />)
  await user.click(screen.getByRole('checkbox', { name: 'Jira issues' }))
  expect(updateSettingsDraft).toHaveBeenLastCalledWith({ generationReadSources: ['teamsChats'] })
})

it('shows the Codex sign-in only when Jira or Confluence is on', () => {
  const updateSettingsDraft = vi.fn()
  const { rerender } = render(<GenerationReadSourcesSetting settingsDraft={{ ...settingsFixture(), generationReadSources: ['teamsChats'] }} updateSettingsDraft={updateSettingsDraft} codexAvailable />)
  expect(screen.queryByText('Codex sign-in row')).toBeNull()
  expect(screen.getByRole('group', { name: 'Generate may read' })).toHaveAccessibleDescription(/Codex looks up Jira and Confluence/)
  rerender(<GenerationReadSourcesSetting settingsDraft={{ ...settingsFixture(), generationReadSources: ['confluence'] }} updateSettingsDraft={updateSettingsDraft} codexAvailable />)
  expect(screen.getByText('Codex sign-in row')).toBeTruthy()
  rerender(<GenerationReadSourcesSetting settingsDraft={{ ...settingsFixture(), generationReadSources: ['confluence'] }} updateSettingsDraft={updateSettingsDraft} codexAvailable={false} />)
  expect(screen.queryByText('Codex sign-in row')).toBeNull()
})
