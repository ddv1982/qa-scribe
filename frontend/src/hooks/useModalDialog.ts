import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement): HTMLElement[] {
  // `disabled`/`tabindex="-1"` are already excluded by the selector. We avoid an
  // `offsetParent`-based visibility filter because it is unreliable (it reports
  // `null` under jsdom and for `position: fixed` elements); the dialogs here
  // never contain hidden focusables, so element order is enough.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Keyboard/focus accessibility for a modal dialog with no new dependency:
 * - moves focus into the dialog on open and returns it to the trigger on close,
 * - `Escape` invokes `onCancel` (cancel semantics), and
 * - `Tab`/`Shift+Tab` cycle within the dialog (a simple focus trap).
 *
 * Attach the returned ref to the dialog element (the focus-trap root).
 */
export function useModalDialog<T extends HTMLElement = HTMLElement>(onCancel: () => void) {
  const dialogRef = useRef<T | null>(null)
  // Read `onCancel` through a ref so the open/close effect does not re-run (and
  // re-steal focus) when the caller passes a fresh closure each render.
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Move focus into the dialog: the first focusable control, else the dialog.
    const initial = focusableElements(dialog)[0] ?? dialog
    if (!dialog.hasAttribute('tabindex') && initial === dialog) dialog.tabIndex = -1
    initial.focus()

    function handleKeyDown(event: KeyboardEvent) {
      const current = dialogRef.current
      if (!current) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const focusables = focusableElements(current)
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Return focus to the trigger that opened the dialog, if it still exists.
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [])

  return dialogRef
}
