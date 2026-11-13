import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { richEditorDocumentFromHtml, type RichEditorDocument } from '../editor/editorDocument'
import { draftOutputFormat, splitTestCases, type TestCaseSplit } from './testCases'

type Fixture = { format: string | null; metadataJson: string | null; bodyHtml: string; document: RichEditorDocument }

const fixtures = Object.fromEntries(
  Object.entries(import.meta.glob<Fixture>('./__fixtures__/*/*.json', { eager: true, import: 'default' }))
    .map(([path, fixture]) => [path.replace('./__fixtures__/', '').replace('.json', ''), fixture]),
)

/** The document's top-level content; in a checklist without level-3 headings each list is cut into single-item lists. */
function expectedParts(document: RichEditorDocument, format: string | null): JSONContent[] {
  const nodes = document.doc.content ?? []
  if (format !== 'checklist' || nodes.some((node) => node.type === 'heading' && node.attrs?.level === 3)) return nodes
  return nodes.flatMap((node) => ['taskList', 'bulletList', 'orderedList'].includes(node.type ?? '')
    ? (node.content ?? []).map((item) => ({ ...node, content: [item] }))
    : [node])
}

function joined(split: TestCaseSplit): JSONContent[] {
  return [...split.preamble, ...split.cases.flatMap((testCase) => [...testCase.lead, ...testCase.content]), ...split.trailing]
}

function splitFixture(name: string) {
  const fixture = fixtures[name]
  const format = draftOutputFormat(fixture)
  return { fixture, format, split: splitTestCases(fixture.document, format) }
}

function split(html: string, format: string | null) {
  return splitTestCases(richEditorDocumentFromHtml(html), format)
}

describe('every fixture', () => {
  it('has the format its metadata names, and was stored the way a saved draft is', () => {
    expect(Object.keys(fixtures)).toHaveLength(17)
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect(draftOutputFormat(fixture), name).toBe(fixture.format)
      expect(richEditorDocumentFromHtml(fixture.bodyHtml), name).toEqual(fixture.document)
    }
  })

  it.each(Object.keys(fixtures))('%s keeps every node exactly once and in order', (name) => {
    const { fixture, format, split } = splitFixture(name)
    if (!split) return
    expect(joined(split)).toEqual(expectedParts(fixture.document, format))
  })
})

