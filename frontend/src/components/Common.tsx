import { useState } from 'react'
import { Bug, Check, CheckCircle2, Loader2, Save, type LucideIcon } from 'lucide-react'
import { ActionButton } from './ActionButton'
import type { BusyAction, SettingsSaveState } from '../ui/types'

export function StatePanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="empty-collection state-panel">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <button className="secondary-button" type="button" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  )
}

export function EmptyCollection({
  icon,
  title,
  description = 'There is nothing to show yet.',
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}) {
  return <StatePanel icon={icon} title={title} description={description} action={action} />
}

export function RailItem({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button className={active ? 'rail-item active' : 'rail-item'} type="button" aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
      {typeof count === 'number' ? <strong>{count}</strong> : null}
    </button>
  )
}

export function SaveSettingsButton({
  label,
  busyAction,
  disabled,
  state,
  error,
  onSave,
}: {
  label: string
  busyAction: BusyAction | null
  disabled: boolean
  state: SettingsSaveState
  error?: string | null
  onSave: () => Promise<unknown>
}) {
  const saving = busyAction === 'save-settings' || state === 'saving'
  const saved = state === 'saved' && !saving
  const failed = state === 'error' && !saving
  const actionLabel = failed ? 'Try again' : label
  const [pendingLabel, setPendingLabel] = useState(label)

  return (
    <div className="settings-save-feedback">
      <span className="settings-save-status" role="status">
        {saved ? <><CheckCircle2 size={16} aria-hidden="true" />Saved</> : null}
      </span>
      <ActionButton variant="primary" icon={Save} loading={saving} disabled={disabled} onClick={() => { setPendingLabel(actionLabel); void onSave() }}>
        {saving ? pendingLabel : actionLabel}
      </ActionButton>
      {failed ? <p className="settings-save-error" role="alert">{error ?? 'Could not save settings. Your changes are still here.'}</p> : null}
    </div>
  )
}

export function StatusPill({ notice, error, busyAction }: { notice: string | null; error: string | null; busyAction: BusyAction | null }) {
  if (error) {
    return (
      <p className="status-pill error" role="alert">
        <Bug size={16} />
        {error}
      </p>
    )
  }

  if (busyAction === 'save-title' || busyAction === 'save-body') {
    return (
      <p className="status-pill busy" role="status" aria-live="polite">
        <Loader2 className="spin" size={16} />
        Saving note
      </p>
    )
  }

  return (
    <p className="status-pill saved" role="status" aria-live="polite">
      <Check size={16} />
      {notice ?? 'Note saved'}
    </p>
  )
}
