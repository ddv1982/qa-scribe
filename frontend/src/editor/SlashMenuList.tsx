/**
 * The slash menu's listbox. Focus stays in the editor, which points at the highlighted option
 * through `aria-activedescendant`; ArrowUp and ArrowDown move, Enter or Tab inserts.
 */
import type { SuggestionProps } from '@tiptap/suggestion'
import { useEffect, useId, useImperativeHandle, useState, type Ref } from 'react'
import type { SlashMenuItem } from './slashMenuItems'

export type SlashMenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean }

export type SlashMenuListProps = SuggestionProps<SlashMenuItem, SlashMenuItem> & { ref?: Ref<SlashMenuHandle> }

// The editor's own attributes are set through ProseMirror, which leaves these alone.
const editorAttributes = ['aria-controls', 'aria-activedescendant', 'aria-autocomplete'] as const

export function SlashMenuList({ editor, items, query, command, ref }: SlashMenuListProps) {
  const listId = useId()
  // The highlight starts at the first option again whenever the query changes.
  const [highlight, setHighlight] = useState({ query, index: 0 })
  const index = highlight.query === query ? Math.min(highlight.index, items.length - 1) : 0
  const active = items[index]
  const optionId = (item: SlashMenuItem) => `${listId}-${item.id}`

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0 || event.metaKey || event.ctrlKey || event.altKey) return false
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight({ query, index: (index + step + items.length) % items.length })
        return true
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && active) {
        command(active)
        return true
      }
      return false
    },
  }))

  useEffect(() => {
    const dom = editor.view.dom
    if (!active) return
    dom.setAttribute('aria-controls', listId)
    dom.setAttribute('aria-activedescendant', optionId(active))
    dom.setAttribute('aria-autocomplete', 'list')
    return () => editorAttributes.forEach((name) => dom.removeAttribute(name))
  })

  useEffect(() => {
    if (active) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  })

  if (items.length === 0) return null
  return (
    <div id={listId} className="slash-menu" role="listbox" aria-label="Insert block">
      {items.map((item, itemIndex) => (
        <div
          key={item.id}
          id={optionId(item)}
          className="slash-menu-option"
          role="option"
          aria-selected={itemIndex === index}
          // A pointer choice keeps the caret, and so the typed query, in the editor.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command(item)}
        >
          <item.icon size={16} aria-hidden="true" />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}
