import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'

type Control = ReactElement<{ 'aria-describedby'?: string }>

/**
 * A labelled form control. The label wraps the control, so the label text names it unless the
 * control sets its own `aria-label`. Hint text is linked to the control with `aria-describedby`.
 */
export function Field({ label, hint, className, children }: {
  label: ReactNode
  hint?: ReactNode
  className?: string
  children: Control
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const control = hint ? cloneElement(children, { 'aria-describedby': hintId }) : children
  return (
    <label className={className ? `field ${className}` : 'field'}>
      <span className="field-label">{label}</span>
      {control}
      {hint ? <span className="field-description" id={hintId}>{hint}</span> : null}
    </label>
  )
}
