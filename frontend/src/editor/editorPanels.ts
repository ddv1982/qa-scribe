/**
 * Panels: callout blocks, as in Confluence. Each kind is one GitHub alert in Markdown (see
 * `crates/qa-scribe-core/src/generation/panel.rs`), so a panel survives Ask AI. In HTML a panel is
 * `<aside data-panel="<kind>">`, and an unknown or missing kind reads as a note.
 */
import { Node } from '@tiptap/core'

export const panelKinds = ['note', 'info', 'success', 'warning', 'error'] as const

export type PanelKind = (typeof panelKinds)[number]

export const panelLabels: Record<PanelKind, string> = { note: 'Note', info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' }

export function panelKind(value: unknown): PanelKind {
  return panelKinds.find((kind) => kind === value) ?? 'note'
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    panel: {
      /** Wraps the selected blocks in a panel of `kind`, out of any list or quote first. */
      setPanel: (kind: PanelKind) => ReturnType
    }
  }
}

export const Panel = Node.create({
  name: 'panel',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (element: HTMLElement) => panelKind(element.getAttribute('data-panel')),
        renderHTML: (attributes) => ({ 'data-panel': panelKind(attributes.kind) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'aside' }]
  },

  // The role and name are for the editor's own view; both sanitisers keep only `data-panel`.
  renderHTML({ node, HTMLAttributes }) {
    return ['aside', { ...HTMLAttributes, role: 'note', 'aria-label': `${panelLabels[panelKind(node.attrs.kind)]} panel` }, 0]
  },

  addCommands() {
    return {
      setPanel: (kind) => ({ chain }) => chain().clearNodes().wrapIn(this.name, { kind }).run(),
    }
  },
})
