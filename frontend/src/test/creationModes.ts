import { screen, within } from '@testing-library/react'

/** The Write or Generate option of a new draft's "How to create" switch. */
export function creationMode(name: 'Write' | 'Generate'): HTMLElement {
  return within(screen.getByRole('group', { name: 'How to create' })).getByRole('button', { name })
}

/** The new draft's composer: "New test cases" or "New finding". */
export function creationComposer(kind: 'testware' | 'finding'): HTMLElement {
  return screen.getByRole('article', { name: kind === 'finding' ? 'New finding' : 'New test cases' })
}

/** Generate mode's primary action: "Generate test cases" or "Generate finding". */
export function generateAction(composer: HTMLElement): HTMLElement {
  return within(composer).getByRole('button', { name: /^Generate (test cases|finding)$/ })
}
