/**
 * jsdom (as of v29) does not implement `HTMLDialogElement.showModal()` /
 * `close()`, or dispatch the native `cancel`/`close` events — see
 * https://github.com/jsdom/jsdom/issues/3294. Real Tauri webviews
 * (WKWebView, WebKitGTK, WebView2) all support the native `<dialog>` API, so
 * this is a test-environment gap, not an app bug.
 *
 * This installs a minimal polyfill on `HTMLDialogElement.prototype` (loaded
 * globally via vite.config.ts `test.setupFiles`) so tests can exercise
 * `useModalDialog`'s real code path: `showModal()` sets `open` and moves
 * focus to the first focusable element (mirroring native behavior);
 * `close()` clears `open` and fires a `close` event.
 */
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '')
  const focusable = this.querySelector<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  ;(focusable ?? this).focus()
}

HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

/**
 * Simulates the browser invoking Escape-to-cancel on a native `<dialog>`:
 * fires a cancelable `cancel` event, then closes the dialog unless the app
 * prevented that default (which `useModalDialog` does, to control closing
 * via React state instead).
 */
export function simulateDialogCancel(dialog: HTMLDialogElement) {
  const event = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(event)
  if (!event.defaultPrevented) dialog.close()
}
