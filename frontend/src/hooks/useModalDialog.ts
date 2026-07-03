import { useEffect, useRef } from 'react'

/**
 * Opens a native `<dialog>` as a modal and routes `Escape`/backdrop-cancel
 * semantics to `onCancel`. Native `showModal()` provides focus-in, Tab
 * cycling, and background inerting (W3C H102) without any hand-rolled focus
 * trap.
 *
 * The dialog's own `close()` is never called by this hook: closing is left to
 * the caller unmounting the dialog once `onCancel`/`onConfirm` updates state.
 * We intercept the `cancel` event (fired for Escape) and prevent its default
 * so the native close-the-dialog steps don't race the React unmount. Because
 * we prevent that default, the browser's own focus-return-on-close (which is
 * part of those steps) never runs either, so we restore focus to the
 * previously-focused element ourselves on cleanup.
 *
 * Attach the returned ref to the `<dialog>` element.
 */
export function useModalDialog<T extends HTMLDialogElement = HTMLDialogElement>(onCancel: () => void) {
  const dialogRef = useRef<T | null>(null)
  // Read `onCancel` through a ref so the open effect does not re-run (and
  // re-open/re-steal focus) when the caller passes a fresh closure each render.
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    if (!dialog.open) dialog.showModal()

    function handleCancel(event: Event) {
      event.preventDefault()
      onCancelRef.current()
    }

    dialog.addEventListener('cancel', handleCancel)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      // Return focus to the trigger that opened the dialog, if it still exists.
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [])

  return dialogRef
}
