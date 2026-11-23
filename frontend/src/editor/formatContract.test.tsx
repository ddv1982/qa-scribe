/**
 * The frontend half of the editor format contract in `shared/editor-format-contract.json`. The Rust
 * half is `crates/qa-scribe-core/src/chat/format_contract_tests.rs`. Every path that reads or writes
 * the shared editor's content is checked against one golden document with every node and mark.
 */
import '@testing-library/jest-dom/vitest'
import type { JSONContent } from '@tiptap/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import contract from '../../../shared/editor-format-contract.json'
import { findingFromTestCase } from '../findings/fromTestCase'
import { splitTestCases } from '../testware/testCases'
import { notesText } from '../testware/testRunNotes'
import type { RefinementProposal, TestCaseVisual } from '../bindings'
import { ChatProposalContent } from '../views/ChatProposalContent'
import { placement } from '../views/visualPlacement'
import { formatRecordForClipboard } from './clipboardExport'
import {
  normalizeRichEditorDocument,
  richEditorDocumentFromHtml,
  richEditorDocumentToHtml,
  type RichEditorDocument,
} from './editorDocument'
import { normalizeEditorHtml } from './editorHtml'

afterEach(cleanup)

const golden: RichEditorDocument = { schemaVersion: 1, doc: contract.document }
const nodes = golden.doc.content ?? []
const lines = (value: string[]) => value.join('\n')
const range = ([start, end]: number[]) => nodes.slice(start, end)

describe('editor format contract', () => {
  it('keeps every node and mark through JSON to HTML to JSON', () => {
    expect(richEditorDocumentToHtml(golden)).toBe(contract.html)
    expect(richEditorDocumentFromHtml(contract.html)).toEqual(golden)
  })

  it('sanitises HTML without losing a node and strips attributes from the new tags', () => {
    expect(normalizeEditorHtml(contract.html)).toBe(contract.html)
    expect(normalizeEditorHtml(contract.dirtyHtml)).toBe(contract.html)
  })

  it('reads the Rust Markdown parser output and its HTML back as the golden document', () => {
    const parsed = normalizeRichEditorDocument({ schemaVersion: 1, doc: contract.parsedDocument })
    expect(richEditorDocumentToHtml(parsed)).toBe(contract.html)
    expect(richEditorDocumentToHtml(richEditorDocumentFromHtml(contract.rustHtml))).toBe(contract.html)
    expect(richEditorDocumentFromHtml(contract.rustSanitizedHtml)).toEqual(golden)
  })

  it('copies plain Markdown and semantic HTML', () => {
    const payload = formatRecordForClipboard({ title: contract.clipboardTitle, bodyHtml: contract.html })
    expect(payload.plain).toBe(lines(contract.clipboardPlain))
    expect(payload.html).toBe(contract.clipboardHtml)
  })

  it('writes Result notes text with every block on its own line', () => {
    expect(notesText(golden)).toBe(lines(contract.notesText))
  })

  it('splits test cases: H4 to H6 stay inside a case, H1 closes a case and clears the group', () => {
    const split = splitTestCases(golden, contract.split.format)
    expect(split?.preamble).toEqual(range(contract.split.preamble))
    expect(split?.cases).toEqual(contract.split.cases.map((testCase) => ({
      group: testCase.group,
      title: testCase.title,
      lead: range(testCase.lead),
      content: range(testCase.content),
    })))
    expect(split?.trailing).toEqual(range(contract.split.trailing))
  })

  it('copies a failed case with every node into a finding', () => {
    const caseDocument = { schemaVersion: 1, doc: { type: 'doc', content: range(contract.split.cases[0].content) } }
    const finding = findingFromTestCase({ bodyJson: JSON.stringify(caseDocument), remark: null, notes: null })
    const content = finding.doc.content ?? []
    const title = (node: JSONContent) => node.content?.map((child) => child.text ?? '').join('')
    const start = content.findIndex((node) => node.type === 'heading' && title(node) === 'Steps to reproduce') + 1
    const end = content.findIndex((node, index) => index >= start && node.type === 'heading' && node.attrs?.level === 2)
    expect(content.slice(start, end)).toEqual(range(contract.findingStepsToReproduce))
  })

  it('reviews a suggestion by the sections the new headings start', () => {
    const changed = structuredClone(golden)
    const steps = changed.doc.content?.[7].content?.[1].content?.[0].content?.[0]
    if (steps) steps.text = 'Pay with 3DS'
    render(<ChatProposalContent before={golden} after={changed} />)
    expect(screen.getByLabelText('Suggested sections')).toHaveTextContent('StepsOpen checkoutPay with 3DS')
    expect(screen.getByLabelText('Previous sections')).toHaveTextContent('StepsOpen checkoutPay')
    expect(screen.getByLabelText('Suggested sections')).not.toHaveTextContent('Setup')
  })

  it('names where a visual lands by the nearest heading of any level', () => {
    const proposal = { before: { documentJson: JSON.stringify(golden) } } as RefinementProposal
    const visual = { target: contract.visualPlacement.target } as TestCaseVisual
    expect(placement(proposal, visual)).toBe(contract.visualPlacement.label)
  })
})
