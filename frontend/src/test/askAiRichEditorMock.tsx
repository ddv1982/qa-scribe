import type { ComponentProps } from 'react'
import type { RichEditorDocument } from '../editor/editorDocument'
import type { RichTextEditor as Editor } from '../editor/RichTextEditor'

function text(node: RichEditorDocument['doc']): string {
  return node.text ?? node.content?.map(text).join('\n') ?? ''
}

export function FormatToolbar() {
  return <div role="toolbar" aria-label="Formatting toolbar" />
}

export function RichTextEditor({ value, onChange, ariaLabel = 'Note body', editorId, readOnly, placeholder }: ComponentProps<typeof Editor>) {
  return <textarea id={editorId} aria-label={ariaLabel} readOnly={readOnly} placeholder={placeholder} value={text(value.doc)}
    onChange={event => onChange?.({ schemaVersion: 1, doc: { type: 'doc', content: event.target.value ? [{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }] : [] } })} />
}
