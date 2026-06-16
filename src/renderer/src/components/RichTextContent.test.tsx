// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { richTextMetadataSchema } from '../domain/richText'
import { RichTextContent } from './RichTextContent'

describe('RichTextContent', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders saved rich-text metadata without raw HTML injection', () => {
    render(
      <RichTextContent
        body="Fallback"
        metadataJson={JSON.stringify({
          schema: richTextMetadataSchema,
          format: 'tiptap-json',
          text: 'Saved rich note',
          html: '<p><strong>Saved rich note</strong></p>',
          json: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    marks: [{ type: 'bold' }],
                    text: 'Saved rich note'
                  }
                ]
              }
            ]
          }
        })}
      />
    )

    expect(screen.getByText('Saved rich note').tagName).toBe('STRONG')
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument()
  })

  it('falls back to plain body text for malformed rich-text metadata', () => {
    render(
      <RichTextContent
        body="Fallback body"
        metadataJson={JSON.stringify({
          schema: richTextMetadataSchema,
          format: 'tiptap-json',
          text: 'Bad metadata',
          html: '<script>alert(1)</script>',
          json: { type: 'paragraph', text: 'Not a document' }
        })}
      />
    )

    expect(screen.getByText('Fallback body')).toBeInTheDocument()
    expect(screen.queryByText('Bad metadata')).not.toBeInTheDocument()
  })
})
