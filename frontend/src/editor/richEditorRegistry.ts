import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

export type RichEditorImageInserter = (attachmentId: string, filename: string, previewSrc?: string) => void

export type RichEditorImageUpload = {
  file: File
  insertImage: RichEditorImageInserter
}

export type RichEditorController = {
  editor: Editor
  insertImage: RichEditorImageInserter
  readOnly: boolean
}

const editorRegistry = new Map<string, RichEditorController>()
const registryListeners = new Set<() => void>()
let activeRichEditorId: string | null = null

export function registerRichEditor(editorId: string, controller: RichEditorController): () => void {
  editorRegistry.set(editorId, controller)
  notifyRichEditorRegistry()

  return () => {
    if (editorRegistry.get(editorId)?.editor === controller.editor) {
      editorRegistry.delete(editorId)
      if (activeRichEditorId === editorId) activeRichEditorId = null
      notifyRichEditorRegistry()
    }
  }
}

export function setActiveRichEditor(editorId: string) {
  activeRichEditorId = editorId
  notifyRichEditorRegistry()
}

export function notifyRichEditorRegistry() {
  registryListeners.forEach((listener) => listener())
}

export function useRichEditorController(editorId?: string): RichEditorController | null {
  const [, setRevision] = useState(0)

  useEffect(() => {
    const listener = () => setRevision((revision) => revision + 1)
    registryListeners.add(listener)
    return () => {
      registryListeners.delete(listener)
    }
  }, [])

  if (editorId) return editorRegistry.get(editorId) ?? null
  return activeRichEditorId ? (editorRegistry.get(activeRichEditorId) ?? null) : null
}

export function richEditorImageInserterForElement(element: HTMLElement): RichEditorImageInserter | null {
  const editor = element.closest<HTMLElement>('.rich-editor')
  if (!editor?.id) return null
  return editorRegistry.get(editor.id)?.insertImage ?? null
}
