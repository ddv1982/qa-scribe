# ADR 0012: Test runs are frozen copies of a draft's test cases

**Status:** Accepted

**Date:** 2026-11-13

## Context

Testers want to run a Test cases draft and record what happened to each test
case. The obvious place for a result is the draft itself, next to the case. It
cannot survive there. Ask AI rebuilds a draft from Markdown, and four
sanitising filters strip markup they do not know, so a result written into the
document is lost on the next update. A draft also keeps changing after it was
run, which makes an old result point at text that no longer says the same thing.

A run also has to know where one test case ends and the next begins. Guessing
that from wording is unreliable: the five output formats look different, and
models do not always follow the format they were asked for.

## Decision

1. **A Test run is a frozen copy.** "Start test run" on a saved Test cases draft
   copies the draft's test cases as they are at that moment. Each copied test
   case gets a result (passed, failed, blocked or not run) and an optional
   remark. Results never live in the draft document. Editing the draft later
   does not change its runs.
2. **One splitting rule per format.** The draft's output format decides how it
   splits into test cases. Nothing is guessed from wording.
   - QA test cases, Gherkin-style scenarios, and older drafts without a format
     split at headings. The case level is 3 when the draft has a level-3
     heading, otherwise 2. A case runs from its heading to the next heading at
     that level or above. Over level-3 cases, the level-2 heading names the
     group. A leading label such as `Test case:`, `Scenario:`, `Feature:` or
     `TC-1:` is dropped from the title and the group.
   - A checklist with a level-3 heading splits by headings in the same way,
     because models write a checklist as a heading per test case with its
     checks listed under it. A checklist without level-3 headings splits per
     item: every item of a top-level list is one test case, titled by its
     first line, grouped by the nearest heading above it.
   - Text outside any case stays with the draft as context. A draft with no
     case cannot be run.
3. **Only some formats can be run.** QA test cases, Gherkin-style scenarios and
   checklists can be run. Exploratory charters and coverage outlines cannot.
4. **AI only reads a test run.** Ask AI on a test run is read-only: the
   conversation gets the test run report as context and can act on it with
   the tools of the tester's AI CLI, under its usual permission prompts. AI
   never sets or rewrites a result, and no change to a test run is ever
   offered or accepted.

   _Changed 2026-11-13._ This decision first said that Ask AI is not offered
   on a test run. Testers want to hand the results on, to a Jira issue or a
   Confluence page, and the AI CLI already has the tools and permissions for
   that, so Ask AI is now offered on a test run, read-only.
5. **Runs belong to their draft.** Deleting a Test cases draft deletes its test
   runs, and the delete confirmation says so.
6. **One name.** The UI always says "test run", never "run", because AI Run
   already means a record of an AI request.

## Consequences

- The split lives in one pure function, `frontend/src/testware/testCases.ts`,
  tested against real model output on synthetic notes in
  `frontend/src/testware/__fixtures__/generated/`.
- The manual QA cases starter uses one h3 per test case, with bold labels for
  its parts, so it splits the same way as generated drafts. Drafts saved from
  the earlier starter, which used an h3 for every section, are not migrated and
  split at every section.
- Prefill from Note writes the Note as a labelled paragraph, not under a
  heading, so it is never counted as a test case.
- A test run shows the cases as they were. Fixing a typo in the draft needs a
  new test run to show up there.
- A test run owns its own Ask AI conversation (owner kind `test_run`). Every
  turn reads the run's current results from storage into a plain text report,
  laid out like Copy report, and the conversation never carries a record
  snapshot, so it cannot produce a proposal for the draft.
