import { useState, type KeyboardEvent } from 'react'
import { Command as CommandIcon } from 'lucide-react'
import { useModalDialog } from '../hooks/useModalDialog'
import type { AppCommand } from './commandRegistry'

export function PendingChangesDialog({
  recoveredSummaryConflict = false,
  isBusy,
  onCancel,
  onDiscard,
  onSave,
}: {
  recoveredSummaryConflict?: boolean
  isBusy: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  const dialogRef = useModalDialog(onCancel)
  const title = recoveredSummaryConflict ? 'Choose which Note to keep' : 'Save before leaving?'
  const body = recoveredSummaryConflict
    ? 'A recovered Summary replaced locally authored text. Restore the authored text, keep the visible generated Summary and its edits, or stay here. Keeping the Summary also discards any other unsaved changes.'
    : 'Explicit edits to Settings, Testware, or Findings have not been saved. Save them, discard them, or stay here.'
  return (
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="pending-changes-title">
      <div>
        <p className="eyebrow">{recoveredSummaryConflict ? 'Recovered Summary conflict' : 'Unsaved changes'}</p>
        <h2 id="pending-changes-title">{title}</h2>
        <p>{body}</p>
      </div>
      <div className="confirmation-actions pending-change-actions">
        <button className="secondary-button" type="button" disabled={isBusy} onClick={onCancel}>Cancel</button>
        <button className="danger-button" type="button" disabled={isBusy} onClick={onDiscard}>{recoveredSummaryConflict ? 'Keep generated Summary' : 'Discard changes'}</button>
        <button className="primary-button" type="button" disabled={isBusy} onClick={onSave}>{recoveredSummaryConflict ? 'Restore authored text' : 'Save and continue'}</button>
      </div>
    </dialog>
  )
}

export function CommandPalette({ commands, onClose }: { commands: AppCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const dialogRef = useModalDialog(onClose)
  const normalized = query.trim().toLocaleLowerCase()
  const matches = commands.filter((command) => !normalized
    || `${command.label} ${command.description} ${command.keywords.join(' ')}`.toLocaleLowerCase().includes(normalized))

  function run(command: AppCommand) {
    if (!command.available) return
    onClose()
    command.run()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    const options = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('.command-palette-list button:not(:disabled)') ?? [])
    if (options.length === 0) return
    event.preventDefault()
    options[event.key === 'ArrowUp' ? options.length - 1 : 0]?.focus()
  }

  return (
    <dialog ref={dialogRef} className="command-palette" aria-labelledby="command-palette-title">
      <div className="command-palette-search">
        <CommandIcon size={18} />
        <label>
          <span className="sr-only" id="command-palette-title">Command palette</span>
          <input type="search" aria-label="Search commands" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Type a command…" />
        </label>
        <kbd>Esc</kbd>
      </div>
      <div className="command-palette-list" role="listbox" aria-label="Commands">
        {matches.map((command) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={false}
            disabled={!command.available}
            onClick={() => run(command)}
            onKeyDown={focusListboxOption}
          >
            <span><strong>{command.label}</strong><small>{command.description}</small></span>
            {command.shortcut ? <kbd>{command.shortcut.display}</kbd> : null}
          </button>
        ))}
        {matches.length === 0 ? <p>No matching commands. Try “Settings,” “Testware,” or “refresh.”</p> : null}
      </div>
    </dialog>
  )
}

function focusListboxOption(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const listbox = event.currentTarget.closest('[role="listbox"]')
  const options = Array.from(listbox?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)') ?? [])
  if (options.length === 0) return
  const currentIndex = Math.max(0, options.indexOf(event.currentTarget))
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? options.length - 1
      : event.key === 'ArrowUp'
        ? Math.max(0, currentIndex - 1)
        : Math.min(options.length - 1, currentIndex + 1)
  event.preventDefault()
  options[nextIndex]?.focus()
}

export function DeleteConfirmationDialog({
  copy,
  isBusy,
  onCancel,
  onConfirm,
}: {
  copy: { title: string; body: string; confirmLabel: string }
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useModalDialog(onCancel)
  return (
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="delete-dialog-title">
      <div>
        <p className="eyebrow">Confirm delete</p>
        <h2 id="delete-dialog-title">{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <div className="confirmation-actions">
        <button className="secondary-button" type="button" disabled={isBusy} onClick={onCancel}>Cancel</button>
        <button className="primary-button danger-button" type="button" disabled={isBusy} onClick={onConfirm}>{copy.confirmLabel}</button>
      </div>
    </dialog>
  )
}
