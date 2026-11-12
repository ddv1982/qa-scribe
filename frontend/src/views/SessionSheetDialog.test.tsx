import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: () => <div role="textbox" aria-label="Note" />,
}))

import { recordCreationCommandsFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import type { Session } from '../tauri'
import { SessionEditorView } from './SessionEditorView'
import { SessionSheetDialog } from './SessionSheetDialog'

afterEach(cleanup)

const filledSheet: Partial<Session> = {
  objectiveNotes: 'Explore guest checkout to find payment failures',
  relatedReference: 'SHOP-42',
  timeboxMinutes: 45,
  debriefNotes: 'PayPal covered',
  testingPercent: 60,
  bugPercent: 25,
  setupPercent: 15,
}

function renderDialog(session = sessionFixture(), onSave = vi.fn(async () => undefined), onCancel = vi.fn()) {
  render(<SessionSheetDialog session={session} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

const field = (name: string) => screen.getByRole('textbox', { name })
const numberField = (name: string) => screen.getByRole('spinbutton', { name })
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('SessionSheetDialog', () => {
  it('opens on the charter, prefilled from the Session', () => {
    renderDialog(sessionFixture(filledSheet))
    const dialog = screen.getByRole('dialog', { name: 'Session sheet' })
    expect(dialog).toHaveAccessibleDescription('Optional. State what this Session explores, and wrap it up when you finish.')
    expect(field('Charter')).toHaveFocus()
    expect(field('Charter')).toHaveValue('Explore guest checkout to find payment failures')
    expect(field('Charter')).toHaveAccessibleDescription('What this Session sets out to explore.')
    expect(field('Ticket or reference')).toHaveValue('SHOP-42')
    expect(numberField('Timebox (minutes)')).toHaveValue(45)
    expect(screen.getByRole('group', { name: 'Debrief' })).toBeInTheDocument()
    expect(field('Debrief notes')).toHaveValue('PayPal covered')
    expect(numberField('Testing %')).toHaveValue(60)
    expect(numberField('Bug investigation %')).toHaveValue(25)
    expect(numberField('Setup %')).toHaveValue(15)
    expect(numberField('Setup %')).toHaveAccessibleDescription('The three add up to 100. Leave all empty to skip.')
  })

  it('saves the patch with blank fields cleared to null', async () => {
    const { onSave } = renderDialog(sessionFixture(filledSheet))
    type(field('Charter'), '  Explore refunds  ')
    type(field('Ticket or reference'), '   ')
    type(numberField('Timebox (minutes)'), '90')
    type(field('Debrief notes'), '')
    for (const name of ['Testing %', 'Bug investigation %', 'Setup %']) type(numberField(name), '')
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({
      objectiveNotes: 'Explore refunds',
      relatedReference: null,
      acceptanceCriteria: null,
      timeboxMinutes: 90,
      debriefNotes: null,
      testingPercent: null,
      bugPercent: null,
      setupPercent: null,
    })
  })

  it('numbers acceptance criteria without an id when it saves them', async () => {
    const { onSave } = renderDialog()
    const criteria = field('Acceptance criteria')
    expect(criteria).toHaveAttribute('placeholder', 'AC-1 Empty street shows an error')
    expect(criteria).toHaveAccessibleDescription('One per line. Lines without an id are numbered AC-1, AC-2, … when you save.')
    type(criteria, '  Empty street shows an error\n\nAC-1: Postcode is validated\nSHOP-412 Country\nAC-1 Duplicate  ')
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      acceptanceCriteria: 'AC-2 Empty street shows an error\nAC-1 Postcode is validated\nSHOP-412 Country\nAC-3 Duplicate',
    })))
  })

  it('clears acceptance criteria to null', async () => {
    const { onSave } = renderDialog(sessionFixture({ acceptanceCriteria: 'AC-1 Empty street' }))
    expect(field('Acceptance criteria')).toHaveValue('AC-1 Empty street')
    type(field('Acceptance criteria'), ' \n ')
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ acceptanceCriteria: null })))
  })

  it('keeps the dialog open when the acceptance criteria are too long', () => {
    const { onSave } = renderDialog()
    type(field('Acceptance criteria'), `AC-1 ${'x'.repeat(7996)}`)
    save()
    expect(screen.getByRole('alert')).toHaveTextContent('Acceptance criteria must be at most 8000 characters.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves a full debrief split', async () => {
    const { onSave } = renderDialog()
    type(numberField('Testing %'), '60')
    type(numberField('Bug investigation %'), '25')
    type(numberField('Setup %'), '15')
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      objectiveNotes: null, timeboxMinutes: null, testingPercent: 60, bugPercent: 25, setupPercent: 15,
    })))
  })

  it.each([
    [{ 'Timebox (minutes)': '0' }, 'Timebox must be a whole number of minutes from 1 to 1440.'],
    [{ 'Timebox (minutes)': '1441' }, 'Timebox must be a whole number of minutes from 1 to 1440.'],
    [{ 'Timebox (minutes)': '2.5' }, 'Timebox must be a whole number of minutes from 1 to 1440.'],
    [{ 'Testing %': '60', 'Setup %': '40' }, 'Fill in all three percentages, or leave all three empty.'],
    [{ 'Testing %': '150', 'Bug investigation %': '0', 'Setup %': '0' }, 'Each percentage must be a whole number from 0 to 100.'],
    [{ 'Testing %': '60', 'Bug investigation %': '25', 'Setup %': '10' }, 'The three percentages must add up to 100.'],
  ])('keeps the dialog open and explains %o', (values, message) => {
    const { onSave } = renderDialog()
    for (const [name, value] of Object.entries(values)) type(numberField(name), value)
    save()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Session sheet' })).toBeInTheDocument()
  })

  it('shows a save failure and lets the user try again', async () => {
    const onSave = vi.fn(async () => { throw new Error('Database is locked') })
    renderDialog(sessionFixture(), onSave)
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('discards on Cancel', () => {
    const { onSave, onCancel } = renderDialog()
    type(field('Charter'), 'Never saved')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})

function renderNote(session: Session, overrides: Partial<ComponentProps<typeof SessionEditorView>> = {}) {
  return render(<SessionEditorView creationCommands={{ finding: recordCreationCommandsFixture('finding'), testware: recordCreationCommandsFixture('testware') }}
    noteBodyHtml="<p>Body</p>" activeProviderAvailable activeSession={session} busyAction={null} canUndoLatestGeneration={false}
    copyState={{ status: 'idle' }} filteredSessions={[session]} isBusy={false} noteBody={richEditorDocumentFromHtml('<p>Body</p>')} noteIsReady
    noteScreenshotCount={0} sessionTitle={session.title} noteWordCount={1} notice={null} error={null} pendingAiActions={{}}
    onAiAction={async () => {}} onUndoLatestGeneration={async () => {}} onCopy={async () => {}} onCreateSession={() => {}} canCreateSession
    onDeleteSession={() => {}} onOpenSessionSheet={() => {}} onOpenSession={async () => {}} onSetNoteBody={() => {}} onSetSessionTitle={() => {}} onUploadImage={() => {}}
    {...overrides} />)
}

describe('Session sheet in the Session editor', () => {
  it('shows only the header button while the sheet is empty', () => {
    const onOpenSessionSheet = vi.fn()
    renderNote(sessionFixture(), { onOpenSessionSheet })
    expect(screen.queryByRole('button', { name: 'Edit Session sheet' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Session sheet' }))
    expect(onOpenSessionSheet).toHaveBeenCalledTimes(1)
  })

  it('shows the charter, timebox, reference and debrief state in one row that opens the sheet', () => {
    const onOpenSessionSheet = vi.fn()
    renderNote(sessionFixture(filledSheet), { onOpenSessionSheet })
    const row = screen.getByRole('button', { name: 'Edit Session sheet' })
    expect(row).toHaveTextContent('Explore guest checkout to find payment failures')
    expect(row).toHaveTextContent('45 min')
    expect(row).toHaveTextContent('SHOP-42')
    expect(row).toHaveTextContent('Debriefed')
    fireEvent.click(row)
    expect(onOpenSessionSheet).toHaveBeenCalledTimes(1)
  })

  it('counts acceptance criteria in the row, and criteria alone show it', () => {
    renderNote(sessionFixture({ acceptanceCriteria: 'AC-1 Empty street\nAC-2 Postcode' }))
    expect(screen.getByRole('button', { name: 'Edit Session sheet' })).toHaveTextContent('2 criteria')
    cleanup()
    renderNote(sessionFixture({ acceptanceCriteria: 'AC-1 Empty street' }))
    expect(screen.getByRole('button', { name: 'Edit Session sheet' })).toHaveTextContent(/^1 criterion$/)
  })

  it('shows a row for a timebox alone, without a debrief badge', () => {
    renderNote(sessionFixture({ timeboxMinutes: 30 }))
    const row = screen.getByRole('button', { name: 'Edit Session sheet' })
    expect(row).toHaveTextContent('30 min')
    expect(row).not.toHaveTextContent('Debriefed')
  })
})
