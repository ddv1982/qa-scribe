import { useEffect, useRef, type ReactElement } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Code2, Italic, List, ListOrdered } from 'lucide-react'
import { parseRichTextMetadata, richTextMetadataSchema, textToDoc } from '../domain/richText'

export type RichTextValue = {
  text: string
  html: string
  json: JSONContent
  metadataJson: string | null
  empty: boolean
}

export const emptyRichTextValue: RichTextValue = {
  text: '',
  html: '',
  json: { type: 'doc', content: [] },
  metadataJson: null,
  empty: true
}

export function RichTextEditor(props: {
  ariaLabel: string
  initialMetadataJson: string | null
  initialText: string
  placeholder: string
  resetKey: number
  onChange: (value: RichTextValue) => void
}): ReactElement {
  const lastResetKeyRef = useRef(props.resetKey)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false
      }),
      Placeholder.configure({
        placeholder: props.placeholder
      })
    ],
    content: initialContent(props.initialMetadataJson, props.initialText),
    editorProps: {
      attributes: {
        'aria-label': props.ariaLabel,
        class: 'rich-editor-surface',
        'data-placeholder': props.placeholder
      }
    },
    immediatelyRender: false,
    onUpdate: ({ editor }) => props.onChange(readEditorValue(editor))
  })

  useEffect(() => {
    if (!editor) return
    if (lastResetKeyRef.current === props.resetKey) return
    lastResetKeyRef.current = props.resetKey
    editor.commands.clearContent()
    props.onChange(emptyRichTextValue)
  }, [editor, props.resetKey])

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar" aria-label="Note formatting">
        <ToolbarButton
          active={editor?.isActive('bold') ?? false}
          disabled={!editor}
          label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('italic') ?? false}
          disabled={!editor}
          label="Italic"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('code') ?? false}
          disabled={!editor}
          label="Inline code"
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('bulletList') ?? false}
          disabled={!editor}
          label="Bulleted list"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('orderedList') ?? false}
          disabled={!editor}
          label="Numbered list"
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={15} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarButton(props: {
  active: boolean
  disabled: boolean
  label: string
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      aria-label={props.label}
      className={props.active ? 'selected' : ''}
      disabled={props.disabled}
      title={props.label}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function readEditorValue(editor: Editor): RichTextValue {
  const text = editor.getText({ blockSeparator: '\n\n' }).trim()
  if (text.length === 0) return emptyRichTextValue
  const html = editor.getHTML()
  const json = editor.getJSON()
  return {
    text,
    html,
    json,
    metadataJson: JSON.stringify({
      schema: richTextMetadataSchema,
      format: 'tiptap-json',
      text,
      html,
      json
    }),
    empty: false
  }
}

function initialContent(metadataJson: string | null, text: string): JSONContent | string {
  const metadata = parseRichTextMetadata(metadataJson)
  if (metadata?.json) return metadata.json
  const trimmed = text.trim()
  return trimmed ? textToDoc(trimmed) : ''
}
