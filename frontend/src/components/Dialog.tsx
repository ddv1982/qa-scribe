import { useEffect, useId, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useModalDialog } from '../hooks/useModalDialog'

/**
 * A modal dialog: native `<dialog>` opened with `useModalDialog`, a header
 * (optional eyebrow, title, description) and a row of actions on the right.
 * Escape calls `onCancel`. Without `initialFocus`, `showModal()` focuses the
 * first focusable element; `'title'` focuses the heading itself.
 */
export function Dialog({
  title,
  titleId,
  eyebrow,
  description,
  headerClassName,
  className,
  actions,
  portal = false,
  initialFocus,
  onCancel,
  onKeyDown,
  children,
}: {
  title: ReactNode
  /** A stable id for the heading; generated when omitted. */
  titleId?: string
  eyebrow?: ReactNode
  /** Paragraphs under the title. They become the dialog's accessible description. */
  description?: ReactNode
  headerClassName?: string
  className?: string
  actions: ReactNode
  /** Render into `document.body`, outside any clipping or `inert` ancestor. */
  portal?: boolean
  initialFocus?: RefObject<HTMLElement | null> | 'title'
  onCancel: () => void
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>
  children?: ReactNode
}) {
  const generatedId = useId()
  const headingId = titleId ?? `${generatedId}-title`
  const descriptionId = `${headingId}-description`
  const dialogRef = useModalDialog(onCancel)
  useEffect(() => {
    if (initialFocus === 'title') dialogRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    else initialFocus?.current?.focus()
  }, [dialogRef, initialFocus])

  const dialog = (
    <dialog
      ref={dialogRef}
      className={className ? `confirmation-dialog ${className}` : 'confirmation-dialog'}
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
    >
      <div className={headerClassName}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={headingId} tabIndex={initialFocus === 'title' ? -1 : undefined}>{title}</h2>
        {description ? <div id={descriptionId}>{description}</div> : null}
      </div>
      {children}
      <div className="confirmation-actions">{actions}</div>
    </dialog>
  )
  return portal ? createPortal(dialog, document.body) : dialog
}
