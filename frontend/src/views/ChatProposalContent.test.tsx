import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { RichEditorDocument } from '../editor/editorDocument'
import { ChatProposalContent } from './ChatProposalContent'

afterEach(cleanup)

function document(...headings: string[]): RichEditorDocument {
  return { schemaVersion: 1, doc: { type: 'doc', content: headings.map(text => ({
    type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }],
  })) } }
}

it('includes a removed duplicate and the modified section in the review', () => {
  render(<ChatProposalContent before={document('Repeated case', 'Repeated case', 'Old expected result', 'Retained case')}
    after={document('Repeated case', 'New expected result', 'Retained case')} />)
  expect(screen.getByLabelText('Previous sections')).toHaveTextContent('Repeated case')
  expect(screen.getByLabelText('Previous sections')).toHaveTextContent('Old expected result')
  expect(screen.getByLabelText('Suggested sections')).toHaveTextContent('New expected result')
  expect(screen.getByLabelText('Suggested sections')).not.toHaveTextContent('Retained case')
})
