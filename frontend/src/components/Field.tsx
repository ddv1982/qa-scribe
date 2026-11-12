import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'

type Control = ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>

/**
 * A labelled form control. The label wraps the control, so the label text names it unless the
 * control sets its own `aria-label`. Hint and error text are linked to the control with
 * `aria-describedby`; an error also marks it `aria-invalid`.
 */
export function Field({ label, hint, error, className, children }: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: Control
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ')
  const control = describedBy
    ? cloneElement(children, { 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : children
  return (
    <label className={className ? `field ${className}` : 'field'}>
      <span className="field-label">{label}</span>
      {control}
      {hint ? <span className="field-description" id={hintId}>{hint}</span> : null}
      {error ? <span className="field-error" id={errorId}>{error}</span> : null}
    </label>
  )
}
