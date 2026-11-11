import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { useModalDialog } from '../hooks/useModalDialog'
import type { AppCommand } from './commandRegistry'

export function PendingChangesDialog({
  generationPending = false, onCancelGeneration,
  creationDraft = false, errorMessage = null,
  recoveredSummaryConflict = false,
  isBusy,
  onCancel,
  onDiscard,
  onSave,
}: {
  generationPending?: boolean
  onCancelGeneration?: () => void
  errorMessage?: string | null
  creationDraft?: boolean
  recoveredSummaryConflict?: boolean
  isBusy: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog(onCancel)
  useEffect(() => { cancelRef.current?.focus() }, [])
  const title = generationPending ? 'Generation is still running' : recoveredSummaryConflict ? 'Choose which Note to keep' : 'Save before leaving?'
  const body = generationPending ? 'Keep waiting, or cancel generation before settling this unsaved draft. A result that already committed stays saved.' : recoveredSummaryConflict
    ? 'A recovered Summary replaced locally authored text. Restore the authored text, keep the visible generated Summary and its edits, or stay here. Keeping the Summary also discards any other unsaved changes.'
    : creationDraft ? 'This draft is not saved yet. Save it, discard it, or keep editing.' : 'Explicit edits to Settings, Testware, or Findings have not been saved. Save them, discard them, or stay here.'
  return (
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="pending-changes-title">
      <div>
        <p className="eyebrow">{recoveredSummaryConflict ? 'Recovered Summary conflict' : 'Unsaved changes'}</p>
        <h2 id="pending-changes-title">{title}</h2>
        <p>{body}</p>
        {errorMessage ? <p className="inline-message blocking" role="alert">{errorMessage}</p> : null}
      </div>
      <div className="confirmation-actions pending-change-actions">
        {generationPending ? <>
          <ActionButton ref={cancelRef} disabled={isBusy} onClick={onCancel}>Keep waiting</ActionButton>
          <ActionButton variant="primary" disabled={isBusy} onClick={onCancelGeneration}>Cancel generation</ActionButton>
        </> : recoveredSummaryConflict ? (
          <>
            <ActionButton ref={cancelRef} disabled={isBusy} onClick={onCancel}>Cancel</ActionButton>
            <ActionButton variant="destructive-quiet" disabled={isBusy} onClick={onDiscard}>Keep generated Summary</ActionButton>
          </>
        ) : (
          <>
            <ActionButton variant="destructive-quiet" className="pending-change-discard" disabled={isBusy} onClick={onDiscard}>{creationDraft ? 'Discard draft' : 'Discard changes'}</ActionButton>
            <ActionButton ref={cancelRef} disabled={isBusy} onClick={onCancel}>Keep editing</ActionButton>
          </>
        )}
        {!generationPending ? <ActionButton variant="primary" disabled={isBusy} onClick={onSave}>{recoveredSummaryConflict ? 'Restore authored text' : creationDraft ? 'Save draft' : 'Save and continue'}</ActionButton> : null}
      </div>
    </dialog>
  )
}

/** Something the palette can open besides a command: a Session or a saved record. */
export type SearchTarget = {
  key: string
  group: 'Sessions' | 'Test cases' | 'Findings'
  label: string
  detail: string
  /** Lower-cased text the query is matched against. */
  text: string
  open: () => void
}

const targetGroups: Array<SearchTarget['group']> = ['Sessions', 'Test cases', 'Findings']
const targetsPerGroup = 5

export function CommandPalette({ commands, targets = [], onClose }: { commands: AppCommand[]; targets?: SearchTarget[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const dialogRef = useModalDialog(onClose)
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matchesTerms = (text: string) => terms.every((term) => text.includes(term))
  const matches = commands.filter((command) => matchesTerms(`${command.label} ${command.description} ${command.keywords.join(' ')}`.toLocaleLowerCase()))
  // Saved work appears once there is a query; an empty palette stays a short list of commands.
  const targetMatches = terms.length === 0 ? [] : targetGroups
    .map((group) => ({ group, items: targets.filter((target) => target.group === group && matchesTerms(target.text)).slice(0, targetsPerGroup) }))
    .filter(({ items }) => items.length > 0)

  function run(command: AppCommand) {
    if (!command.available) return
    onClose()
    command.run()
  }

  function open(target: SearchTarget) {
    onClose()
    target.open()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const options = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('.command-palette-list button:not(:disabled)') ?? [])
    if (event.key === 'Enter' && terms.length > 0) {
      event.preventDefault()
      options[0]?.click()
      return
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    if (options.length === 0) return
    event.preventDefault()
    options[event.key === 'ArrowUp' ? options.length - 1 : 0]?.focus()
  }

  return (
    <dialog ref={dialogRef} className="command-palette" aria-labelledby="command-palette-title">
      <div className="command-palette-search">
        <Search size={18} />
        <label>
          <span className="sr-only" id="command-palette-title">Command palette</span>
          <input type="search" aria-label="Search Sessions, records, and commands" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Search Sessions, test cases, findings, or commands…" />
        </label>
        <kbd>Esc</kbd>
      </div>
      <div className="command-palette-list" role="listbox" aria-label="Results">
        {targetMatches.map(({ group, items }) => (
          <div key={group} role="group" aria-label={group}>
            <p className="command-palette-group" aria-hidden="true">{group}</p>
            {items.map((target) => (
              <button key={target.key} type="button" role="option" aria-selected={false} onClick={() => open(target)} onKeyDown={focusListboxOption}>
                <span><strong>{target.label}</strong><small>{target.detail}</small></span>
              </button>
            ))}
          </div>
        ))}
        {matches.length > 0 ? (
          <div role="group" aria-label="Commands">
            {targetMatches.length > 0 ? <p className="command-palette-group" aria-hidden="true">Commands</p> : null}
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
          </div>
        ) : null}
        {matches.length === 0 && targetMatches.length === 0 ? <p>Nothing matches “{query.trim()}”. Try a Session name, a record title, or “Settings.”</p> : null}
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog(onCancel)
  useEffect(() => { cancelRef.current?.focus() }, [])
  return (
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="delete-dialog-title">
      <div>
        <p className="eyebrow">Confirm delete</p>
        <h2 id="delete-dialog-title">{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <div className="confirmation-actions">
        <ActionButton ref={cancelRef} disabled={isBusy} onClick={onCancel}>Cancel</ActionButton>
        <ActionButton variant="destructive-confirmation" disabled={isBusy} onClick={onConfirm}>{copy.confirmLabel}</ActionButton>
      </div>
    </dialog>
  )
}
