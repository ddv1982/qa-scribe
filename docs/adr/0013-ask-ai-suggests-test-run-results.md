# ADR 0013: Ask AI suggests test run results

**Status:** Proposed

**Date:** 2026-11-24

## Context

Ask AI can read a test run report and discuss what happened. When a tester
describes what happened across several test cases, they still have to enter each
Result and its notes by hand. A tester needs to review each suggestion and keep
any observations or screenshots they already saved.

## Decision

1. **One reply can cover several test cases.** Ask AI can suggest a Result, an
   addition to Result notes, or both for one or more cases of the same test run.
   A suggested Result requires a rationale. A row can also suggest attaching
   application logs captured and approved in the same conversation.
2. **The tester applies the changes.** A "Suggested results" card shows one row
   per suggested case with the current and proposed Result, the rationale and
   the notes to append. "Update" applies one row. "Apply all" applies the
   eligible rows and reports any out-of-date rows it skipped. Only those tester
   actions write a suggestion to a case. Result notes are appended to the
   existing notes, including any legacy remark.
3. **Each row checks the case before writing.** A base fingerprint captures the
   saved Result, notes JSON and legacy remark used for the suggestion. A row
   becomes "Out of date" if the current values differ from that base before
   Apply. An applied row offers "Undo", which restores the exact previous
   Result, notes JSON and legacy remark only while the case still matches the
   applied fingerprint.

4. **The tester approves each query.** The app shows the primary Azure target,
   full KQL, UTC window and what will be sent to the selected provider. Azure
   CLI runs under the tester’s account permissions, including for cross-resource
   expressions and saved functions. An approved query can yield one bounded
   capture. Approval of the query and Apply on the suggestion are separate
   actions. Apply attaches capture IDs from that conversation and run, and Undo
   detaches captures attached by that update.

This decision implements D4 of the [test run plan](../test-runs-editor-logs-plan.md#decisions)
and supersedes decision 4 of [ADR 0012](0012-test-runs-are-frozen-copies.md#decision).

## Consequences

- The tester can describe a set of outcomes in one message and decide which
  rows to apply. The copied case instructions stay frozen.
- Each row needs its own saved base and enough information to reverse its
  update. Applying several rows can succeed for some cases while others need
  fresh suggestions.
- Suggestions for Results and Result notes work without application logs.

## Alternatives considered

- **One case per reply.** Each outcome would require a separate turn, even when
  the tester describes several outcomes together.
- **Free-text suggestions only.** The tester would still have to enter every
  Result manually and copy the relevant additions into each case's notes.
