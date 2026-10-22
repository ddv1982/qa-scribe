import screenshot from './assets/example-evidence.png'

export const exampleSession = {
  title: 'Checkout validation',
  note: 'Tested the synthetic shop on a laptop. With an empty postcode, Place order showed a confirmation instead of a validation message. Repeated once with the same result.',
  screenshot,
  screenshotAlt: 'Synthetic shop checkout with an empty postcode and an incorrect Order confirmed message.',
  finding: {
    title: 'Checkout accepts an empty postcode',
    steps: ['Add a notebook to the basket.', 'Leave the postcode empty.', 'Choose Place order.'],
    expected: 'Ask for a postcode and keep the order unsubmitted.',
    actual: 'Order confirmed appears even though the postcode is empty.',
    impact: 'An order can be accepted without enough information for delivery.',
  },
  testCase: 'With a product in the basket, leave the postcode empty and choose Place order. Check that a postcode message appears and no order is confirmed.',
} as const
