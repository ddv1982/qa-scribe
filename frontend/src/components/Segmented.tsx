import type { LucideIcon } from 'lucide-react'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: LucideIcon
  /** A pressed option with a tone shows a result colour instead of the raised pill. */
  tone?: 'success' | 'danger' | 'warning'
}

/**
 * A group of toggle buttons where at most one is pressed. With `allowDeselect`, pressing the
 * pressed option again reports null; without it, pressing the pressed option does nothing.
 */
export function Segmented<T extends string>({ label, options, value, onChange, allowDeselect = false, disabled = false }: {
  label: string
  options: ReadonlyArray<SegmentedOption<T>>
  value: T | null
  onChange: (value: T | null) => void
  allowDeselect?: boolean
  disabled?: boolean
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(({ value: option, label: optionLabel, icon: Icon, tone }) => {
        const pressed = option === value
        return (
          <button
            key={option}
            type="button"
            className={tone ? `segmented-option segmented-option--${tone}` : 'segmented-option'}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => {
              if (!pressed) onChange(option)
              else if (allowDeselect) onChange(null)
            }}
          >
            {Icon ? <Icon size={15} aria-hidden="true" /> : null}
            {optionLabel}
          </button>
        )
      })}
    </div>
  )
}
