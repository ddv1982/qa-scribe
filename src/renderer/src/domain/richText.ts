import type { JSONContent } from '@tiptap/core'

export const richTextMetadataSchema = 'qa-scribe.rich-text.v1'

export type RichTextMetadata = {
  schema: typeof richTextMetadataSchema
  format: 'tiptap-json'
  text: string
  html: string
  json: JSONContent
}

export function parseRichTextMetadata(metadataJson: string | null | undefined): RichTextMetadata | null {
  if (!metadataJson) return null
  try {
    const value = JSON.parse(metadataJson) as Partial<RichTextMetadata>
    if (value.schema !== richTextMetadataSchema || value.format !== 'tiptap-json' || !isRichTextDoc(value.json)) return null
    return {
      schema: richTextMetadataSchema,
      format: 'tiptap-json',
      text: typeof value.text === 'string' ? value.text : '',
      html: typeof value.html === 'string' ? value.html : '',
      json: value.json
    }
  } catch {
    return null
  }
}

export function textToDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: 'paragraph',
      content: paragraph
        ? [
            {
              type: 'text',
              text: paragraph
            }
          ]
        : []
    }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRichTextDoc(value: unknown): value is JSONContent {
  return isRecord(value) && value.type === 'doc'
}