describe('generated drafts split at their level-3 headings', () => {
  const expected: Record<string, Array<[string, string]>> = {
    'generated/qa_cases-claude-invoice': [
      ['Export availability by invoice state', 'Export PDF is enabled for a sent invoice (R1)'],
      ['Export availability by invoice state', 'Export PDF is enabled for a paid invoice (R2)'],
      ['Export availability by invoice state', 'Export PDF is disabled with a tooltip for a draft invoice (R3)'],
      ['Export availability by invoice state', 'Export PDF is disabled with a tooltip for a cancelled invoice (R4)'],
      ['PDF content and pagination', '25 line items fit on a single page (R5, boundary)'],
      ['PDF content and pagination', '26 line items continue on a second page with the header repeated (R6, boundary)'],
      ['PDF content and pagination', 'A 60-line invoice exports across pages with the header repeated (R6)'],
      ['PDF content and pagination', 'VAT is shown separately for each rate, with correct totals (R7)'],
      ['Export file naming', 'The file name follows invoice-<number>.pdf (A5)'],
      ['Export file naming', 'Customer name with special characters: "Müller & Söhne" (R8)'],
    ],
    'generated/qa_cases-claude-login': [
      ['Account lockout after failed passwords', 'Lock triggers at the 5-failure boundary within 15 minutes'],
      ['Account lockout after failed passwords', 'A successful sign-in resets the failed-attempt counter'],
      ['Generic errors and the per-IP limit', 'The lock message and the unknown-email error do not reveal whether an account exists'],
      ['Generic errors and the per-IP limit', 'The per-IP limit of 20 attempts in 15 minutes'],
      ['Recovery while locked', 'The password reset link works while the account is locked'],
    ],
    'generated/qa_cases-codex-checkout': [
      ['Required address fields and validation timing', 'Continue availability as required fields are completed'],
      ['Required address fields and validation timing', 'Invalid postcode error appears after leaving the field'],
      ['Country-specific postcode formats', 'NL postcode accepts optional internal space and rejects invalid structure'],
      ['Country-specific postcode formats', 'BE postcode requires four digits'],
      ['Country-specific postcode formats', 'DE postcode requires five digits'],
      ['Country-specific postcode formats', 'Country changes revalidate an existing postcode'],
      ['Address text length limits', 'Full name at and above the 60-character limit'],
      ['Address text length limits', 'Street and number at and above the 100-character limit'],
      ['Recorded postcode entry and navigation behavior', 'Compare pasted and typed NL postcodes with a trailing space'],
      ['Recorded postcode entry and navigation behavior', 'Shipping address persists when returning from payment'],
    ],
    'generated/qa_cases-codex-invoice': [
      ['Export availability by invoice state', 'Export sent and paid invoices'],
      ['Export availability by invoice state', 'Prevent export of draft and cancelled invoices'],
      ['PDF content accuracy', 'Preserve invoice details, VAT rates and totals'],
      ['Pagination and large exports', 'Check the 25-line boundary and 60-line export'],
      ['Filename and special-character handling', 'Export an invoice for Müller & Söhne'],
    ],
    'generated/gherkin-claude-checkout': [
      ['Postcode validation per country', 'Valid NL postcode is accepted with and without a space'],
      ['Postcode validation per country', 'Invalid NL postcode shows an inline error'],
      ['Postcode validation per country', 'BE and DE postcode digit length boundaries'],
      ['Postcode validation per country', 'Changing the country re-validates an entered postcode'],
      ['Postcode validation per country', 'Pasted and typed NL postcode with a trailing space are validated the same way'],
      ['Field length limits', 'Full name maximum of 60 characters'],
      ['Field length limits', 'Street and number maximum of 100 characters'],
      ['Form completion and inline errors', 'Continue stays disabled until all required fields are filled'],
      ['Form completion and inline errors', 'Inline error appears under the field after leaving it'],
      ['Navigation between checkout steps', 'Address is kept when going back from payment to shipping'],
    ],
    'generated/gherkin-claude-invoice': [
      ['Export availability by invoice state', 'Export is enabled for sent and paid invoices'],
      ['Export availability by invoice state', 'Export is blocked for draft and cancelled invoices'],
      ['PDF content and layout', 'The PDF contains all required sections and the VAT breakdown'],
      ['PDF content and layout', 'Page break after 25 line items (boundary)'],
      ['Export file naming', 'File name pattern with special characters in the customer name'],
    ],
    'generated/gherkin-codex-login': [
      ['Account lock threshold and duration', 'Lock after five failed passwords within 15 minutes'],
      ['Successful sign-in resets failed attempts', 'Earlier failures do not carry over after success'],
      ['Generic errors and the per-IP limit', 'Unknown email attempts remain generic and count toward the IP limit'],
      ['Password reset remains available during lock', 'Use the password reset link while sign-in is locked'],
    ],
    // All three models answered the checklist format with the QA cases shape: an h3 per test case and
    // its checks as a bullet list. Headings win, so these split like QA cases.
    'generated/checklist-claude-invoice': [
      ['Export PDF availability by invoice state', 'Export is enabled only for sent and paid invoices'],
      ['PDF content', 'The exported PDF has all required elements and VAT broken down by rate'],
      ['Multi-page layout', 'Invoices with more than 25 line items continue on a second page'],
      ['File naming', 'The file name follows invoice-<number>.pdf, including when the customer name has special characters'],
      ['Export of large invoices', 'A 60-line invoice exports successfully'],
    ],
    'generated/checklist-codex-checkout': [
      ['Required fields and inline validation', 'Continue requires completed required fields'],
      ['Required fields and inline validation', 'Field errors appear after leaving the field'],
      ['Country-specific postcode formats', 'NL accepts the optional space'],
      ['Country-specific postcode formats', 'BE requires four digits'],
      ['Country-specific postcode formats', 'DE requires five digits'],
      ['Country-specific postcode formats', 'Changing country revalidates an existing postcode'],
      ['Text field length boundaries', 'Full name has a 60-character maximum'],
      ['Text field length boundaries', 'Street has a 100-character maximum'],
      ['Recorded postcode entry behavior', 'NL trailing space through paste and typing'],
      ['Address retention during checkout navigation', 'Returning from payment retains the shipping address'],
    ],
    'generated/checklist-codex-login': [
      ['Account lock threshold and duration', 'Lock begins on the fifth failed password and expires after 15 minutes'],
      ['Failed-attempt counter reset', 'Successful sign-in clears earlier failures'],
      ['Unknown addresses and per-IP counting', 'Unknown addresses receive generic errors and contribute to the IP limit'],
      ['Password reset during account lock', 'Password reset link remains usable while sign-in is locked'],
      ['Lock scope across devices', 'Check whether switching devices bypasses an account lock'],
    ],
  }

  it.each(Object.keys(expected))('%s', (name) => {
    const { split } = splitFixture(name)
    expect(split?.cases.map(({ group, title }) => [group, title])).toEqual(expected[name])
    // Each case starts at its own heading and keeps its steps and expected result; a Feature heading or
    // a technique note stays in the preamble.
    for (const testCase of split!.cases) expect(testCase.content[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } })
  })

  it('keeps an overview section before the first scenario in the preamble', () => {
    const { split } = splitFixture('generated/qa_cases-claude-invoice')
    expect(split!.preamble[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(split!.preamble.at(-1)).toMatchObject({ type: 'heading', content: [{ text: 'Scenario: Export availability by invoice state' }] })
    expect(split!.cases[4].lead).toMatchObject([{ type: 'heading', attrs: { level: 2 } }])
  })
})

describe('manual drafts', () => {
  it('splits the QA cases starter into its test cases', () => {
    expect(splitFixture('manual/qa_cases-starter').split?.cases.map(({ group, title }) => [group, title])).toEqual([
      ['Shipping address', 'Continue stays disabled until required fields are filled'],
      ['Shipping address', 'NL postcode accepts an optional space'],
    ])
  })

  it('splits a draft made from the earlier QA cases starter at every section, since it is not migrated', () => {
    expect(splitFixture('manual/qa_cases-old-starter').split?.cases.map(({ title }) => title))
      .toEqual(['Test case', 'Purpose', 'Preconditions', 'Test data', 'Steps', 'Expected result', 'Coverage notes'])
  })

  it('splits the Gherkin starter at its scenario and the checklist starter per check', () => {
    expect(splitFixture('manual/gherkin-starter').split?.cases.map(({ group, title }) => [group, title]))
      .toEqual([['Login lock', 'Five failures lock the account']])
    const checklist = splitFixture('manual/checklist-starter').split
    expect(checklist?.cases.map(({ group, title }) => [group, title])).toEqual([
      ['Checklist', 'Export a sent invoice: the file is named invoice-<number>.pdf.'],
      ['Checklist', 'Export is disabled for a draft invoice.'],
      ['Checklist', 'A 30-line invoice repeats the header on page 2.'],
    ])
    expect(checklist?.cases[0].content).toMatchObject([{ type: 'taskList', content: [{ type: 'taskItem' }] }])
  })

  it('cannot run charters or coverage outlines', () => {
    expect(splitFixture('manual/charters-starter').split).toBeNull()
    expect(splitFixture('manual/coverage_outline-starter').split).toBeNull()
    expect(split('<h2>Area</h2><h3>Case</h3><p>Body</p>', 'charters')).toBeNull()
    expect(split('<h2>Area</h2><h3>Case</h3><p>Body</p>', 'coverage_outline')).toBeNull()
  })

  it('splits an older draft without format metadata by its headings and strips TC and Test case labels', () => {
    const { format, split } = splitFixture('manual/old-draft-no-metadata')
    expect(format).toBeNull()
    expect(split?.cases.map(({ group, title }) => [group, title])).toEqual([
      ['Checkout regression', 'Pay with a saved card'],
      ['Checkout regression', 'Pay with iDEAL'],
      ['Checkout regression', 'Cancel payment'],
    ])
    expect(split?.preamble).toHaveLength(2)
  })

  it('returns null for the empty starters, which have nothing to run', () => {
    expect(split('<h2>Checklist</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>', 'checklist')).toBeNull()
  })
})

describe('splitTestCases', () => {
  it('returns null for an empty document and for paragraphs only', () => {
    expect(split('', 'qa_cases')).toBeNull()
    expect(split('', 'checklist')).toBeNull()
    expect(split('<p>One</p><p>Two</p>', 'qa_cases')).toBeNull()
    expect(split('<p>One</p><p>Two</p>', null)).toBeNull()
    expect(split('<p>One</p><p>Two</p>', 'checklist')).toBeNull()
  })

  it('uses level-2 headings as cases when there is no level-3 heading, without a group', () => {
    const result = split('<p>Intro</p><h2>Scenario: First</h2><p>a</p><p>b</p><h2>Second</h2><p>c</p>', 'gherkin')
    expect(result?.cases.map(({ group, title, content }) => [group, title, content.length])).toEqual([[null, 'First', 3], [null, 'Second', 2]])
    expect(result?.preamble).toHaveLength(1)
  })

  it('ends a level-3 case at the next level-2 heading, which is kept after the last case', () => {
    const result = split('<h2>Group</h2><h3>Case</h3><p>a</p><h2>Summary</h2><p>b</p>', 'qa_cases')
    expect(result?.cases.map(({ group, title, content }) => [group, title, content.length])).toEqual([['Group', 'Case', 2]])
    expect(result?.trailing).toHaveLength(2)
  })

  it('reads heading text through marks and links, and strips one leading label', () => {
    const result = split([
      '<h3>Test case: <strong>Bold</strong> and <a href="https://example.test">linked</a></h3>',
      '<h3>Scenario Outline: <em>Many</em> rows</h3>',
      '<h3>tc-12: lower case</h3>',
      '<h3>TC 3 – en dash</h3>',
      '<h3>Test case 4: numbered</h3>',
      '<h3>Scenario:</h3>',
      '<h3>Scenario-based check</h3>',
      '<h3>Test case</h3>',
      '<h3>TC-5 Test case: no separator</h3>',
    ].join(''), 'qa_cases')
    expect(result?.cases.map(({ title }) => title)).toEqual([
      'Bold and linked', 'Many rows', 'lower case', 'en dash', 'numbered', 'Scenario:', 'Scenario-based check', 'Test case', 'TC-5 Test case: no separator',
    ])
  })

  it('does not start a case at a heading without text, and keeps it as a lead', () => {
    const result = split('<h3>First</h3><p>a</p><h3></h3><p>b</p><h3>Second</h3>', 'qa_cases')
    expect(result?.cases.map(({ title, lead, content }) => [title, lead.length, content.length])).toEqual([['First', 0, 2], ['Second', 2, 1]])
  })

  it('makes each top-level list item of a checklist without level-3 headings a case, with the nearest heading as group', () => {
    const document = richEditorDocumentFromHtml([
      '<p>Run on staging.</p>',
      '<ul><li><p>Before any heading</p></li></ul>',
      '<h2>Pages</h2><h2>Feature: Export</h2>',
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Header repeats<br>on page 2</p></li>',
      '<li data-type="taskItem" data-checked="true"><p></p></li></ul>',
      '<p>Between lists.</p>',
      '<ol><li><p></p><p>Second paragraph is the title</p><ul><li><p>nested one</p></li><li><p>nested two</p></li></ul></li></ol>',
      '<p>After the last list.</p>',
    ].join(''))
    const result = splitTestCases(document, 'checklist')
    expect(result?.cases.map(({ group, title, lead }) => [group, title, lead.length])).toEqual([
      [null, 'Before any heading', 0],
      ['Export', 'Header repeats', 2],
      ['Export', 'Second paragraph is the title', 2],
    ])
    expect(result?.cases[2].content[0].content?.[0].content?.[2]).toMatchObject({ type: 'bulletList', content: [{}, {}] })
    expect(result?.preamble).toHaveLength(1)
    expect(result?.trailing).toHaveLength(1)
    expect(joined(result!)).toEqual(expectedParts(document, 'checklist'))
  })

  it('splits a checklist with level-3 headings by its headings, and its list items stay inside the cases', () => {
    const result = split('<h2>Area</h2><h3>Test case: Case</h3><ul><li><p>Check one</p></li><li><p>Check two</p></li></ul><p>Expected: ok</p>', 'checklist')
    expect(result?.cases.map(({ group, title, content }) => [group, title, content.length])).toEqual([['Area', 'Case', 3]])
  })

  it('does not treat checklist headings or paragraphs as cases', () => {
    expect(split('<h2>Area</h2><p>Body</p>', 'checklist')).toBeNull()
  })

  it('drops a leading label from group headings too, unless nothing would be left', () => {
    const result = split('<h2>Feature: Login</h2><h3>One</h3><h2>Scenario: Lock</h2><h3>Two</h3><h2>Scenario:</h2><h3>Three</h3>', 'gherkin')
    expect(result?.cases.map(({ group }) => group)).toEqual(['Login', 'Lock', 'Scenario:'])
  })
})

describe('checklist item titles', () => {
  it('lose a leading label and keep words that only look like one', () => {
    const item = (text: string) => `<li data-type="taskItem" data-checked="false"><p>${text}</p></li>`
    const result = split(`<ul data-type="taskList">${['Test case: Export invoice', 'Scenario planning', 'TC-12 timeout', 'TC-3: Empty cart'].map(item).join('')}</ul>`, 'checklist')
    expect(result?.cases.map((testCase) => testCase.title)).toEqual(['Export invoice', 'Scenario planning', 'TC-12 timeout', 'Empty cart'])
  })
})

describe('draftOutputFormat', () => {
  it('reads a generated draft, then a manual draft, and returns null for anything else', () => {
    expect(draftOutputFormat({ metadataJson: '{"testwareGeneration":{"technique":"auto","outputFormat":"gherkin","depth":"lean"}}' })).toBe('gherkin')
    expect(draftOutputFormat({ metadataJson: '{"manualCreationFormat":{"version":1,"format":{"kind":"testware","outputFormat":"checklist"}}}' })).toBe('checklist')
    expect(draftOutputFormat({ metadataJson: '{"manualCreationFormat":{"version":1,"format":{"kind":"testware","outputFormat":"unknown"}}}' })).toBeNull()
    expect(draftOutputFormat({ metadataJson: '{"manualCreationFormat":{"version":1,"format":{"kind":"finding","template":"blank"}}}' })).toBeNull()
    expect(draftOutputFormat({ metadataJson: '{not json' })).toBeNull()
    expect(draftOutputFormat({ metadataJson: null })).toBeNull()
  })
})
