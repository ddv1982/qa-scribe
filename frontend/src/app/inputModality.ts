const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

/**
 * Records on the root element whether the last input came from the keyboard or a pointer, so the
 * stylesheet can keep focus rings for keyboard use only. WebKit matches `:focus-visible` when a
 * script moves focus after a click, which drew a ring on dialog buttons nobody had tabbed to.
 */
export function trackInputModality(doc: Document = document) {
  const set = (modality: 'keyboard' | 'pointer') => { doc.documentElement.dataset.inputModality = modality }
  const onKeyDown = (event: KeyboardEvent) => { if (!MODIFIER_KEYS.has(event.key)) set('keyboard') }
  const onPointerDown = () => set('pointer')
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    doc.removeEventListener('keydown', onKeyDown, true)
    doc.removeEventListener('pointerdown', onPointerDown, true)
  }
}
