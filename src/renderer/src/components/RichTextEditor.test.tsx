// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('keeps toolbar pressed state in sync with formatting commands', async () => {
    render(
      <RichTextEditor
        ariaLabel="Note body"
        initialMetadataJson={null}
        initialText=""
        placeholder="Capture what happened..."
        resetKey={0}
        onChange={vi.fn()}
      />
    )

    const bold = await screen.findByRole('button', { name: 'Bold' })
    expect(bold).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(bold)

    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'))
  })

  it('clears editor content once when resetKey changes', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <RichTextEditor
        ariaLabel="Note body"
        initialMetadataJson={null}
        initialText="Draft text"
        placeholder="Capture what happened..."
        resetKey={0}
        onChange={onChange}
      />
    )

    expect(await screen.findByText('Draft text')).toBeInTheDocument()

    rerender(
      <RichTextEditor
        ariaLabel="Note body"
        initialMetadataJson={null}
        initialText=""
        placeholder="Capture what happened..."
        resetKey={1}
        onChange={onChange}
      />
    )

    await waitFor(() => expect(screen.queryByText('Draft text')).not.toBeInTheDocument())
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ empty: true, metadataJson: null, text: '' }))
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
