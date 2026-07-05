import { Bug, Check, CheckCircle2, Loader2, Save, type LucideIcon } from 'lucide-react'
import type { BusyAction, SettingsSaveState } from '../ui/types'

export function EmptyCollection({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="empty-collection">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h2>{title}</h2>
    </div>
  )
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
  onSave,
}: {
  label: string
  busyAction: BusyAction | null
  disabled: boolean
  state: SettingsSaveState
  onSave: () => Promise<void>
}) {
  const saving = busyAction === 'save-settings' || state === 'saving'
  const saved = state === 'saved' && !saving
  const failed = state === 'error' && !saving
  const className = saved ? 'primary-button success-button' : failed ? 'primary-button danger-button' : 'primary-button'

  return (
    <button className={className} type="button" disabled={disabled || saving} onClick={() => void onSave()}>
      {saving ? <Loader2 className="spin" size={16} /> : saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
      {saving ? 'Saving...' : saved ? 'Saved' : failed ? 'Try again' : label}
    </button>
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
