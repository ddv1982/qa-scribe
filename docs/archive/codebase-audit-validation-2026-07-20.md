# Codebase Audit Validation Evidence

This record makes the audit's renderer and command evidence inspectable during
independent review. It is evidence for the audit artifacts, not a replacement
for the strict ledger in `docs/codebase-audit-2026-07-20.json`.

## Canonical Render

`flow_audit_render` accepted the exact ledger with `status: ok` and returned:

- total: 22
- actionable: 17
- remediation items: 17
- dispositions: confirmed=13, hardening=4, refuted=5
- severities: high=1, medium=13, low=3, informational=5
- priorities: next=14, backlog=3, none=5
- proof states: reproduced=2, source_proven=18, invariant_only=1, unverified=1

The complete returned canonical Markdown was written unchanged to
`docs/codebase-audit-2026-07-20.md`. Its `<!-- audit-ledger/v1 -->` marker and
derived summary match the JSON source of truth.

## Runtime-Attested Checks

Artifact reconciliation command:

```sh
node -e "const fs=require('fs'); const ledger=JSON.parse(fs.readFileSync('docs/codebase-audit-2026-07-20.json','utf8')); const md=fs.readFileSync('docs/codebase-audit-2026-07-20.md','utf8'); if(ledger.version!=='audit-ledger/v1'||ledger.findings.length!==22||!md.includes('<!-- audit-ledger/v1 -->')||!md.includes('Total findings: 22')) throw new Error('audit artifact mismatch'); console.log('audit artifacts valid: 22 findings')"
```

Observed outcome: passed with `audit artifacts valid: 22 findings`.

Validation receipt: `sha256:8792fc8e1330634c80091181c0e9567af3e8d9fb2d19039033c0f6d4441c9fdb`.

Focused project command:

```sh
bun run frontend:test && cargo test -p qa-scribe-core && cargo test -p qa-scribe-tauri jobs::tests && bun run release:script-tests && bun run linux:metadata:test && bun run tauri:commands:check && bun run code-size:check
```

Observed outcome: passed. The run included 180 frontend tests, 177 core tests,
5 targeted JobStore tests, 65 release-script tests, 5 Linux metadata/archive
tests, the 33-command Tauri surface check, and the code-size policy check.

Validation receipt: `sha256:ad8fc3d91c39c3f6f05c6b33dc90e79e6c36016f5fcb7a06e0a1fdfc1631d0c6`.

## Reproduced Claims

`AUD-008` was observed during the bounded runtime audit: the full
`cargo test -p qa-scribe-tauri` run reported 116 passed, 1 failed, and 2 ignored.
The failure was
`commands::providers::tests::provider_probe_cleans_temp_files_when_spawn_fails`;
the exact isolated rerun passed. Source inspection showed that the failing test's
mutex is not shared by same-prefix temporary-directory tests in
`commands/providers/probe/command.rs`, which establishes the inter-test race
rather than a production cleanup defect.

`AUD-R03` was reproduced both during the bounded runtime audit and in the
runtime-attested focused project command. `bun run tauri:commands:check` passed
with `33 commands and the main-window core permissions agree`.

## Scope Limits

No packaged installer was available for installation testing, no authenticated
provider command was used, and built-application E2E was not rerun for this
report. The corresponding ledger entries are therefore calibrated as source
proof or hardening gaps rather than reproduced product failures.
