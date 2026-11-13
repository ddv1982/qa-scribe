import { screen, within } from '@testing-library/react'

/** The Write or Generate option of a new draft's "How to create" switch. */
export function creationMode(name: 'Write' | 'Generate'): HTMLElement {
  return within(screen.getByRole('group', { name: 'How to create' })).getByRole('button', { name })
}

/** The new draft's composer: "New test cases" or "New finding". */
export function creationComposer(kind: 'testware' | 'finding'): HTMLElement {
  return screen.getByRole('article', { name: kind === 'finding' ? 'New finding' : 'New test cases' })
}

/** Generate mode's primary action, named "Generate" (or "Generate and replace draft") like the switch option it is not. */
export function generateAction(composer: HTMLElement, name = 'Generate'): HTMLElement {
  const action = within(composer).getAllByRole('button', { name }).find((button) => !button.closest('[role="group"]'))
  if (!action) throw new Error(`No ${name} action in Generate mode`)
  return action
}
