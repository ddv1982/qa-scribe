/**
 * The slash menu's listbox. Focus stays in the editor, which points at the highlighted option
 * through `aria-activedescendant`; ArrowUp and ArrowDown move, Enter or Tab inserts.
 */
import type { SuggestionProps } from '@tiptap/suggestion'
import { useEffect, useId, useImperativeHandle, useState, type Ref } from 'react'
import type { SlashMenuItem } from './slashMenuItems'

export type SlashMenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean }

export type SlashMenuListProps = SuggestionProps<SlashMenuItem, SlashMenuItem> & { ref?: Ref<SlashMenuHandle> }

export function SlashMenuList({ editor, items, query, command, ref }: SlashMenuListProps) {
  const listId = useId()
  // The highlight starts at the first option again whenever the query changes.
  const [highlight, setHighlight] = useState({ query, index: 0 })
  const index = highlight.query === query ? Math.min(highlight.index, items.length - 1) : 0
  const active = items[index]
  const optionId = (item: SlashMenuItem) => `${listId}-${item.id}`
  const activeId = active ? optionId(active) : undefined
  const hasItems = items.length > 0

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
    if (!hasItems) return
    const dom = editor.view.dom
    dom.setAttribute('aria-controls', listId)
    dom.setAttribute('aria-autocomplete', 'list')
    return () => {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-autocomplete')
    }
  }, [editor, hasItems, listId])

  useEffect(() => {
    if (!activeId) return
    const dom = editor.view.dom
    dom.setAttribute('aria-activedescendant', activeId)
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' })
    return () => dom.removeAttribute('aria-activedescendant')
  }, [editor, activeId])

  if (!hasItems) return null
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
