// The made-up Session the README screenshots show: a web shop's checkout, tested by hand.
// Every name here is invented; nothing refers to a real brand, person or ticket system.

const text = (value, bold = false) => ({ type: 'text', text: value, ...(bold ? { marks: [{ type: 'bold' }] } : {}) })
const h = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const p = (...parts) => ({ type: 'paragraph', content: parts.map(part => typeof part === 'string' ? text(part) : part) })
const label = (name, value) => p(text(`${name}:`, true), ` ${value}`)
const list = (type, items) => ({ type, content: items.map(item => ({ type: 'listItem', content: [p(item)] })) })
const ul = items => list('bulletList', items)
const ol = items => list('orderedList', items)
const image = (attachmentId, alt) => ({ type: 'image', attrs: { src: `qa-scribe-attachment://${attachmentId}`, attachmentId, alt } })

const escape = value => value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
function html(node) {
  const inner = () => (node.content ?? []).map(html).join('')
  switch (node.type) {
    case 'text': return node.marks ? `<strong>${escape(node.text)}</strong>` : escape(node.text)
    case 'heading': return `<h${node.attrs.level}>${inner()}</h${node.attrs.level}>`
    case 'paragraph': return `<p>${inner()}</p>`
    case 'bulletList': return `<ul>${inner()}</ul>`
    case 'orderedList': return `<ol>${inner()}</ol>`
    case 'listItem': return `<li>${inner()}</li>`
    case 'image': return `<img src="${node.attrs.src}" data-attachment-id="${node.attrs.attachmentId}" alt="${escape(node.attrs.alt)}">`
    default: throw new Error(`No HTML for ${node.type}`)
  }
}

/** A rich text body as the app stores it: HTML plus the editor document. */
export function body(content) {
  return { body: content.map(html).join(''), bodyJson: JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content } }), bodyFormat: 'tiptap_json' }
}

export const otherSessions = [
  'Login: password reset email',
  'Search filters on mobile',
  'Release 3.7.2 smoke test',
]

export const session = {
  title: 'Checkout: saved cards and 3-D Secure',
  objectiveNotes: 'Explore paying with saved cards, including 3-D Secure challenges, to find where the order and its payment disagree.',
  relatedReference: 'SHOP-1184',
  timeboxMinutes: 90,
  acceptanceCriteria: [
    'AC-1 A shopper can save a card at checkout and pay with it on the next order',
    'AC-2 An approved 3-D Secure challenge completes the order and shows the confirmation page',
    'AC-3 An expired saved card cannot be chosen for payment',
  ].join('\n'),
}

export const screenshotAlt = '3-D Secure window still waiting for the bank after approval'

export const note = attachmentId => body([
  p('Staging build 3.8.0 of the demo shop, Chrome 131 and Safari 18 on macOS, cards from the payment sandbox.'),
  h(3, 'Observations'),
  ul([
    'A card saved at checkout is listed under Your cards on the next order.',
    'Cancelling the 3-D Secure challenge returns to Payment with the same card still selected.',
    'Safari: after I approve the challenge, the bank window keeps saying "Waiting for your bank" until I reload. The order is placed anyway.',
  ]),
  image(attachmentId, screenshotAlt),
  h(3, 'Open questions'),
  ul([
    'An expired card is still offered; the error only shows after Pay. Should it be hidden or greyed out?',
    'No expired card in the sandbox yet, so AC-3 cannot be checked end to end.',
  ]),
  p('Next: repeat the Safari case with a second sandbox card.'),
])

export const draftTitle = 'Paying with a saved card'
export const cases = {
  save: 'Save a card and pay with it on the next order (AC-1)',
  secure: 'Approve a 3-D Secure challenge in Safari (AC-2)',
  expired: 'An expired saved card cannot be chosen (AC-3)',
}

export const draft = body([
  h(2, 'Scenario: Paying with a saved card'),
  h(3, cases.save),
  label('Preconditions', 'Signed in as a shopper with no saved cards.'),
  label('Test data', 'Sandbox card ending 4242, expiry 12/29.'),
  ol(['Place an order and tick Save this card.', 'Start a second order and open Payment.', 'Pay with the saved card.']),
  label('Expected result', 'The card is listed under Your cards and the second order is placed without typing the card again.'),
  h(3, cases.secure),
  label('Preconditions', 'Safari 18; a saved card that always asks for 3-D Secure.'),
  ol(['Pay with the saved card.', 'Approve the challenge in the bank window.']),
  label('Expected result', 'The window closes and the confirmation page shows the order number.'),
  h(3, cases.expired),
  label('Preconditions', 'A saved card whose expiry date has passed.'),
  ol(['Open Payment.', 'Look at the expired card in Your cards.']),
  label('Expected result', 'The card is shown as expired and cannot be selected.'),
])

export const draftMetadata = JSON.stringify({ manualCreationFormat: { version: 1, format: { kind: 'testware', outputFormat: 'qa_cases' } } })

export const results = {
  [cases.save]: ['passed', null],
  [cases.secure]: ['failed', 'Bank window hangs after approval.'],
  [cases.expired]: ['blocked', 'No expired card in the sandbox yet. Asked the payments team for one.'],
}

export const findings = [
  {
    title: '3-D Secure window hangs after approval in Safari',
    kind: 'bug',
    metadataJson: JSON.stringify({ severity: 'high', component: 'Checkout', reference: 'SHOP-1184' }),
    content: attachmentId => [
      h(3, 'Environment'),
      p('Staging build 3.8.0, Safari 18 on macOS. Sandbox card ending 3155.'),
      h(3, 'Steps to reproduce'),
      ol(['Pay with a saved card that asks for 3-D Secure.', 'Approve the challenge in the bank window.']),
      h(3, 'Expected result'),
      p('The window closes and the confirmation page shows the order number.'),
      h(3, 'Actual result'),
      p('The window keeps saying "Waiting for your bank" until the page is reloaded. The order is placed and the confirmation email arrives.'),
      h(3, 'Evidence'),
      image(attachmentId, screenshotAlt),
      h(3, 'Impact'),
      p('Shoppers on Safari may pay twice because the page looks stuck.'),
    ],
  },
  {
    title: 'Expired saved cards are offered at checkout',
    kind: 'question',
    metadataJson: JSON.stringify({ severity: 'medium', component: 'Checkout' }),
    content: () => [
      p('An expired saved card can be selected in Payment; the error only shows after Pay. AC-3 says it cannot be chosen.'),
      p('Should the card be hidden, or shown as expired with a prompt to update it?'),
    ],
  },
]

export const question = 'Is anything missing before I send this to the payments team?'

export const writeTitle = 'Retry after a cancelled 3-D Secure challenge'
export const writeBody = [
  '<h2>Scenario: Cancelling the bank challenge</h2>',
  '<h3>Pay again after cancelling (AC-2)</h3>',
  '<p><strong>Preconditions:</strong> A saved card that always asks for 3-D Secure.</p>',
  '<ol><li><p>Pay with the saved card.</p></li><li><p>Cancel the challenge in the bank window.</p></li><li><p>Pay again with the same card.</p></li></ol>',
  '<p><strong>Expected result:</strong> The second challenge opens and approving it places one order, not two.</p>',
].join('')
