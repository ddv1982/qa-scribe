import type { ComponentProps, ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

export type ActionButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive-confirmation' | 'destructive-quiet'

type ActionButtonProps = ComponentProps<'button'> & {
  variant?: ActionButtonVariant
  size?: 'regular' | 'compact'
  loading?: boolean
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
