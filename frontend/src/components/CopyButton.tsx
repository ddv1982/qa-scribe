import { CheckCircle2, type LucideIcon } from 'lucide-react'
import { ActionButton } from './ActionButton'

/**
 * A quiet copy icon for the top-right corner of what it copies. Its tooltip names the action,
 * and says it worked, shown without hover, for as long as `copied` is set. The message lines up
 * with the button's right edge, so at the window's right edge it stays inside the window.
 */
export function CopyButton({ icon, label, copiedLabel, tooltip, pendingTooltip, copiedTooltip = 'Copied', pending = false, copied, disabled, size, onCopy }: {
  icon: LucideIcon
  label: string
  copiedLabel: string
  tooltip: string
  pendingTooltip?: string
  copiedTooltip?: string
  pending?: boolean
  copied: boolean
  disabled?: boolean
  size?: 'regular' | 'compact'
  onCopy: () => void
}) {
  return <ActionButton variant="quiet" size={size} iconOnly icon={copied ? CheckCircle2 : icon} className="copy-button"
    aria-label={copied ? copiedLabel : label}
    tooltip={copied ? copiedTooltip : pending && pendingTooltip ? pendingTooltip : tooltip}
    tooltipAlign="end" tooltipOpen={copied} data-copied={copied || undefined}
    loading={pending} disabled={disabled} onClick={onCopy} />
}
