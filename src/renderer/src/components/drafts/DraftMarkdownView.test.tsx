// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftMarkdownView } from './DraftMarkdownView'

describe('DraftMarkdownView Streamdown compatibility', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders static Session Report Draft markdown with common qa-scribe structures', () => {
    render(
      <DraftMarkdownView
        content={[
          '# Session Report',
          '',
          '## Scenarios Covered',
          '',
          '- Checkout with card',
          '- Guest checkout',
          '',
          '| Check | Result |',
          '| --- | --- |',
          '| Payment | Passed |',
          '',
          '```json',
          '{ "status": "ok" }',
          '```',
          '',
          '[Related issue](https://example.test/TICKET-1)'
        ].join('\n')}
      />
    )

    expect(screen.getByRole('heading', { name: 'Session Report' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scenarios Covered' })).toBeInTheDocument()
    expect(screen.getByText('Checkout with card')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText(/status/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Related issue' })).toBeInTheDocument()
  })

  it('blocks raw HTML, script URLs, and images for generated Draft content', () => {
    render(
      <DraftMarkdownView
        content={[
          '# Unsafe Draft',
          '',
          '<script>alert("bad")</script>',
          '<strong>raw html</strong>',
          '[bad link](javascript:alert(1))',
          '![tracking pixel](https://example.test/pixel.png)',
          '![inline image](data:image/png;base64,abc)'
        ].join('\n')}
      />
    )

    const root = screen.getByTestId('draft-markdown-view')
    expect(within(root).queryByText(/alert/)).not.toBeInTheDocument()
    expect(within(root).queryByRole('img')).not.toBeInTheDocument()
    expect(within(root).getByText(/bad link \[blocked\]/)).toBeInTheDocument()
    expect(within(root).getByText('[Image blocked: inline image]')).toBeInTheDocument()
  })
})
