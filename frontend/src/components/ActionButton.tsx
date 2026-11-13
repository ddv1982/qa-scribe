import type { ComponentProps, ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

export type ActionButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive-confirmation' | 'destructive-quiet'

type ActionButtonProps = ComponentProps<'button'> & {
  variant?: ActionButtonVariant
  size?: 'regular' | 'compact'
  loading?: boolean
  /** A short hover message shown below the button. It is decoration: the accessible name stays the label. */
  tooltip?: string
  /** Which button edge the message lines up with; `end` keeps it inside a right window edge, `start` a left one. */
  tooltipAlign?: 'center' | 'end' | 'start'
  /** Shows the message without hover, such as a Copied confirmation. */
  tooltipOpen?: boolean
} & (
  | { iconOnly: true; icon: LucideIcon; 'aria-label': string; children?: never }
  | { iconOnly?: false; icon?: LucideIcon; children: ReactNode }
)

export function ActionButton({
  variant = 'secondary',
  size = 'regular',
  loading,
  icon: Icon,
  iconOnly = false,
  tooltip,
  tooltipAlign = 'center',
  tooltipOpen = false,
  type = 'button',
  disabled,
  className = '',
  children,
  ...props
}: ActionButtonProps) {
  const Indicator = loading ? Loader2 : Icon
  return (
    <button
      {...props}
      title={tooltip ? undefined : props.title}
      data-tooltip={tooltip}
      data-tooltip-align={tooltip && tooltipAlign !== 'center' ? tooltipAlign : undefined}
      data-tooltip-open={tooltip && tooltipOpen ? '' : undefined}
      className={`action-button action-button--${variant} action-button--${size}${iconOnly ? ' action-button--icon-only' : ''} ${className}`.trim()}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {Icon || loading !== undefined ? (
        <span className="action-button-icon" aria-hidden="true">
          {Indicator ? <Indicator size={16} className={loading ? 'spin' : undefined} /> : null}
        </span>
      ) : null}
      {children}
    </button>
  )
}
