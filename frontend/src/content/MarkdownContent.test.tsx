import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

afterEach(cleanup)

describe('MarkdownContent', () => {
  it('escapes HTML and renders image alt text without fetching media', () => {
    const text = '<script>alert(1)</script>\n\n<img src="https://example.com/raw" onerror="alert(1)">\n\n![Screenshot](https://example.com/track)\n\n![Data](data:image/png;base64,AAAA)'
    const { container } = render(<MarkdownContent text={text} />)
    expect(container.querySelector('script, img, iframe, svg')).toBeNull()
    expect(container).toHaveTextContent('<script>alert(1)</script>')
    expect(container).toHaveTextContent('<img src="https://example.com/raw" onerror="alert(1)">')
    expect(screen.getByText('Screenshot')).toBeInTheDocument()
    expect(screen.getByText('Data')).toBeInTheDocument()
  })

  it('keeps only absolute safe links interactive', () => {
    const text = '[Web](https://example.com) [Mail](mailto:qa@example.com) [HTTP](http://example.com) [Bad](javascript:alert%281%29) [File](file:///tmp/private) [App](tauri://localhost) [Relative](/settings) [Protocol](//example.com) [Data](data:text/html,hello)'
    render(<MarkdownContent text={text} />)
    expect(screen.getAllByRole('link')).toHaveLength(3)
    for (const name of ['Web', 'Mail', 'HTTP']) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    for (const name of ['Bad', 'File', 'App', 'Relative', 'Protocol', 'Data']) {
      expect(screen.getByText(name).tagName).toBe('SPAN')
    }
  })

  it('keeps incremental prefixes usable and settles to complete structures', () => {
    const text = '## Result\n\n**Bold** [reference](https://example.com)\n\n```sql\nselect 1;\n```\n\n| Check | Result |\n| --- | --- |\n| One | Pass |'
    const { container, rerender } = render(<MarkdownContent text="" />)
    for (let length = 1; length <= text.length; length++) {
      rerender(<MarkdownContent text={text.slice(0, length)} />)
      expect(container.querySelector('script, img')).toBeNull()
    }
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'reference' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByLabelText('Code block')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('region', { name: 'Markdown table' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table')).toHaveTextContent('Pass')
  })
})
