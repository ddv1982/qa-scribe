import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { ActionButton } from './ActionButton'

/** Folds the record list away so the open record gets the full width, and brings it back. */
export function RecordListToggle({ visible, listId, onToggle }: { visible: boolean; listId: string; onToggle: () => void }) {
  const label = visible ? 'Hide list' : 'Show list'
  return (
    <ActionButton variant="quiet" iconOnly icon={visible ? PanelLeftClose : PanelLeftOpen} className="record-list-toggle"
      aria-label={label} tooltip={label} tooltipAlign="start" aria-expanded={visible} aria-controls={listId} onClick={onToggle} />
  )
}
