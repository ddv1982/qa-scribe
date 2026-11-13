/**
 * Acceptance criteria are plain text: one criterion per line, each starting with an id such as
 * `AC-1` or `SHOP-412`. A criterion id written in a test case is the link between the two, so
 * coverage is a whole-token text match and survives editing, Copy and Ask AI rewrites.
 */

export type AcceptanceCriterion = { id: string; text: string }

export type CriteriaCoverage = { covered: string[]; uncovered: AcceptanceCriterion[] }

/** Maximum stored length, matching `SESSION_ACCEPTANCE_CRITERIA_MAX_LENGTH` in the core crate. */
export const ACCEPTANCE_CRITERIA_MAX_LENGTH = 8000

/**
 * A leading id, then an optional `:` `.` `)` or `-` separator and spaces before the text. An id may
 * be hierarchical, such as `REQ-1.2`.
 */
const leadingId = /^([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)(?:[:.)-]\s*|\s+|$)/

function parseLine(line: string): { id: string | null; text: string } {
  const match = leadingId.exec(line)
  return match ? { id: match[1], text: line.slice(match[0].length).trim() } : { id: null, text: line }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** One criterion per non-empty line that starts with an id. Lines without an id are skipped. */
export function parseCriteria(text: string | null | undefined): AcceptanceCriterion[] {
  return lines(text ?? '').flatMap((line) => {
    const { id, text: rest } = parseLine(line)
    return id ? [{ id, text: rest }] : []
  })
}

/**
 * Trims lines and drops empty ones. A line without an id, or with an id already used above it
 * (case-insensitively), gets the next free `AC-<n>` in its place: the smallest positive n not yet
 * taken by an `AC-<n>` id in the list. Returns `<ID> <text>` lines, or an empty string.
 */
export function normalizeCriteria(text: string): string {
  const parsed = lines(text).map(parseLine)
  const keyed = (id: string) => id.toUpperCase()
  const taken = new Set(parsed.flatMap(({ id }) => id ? [keyed(id)] : []))
  const seen = new Set<string>()
  let next = 1
  const freeId = () => {
    while (taken.has(`AC-${next}`)) next += 1
    taken.add(`AC-${next}`)
    return `AC-${next}`
  }
  return parsed.map(({ id, text: rest }) => {
    const finalId = id && !seen.has(keyed(id)) ? id : freeId()
    seen.add(keyed(finalId))
    return rest ? `${finalId} ${rest}` : finalId
  }).join('\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A criterion id as a whole token: not inside a longer id such as `AC-12`, `XAC-1` or `AC-1.2`. */
function idPattern(id: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9-])${escapeRegExp(id)}(?![A-Za-z0-9]|\\.\\d)`, 'i')
}

/** Which criteria the documents (plain text of saved test cases) mention by id. */
export function criteriaCoverage(criteria: AcceptanceCriterion[], documents: string[]): CriteriaCoverage {
  const covered: string[] = []
  const uncovered: AcceptanceCriterion[] = []
  for (const criterion of criteria) {
    const pattern = idPattern(criterion.id)
    if (documents.some((document) => pattern.test(document))) covered.push(criterion.id)
    else uncovered.push(criterion)
  }
  return { covered, uncovered }
}
