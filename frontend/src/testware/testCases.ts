/**
 * Splits a saved Test cases draft into the test cases a test run copies. The draft's output format
 * decides the rule; nothing is guessed from wording. See docs/adr/0012-test-runs-are-frozen-copies.md.
 *
 * Nothing is lost or repeated. Every node that is not part of a case stays where it was: before the
 * first case in `preamble`, between two cases in the later case's `lead` (a group heading and its
 * intro, for example), and after the last case in `trailing`. So
 * `[...preamble, ...cases.flatMap(c => [...c.lead, ...c.content]), ...trailing]` is the document's
 * top-level content. For a checklist each top-level list is first cut into one single-item list per
 * item, with the list's own type and attributes, so every case's content can be shown on its own.
 */
import type { JSONContent } from '@tiptap/core'
import type { RichEditorDocument } from '../editor/editorDocument'
import { manualCreationFormat } from '../app/creationFormats'
import type { Draft, TestwareOutputFormat } from '../tauri'
import { parseTestwareGenerationMetadata } from './generationPreferences'

export type RunnableFormat = Extract<TestwareOutputFormat, 'qa_cases' | 'gherkin' | 'checklist'>

export type TestCase = {
  /** The nearest group heading's text: a level-2 heading over level-3 cases, or any heading over a checklist item. */
  group: string | null
  title: string
  /** Nodes between the previous case and this one that belong to no case, such as a group heading. */
  lead: JSONContent[]
  /** The case's own nodes, its heading included for heading-based formats. */
  content: JSONContent[]
}

export type TestCaseSplit = { preamble: JSONContent[]; cases: TestCase[]; trailing: JSONContent[] }

const listTypes = new Set(['taskList', 'bulletList', 'orderedList'])

/** A leading label that only repeats what a case is. Word labels need a colon. */
const titleLabels = [
  /^test case(?:\s+#?\d+)?\s*:\s*/i,
  /^scenario(?:\s+outline)?\s*:\s*/i,
  /^tc[-\s]?\d+\s*(?::|[-–—·](?=\s))\s*/i,
]

/** The output format of a Test cases draft: the generated one, else the manual one, else null. */
export function draftOutputFormat(draft: Pick<Draft, 'metadataJson'>): TestwareOutputFormat | null {
  const generated = parseTestwareGenerationMetadata(draft)?.outputFormat
  if (generated) return generated
  const manual = manualCreationFormat(draft.metadataJson)
  return manual?.kind === 'testware' ? manual.outputFormat : null
}

/**
 * The draft's test cases, or null when the format cannot be run (charters, coverage outlines) or no
 * case is found. A missing or unknown format, as in older drafts, splits by headings.
 */
export function splitTestCases(document: RichEditorDocument, format: string | null): TestCaseSplit | null {
  if (format === 'charters' || format === 'coverage_outline') return null
  const nodes = document.doc.content ?? []
  const split = format === 'checklist' ? splitChecklist(nodes) : splitByHeadings(nodes)
  return split && split.cases.length > 0 ? split : null
}

/**
 * The case level is 3 when any level-3 heading exists, else 2 when any level-2 heading exists. A case
 * starts at a heading at that level with text and runs until the next heading at that level or above.
 */
function splitByHeadings(nodes: JSONContent[]): TestCaseSplit | null {
  const level = [3, 2].find((candidate) => nodes.some((node) => headingLevel(node) === candidate))
  if (!level) return null
  const builder = new SplitBuilder()
  let group: string | null = null
  let open = false
  for (const node of nodes) {
    const nodeLevel = headingLevel(node)
    if (level === 3 && nodeLevel === 2) group = plainText(node) || null
    if (nodeLevel !== null && nodeLevel <= level) open = false
    if (nodeLevel === level && plainText(node)) {
      builder.startCase({ group: level === 3 ? group : null, title: caseTitle(plainText(node)), node })
      open = true
    } else if (open) {
      builder.addToCase(node)
    } else {
      builder.addLoose(node)
    }
  }
  return builder.finish()
}

/** Each item with text in a top-level list is one case, titled by its first line. */
function splitChecklist(nodes: JSONContent[]): TestCaseSplit {
  const builder = new SplitBuilder()
  let group: string | null = null
  for (const node of nodes) {
    if (node.type === 'heading') group = plainText(node) || group
    if (!listTypes.has(node.type ?? '')) {
      builder.addLoose(node)
      continue
    }
    for (const item of node.content ?? []) {
      const single = { ...node, content: [item] }
      const title = firstLine(item)
      if (title) builder.startCase({ group, title, node: single })
      else builder.addLoose(single)
    }
  }
  return builder.finish()
}

class SplitBuilder {
  private preamble: JSONContent[] = []
  private cases: TestCase[] = []
  private loose: JSONContent[] = []

  startCase({ group, title, node }: { group: string | null; title: string; node: JSONContent }) {
    if (this.cases.length === 0) this.preamble = this.loose
    this.cases.push({ group, title, lead: this.cases.length === 0 ? [] : this.loose, content: [node] })
    this.loose = []
  }

  addToCase(node: JSONContent) {
    this.cases[this.cases.length - 1].content.push(node)
  }

  addLoose(node: JSONContent) {
    this.loose.push(node)
  }

  finish(): TestCaseSplit {
    return { preamble: this.preamble, cases: this.cases, trailing: this.loose }
  }
}

function headingLevel(node: JSONContent): number | null {
  return node.type === 'heading' && typeof node.attrs?.level === 'number' ? node.attrs.level : null
}

function caseTitle(text: string): string {
  const label = titleLabels.find((pattern) => pattern.test(text))
  const stripped = label ? text.replace(label, '').trim() : text
  return stripped || text
}

/** Text with each hard break as a space and runs of white space collapsed. */
function plainText(node: JSONContent): string {
  return lines(node).join(' ').replace(/\s+/g, ' ').trim()
}

function firstLine(node: JSONContent): string {
  return lines(node).map((line) => line.replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
}

/** The node's text split at hard breaks and between blocks. */
function lines(node: JSONContent): string[] {
  const result = ['']
  const visit = (current: JSONContent) => {
    if (current.type === 'text') result[result.length - 1] += current.text ?? ''
    else if (current.type === 'hardBreak') result.push('')
    else {
      const isBlock = current.content !== undefined && current.type !== 'doc'
      current.content?.forEach(visit)
      if (isBlock && result[result.length - 1] !== '') result.push('')
    }
  }
  visit(node)
  return result
}
