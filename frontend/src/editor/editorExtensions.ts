import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { managedAttachmentProtocol, isSafeEditorLinkUrl } from './editorHtml'
import { managedAttachmentIdFromSrc } from './htmlUtils'

export const ManagedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('src'),
        renderHTML: (attributes) => {
          const attachmentId = stringAttribute(attributes.attachmentId)
          const source = attachmentId ? `${managedAttachmentProtocol}${attachmentId}` : stringAttribute(attributes.src)
          return source ? { src: source } : {}
        },
      },
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id') || managedAttachmentIdFromSrc(element.getAttribute('src') ?? ''),
        renderHTML: (attributes) => {
          const attachmentId = stringAttribute(attributes.attachmentId)
          return attachmentId ? { 'data-attachment-id': attachmentId } : {}
        },
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
        renderHTML: (attributes) => {
          const alt = stringAttribute(attributes.alt)
          return alt ? { alt } : {}
        },
      },
    }
  },
})

export function richTextEditorExtensions(placeholder?: string) {
  const extensions: Extensions = [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: { levels: [2, 3] },
      horizontalRule: false,
      link: false,
      strike: false,
    }),
    Link.configure({
      autolink: true,
      enableClickSelection: true,
      linkOnPaste: true,
      openOnClick: false,
      HTMLAttributes: {
        target: '_blank',
        rel: 'noreferrer',
      },
      isAllowedUri: (url) => isSafeEditorLinkUrl(url),
      shouldAutoLink: (url) => isSafeEditorLinkUrl(url),
    }),
    ManagedImage.configure({
      allowBase64: true,
    }),
    TaskList,
    TaskItem.configure({
      nested: false,
    }),
  ]

  if (placeholder !== undefined) {
    extensions.push(
      Placeholder.configure({
        placeholder,
      }),
    )
  }

  return extensions
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
