// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { afterEach, describe, expect, it } from 'vitest'
import { richTextEditorExtensions } from './editorExtensions'

const editors: Editor[] = []

function createEditor(content: JSONContent) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    // Use production StarterKit, TaskList, and non-nested TaskItem configuration.
    extensions: richTextEditorExtensions(),
    content,
    // jsdom has no layout. Only skip scrolling, not document transactions.
    editorProps: { handleScrollToSelection: () => true },
  })
  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element as HTMLElement
    editor.destroy()
    element.remove()
  }
})

describe('list document identity', () => {
  it.each([
    { label: 'bullet list', list: 'bulletList', item: 'listItem' },
    { label: 'checklist', list: 'taskList', item: 'taskItem' },
  ])('toggles a paragraph into a $label, edits, undoes, and reloads JSON', ({ list, item }) => {
    const initial: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evidence' }] }],
    }
    const editor = createEditor(initial)
    const paragraph = editor.getJSON()
    const trailingParagraph: JSONContent = { type: 'paragraph' }
    expect(editor.commands.setTextSelection(1)).toBe(true)

    // These must run real wrapping commands. Duplicate prosemirror-model
    // instances throw here when one Fragment implementation receives another.
    const toggle = (target: Editor) => list === 'bulletList'
      ? target.commands.toggleBulletList()
      : target.commands.toggleTaskList()
    expect(toggle(editor)).toBe(true)
    const listed = editor.getJSON()
    expect(listed).toMatchObject({
      type: 'doc',
      content: [{
        type: list,
        content: [{
          type: item,
          ...(item === 'taskItem' ? { attrs: { checked: false } } : {}),
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evidence' }] }],
        }],
      }, trailingParagraph],
    })
    expect(listed.content?.[1]).toEqual(trailingParagraph)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(1)

    // End of text inside list > item > paragraph. Separate typing from the
    // toggle in history so undo must preserve the list and remove only the edit.
    const firstList = editor.state.doc.firstChild!
    expect(firstList.type.name).toBe(list)
    expect(editor.commands.setTextSelection(firstList.nodeSize - 3)).toBe(true)
    editor.view.dispatch(closeHistory(editor.state.tr))
    expect(editor.commands.insertContent(' edited')).toBe(true)
    const edited: JSONContent = {
      type: 'doc',
      content: [{
        ...listed.content[0],
        content: [{
          ...listed.content[0].content![0],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evidence edited' }] }],
        }],
      }, trailingParagraph],
    }
    expect(editor.state.doc.textContent).toBe('Evidence edited')
    expect(editor.state.doc.firstChild?.textContent).toBe('Evidence edited')
    expect(editor.getJSON()).toEqual(edited)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(listed)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.state.doc.textContent).toBe('Evidence edited')
    expect(editor.getJSON()).toEqual(edited)

    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as JSONContent
    const reopened = createEditor(saved)
    expect(reopened.getJSON()).toEqual(saved)
    expect(reopened.state.doc.textContent).toBe('Evidence edited')
    expect(reopened.state.doc.firstChild?.textContent).toBe('Evidence edited')
    expect(reopened.commands.setTextSelection(3)).toBe(true)
    expect(toggle(reopened)).toBe(true)
    expect(reopened.getJSON()).toEqual({
      ...paragraph,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Evidence edited' }] },
        trailingParagraph,
      ],
    })

    // Untoggling recovers the untouched paragraph and retains StarterKit's
    // trailing empty paragraph rather than deleting production document data.
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(listed)
    expect(toggle(editor)).toBe(true)
    expect(editor.getJSON()).toEqual({
      ...paragraph,
      content: [...paragraph.content, trailingParagraph],
    })
  })
})
