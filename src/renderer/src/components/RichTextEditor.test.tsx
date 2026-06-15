// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { richTextMetadataSchema } from '../domain/richText'
import { RichTextEditor } from './RichTextEditor'

describe('RichTextEditor', () => {
  beforeEach(() => {
    installBrowserLayoutMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hydrates from saved rich-text metadata when remounted', async () => {
    render(
      <RichTextEditor
        ariaLabel="Note body"
        initialMetadataJson={JSON.stringify({
          schema: richTextMetadataSchema,
          format: 'tiptap-json',
          text: 'Formatted note',
          html: '<p><strong>Formatted note</strong></p>',
          json: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    marks: [{ type: 'bold' }],
                    text: 'Formatted note'
                  }
                ]
              }
            ]
          }
        })}
        initialText=""
        placeholder="Capture what happened..."
        resetKey={0}
        onChange={vi.fn()}
      />
    )

    expect(await screen.findByText('Formatted note')).toBeInTheDocument()
  })

  it('hydrates from plain note text when metadata is unavailable', async () => {
    render(
      <RichTextEditor
        ariaLabel="Note body"
        initialMetadataJson={null}
        initialText="Plain note draft"
        placeholder="Capture what happened..."
        resetKey={0}
        onChange={vi.fn()}
      />
    )

    expect(await screen.findByText('Plain note draft')).toBeInTheDocument()
  })
})

function installBrowserLayoutMocks(): void {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => document.body)
    })
  }
}
