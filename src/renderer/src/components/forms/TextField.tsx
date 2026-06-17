import { useId, type ReactElement } from 'react'

export function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  id?: string
  required?: boolean
  optional?: boolean
  multiline?: boolean
  error?: string | null
}): ReactElement {
  const generatedId = useId()
  const fieldId = props.id ?? `text-field-${generatedId}`
  const errorId = `${fieldId}-error`
  const invalid = Boolean(props.error)
  const label = `${props.label}${props.required ? ' (required)' : props.optional ? ' (optional)' : ''}`

  return (
    <label className="field">
      <span>{label}</span>
      {props.multiline ? (
        <textarea
          aria-describedby={props.error ? errorId : undefined}
          aria-invalid={invalid}
          aria-required={props.required}
          id={fieldId}
          required={props.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input
          aria-describedby={props.error ? errorId : undefined}
          aria-invalid={invalid}
          aria-required={props.required}
          id={fieldId}
          required={props.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {props.error ? (
        <small className="field-error" id={errorId}>
          {props.error}
        </small>
      ) : null}
    </label>
  )
}
