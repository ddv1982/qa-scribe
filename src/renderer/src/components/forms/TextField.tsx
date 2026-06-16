import type { ReactElement } from 'react'

export function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  optional?: boolean
  multiline?: boolean
  error?: string | null
}): ReactElement {
  const invalid = Boolean(props.error)
  const label = `${props.label}${props.required ? ' (required)' : props.optional ? ' (optional)' : ''}`

  return (
    <label className="field">
      <span>{label}</span>
      {props.multiline ? (
        <textarea
          aria-invalid={invalid}
          aria-required={props.required}
          required={props.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input
          aria-invalid={invalid}
          aria-required={props.required}
          required={props.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {props.error ? <small className="field-error">{props.error}</small> : null}
    </label>
  )
}
