/**
 * The slash menu: typing `/` in the editor lists the blocks it can insert, filtered by what
 * follows (see `slashMenuItems.ts`). Escape closes it, through the suggestion plugin.
 */
import { Extension, type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { slashMenuItems, type SlashMenuItem } from './slashMenuItems'
import { SlashMenuList, type SlashMenuHandle, type SlashMenuListProps } from './SlashMenuList'

function renderSlashMenu() {
  let component: ReactRenderer<SlashMenuHandle, SlashMenuListProps> | null = null
  let unmount: (() => void) | null = null
  return {
    onStart: (props: SuggestionProps<SlashMenuItem, SlashMenuItem>) => {
      component = new ReactRenderer(SlashMenuList, { props, editor: props.editor })
      unmount = props.mount(component.element)
    },
    onUpdate: (props: SuggestionProps<SlashMenuItem, SlashMenuItem>) => component?.updateProps(props),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => component?.ref?.onKeyDown(event) ?? false,
    onExit: () => {
      unmount?.()
      component?.destroy()
      component = null
      unmount = null
    },
  }
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashMenuItem, SlashMenuItem>({
        pluginKey: new PluginKey('slashMenu'),
        editor: this.editor,
        char: '/',
        // A code block holds literal text, so `/` stays a character there.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ editor, query }: { editor: Editor; query: string }) => slashMenuItems(editor, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: renderSlashMenu,
      }),
    ]
  },
})
