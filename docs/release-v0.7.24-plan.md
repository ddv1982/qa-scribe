# v0.7.24 Dependabot integration and release

Integrate the reviewed cargo-binstall action patch through protected CI, then
publish a new stable app release through the normal main-triggered workflow.

## Checklist

- [x] Inspect current PRs, upstream patch/tag provenance, branch protection,
  release procedure and next-version availability.
- [x] Check out and validate exact Dependabot PR #28 head, confirm its bounded
  diff and independently review before normal protected merge.
- [x] Merge the still-current green PR #28 and delete its branch only after
  verifying that the exact reviewed update was merged.
- [x] Create release/v0.7.24 from updated main, bump seven metadata outputs once
  and replace the changelog scaffold with accurate release notes.
- [x] Pass frozen install, workflow lint, online Zizmor, expected-tag metadata
  and the canonical local gate on the release candidate.
- [ ] Independently review, explicitly commit/push the intended files and open
  the release PR.
- [ ] Observe protected release CI for its exact head and merge normally.
- [ ] Verify the merge-triggered Release succeeds, the automatic v0.7.24 tag
  equals its merge SHA, the release is stable/latest, and assets/APT are live.

## Review facts

Initial main is `4ed582d695c580e6bb6bf7fc2c6e7a7792809ec8` (v0.7.23).
At initial inspection, PR [#28](https://github.com/ddv1982/qa-scribe/pull/28) had head
`400f34fafc73a2108f1ed8a8458ba7e79ab50972` and changes only three action
references in `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
The old version in its branch name is not its proposed version.

GitHub's official cargo-binstall v1.25.2 tag resolves to
`c06f6a0003f7c6165a00c89d1697731c9e8a5c72`. Upstream release notes identify
a `sparse+` Cargo-source parsing fix in `.crates.toml` and dependency updates.
The composite action input contract is preserved. The SHA pins action source;
the existing empty `version` input defaults to the latest installed binary.
This work does not claim an exact binary-version pin or change that default.

Initial hosted CI [38457197275](https://github.com/ddv1982/qa-scribe/actions/runs/38457197275)
passed all six jobs. Strict protected `CI success` must be refreshed against the
latest PR head immediately before each merge. [GitHub required-check guidance](https://github.com/github/docs/blob/main/content/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks.md?plain=1#L37#required-check-needs-to-succeed-against-the-latest-commit-sha)
confirms that older-head checks do not discharge the current revision.

## Gates and boundaries

Follow `docs/releasing.md`: frozen frontend install, pinned actionlint and
authenticated Zizmor 1.30.1, `bun run verify`, and expected-tag metadata.
The PR checkout remains v0.7.23; the release candidate becomes v0.7.24.
Hosted native/package checks provide regression evidence for unchanged app code.
No UI edits, broad dependency upgrades, force push, admin bypass or manual tag.
Preserve unrelated `disk-cleanup-plan.md`.

The workflow-only merge does not create a new app release by itself. A fresh
version-bumped release PR is required for the user's requested new tag/release.

Re-read this checklist before each unit and tick only verified work. The
committed snapshot precedes hosted outcomes; every remaining unchecked external
row must be reconciled in final Flow delivery with exact PR/run/release URLs
and SHAs. Do not claim publication early or add a post-release docs-only commit
solely to tick future outcome boxes.

## Durable premerge evidence

Review findings `dependabot-integration.R9-01` and
`dependabot-integration.R9-02` require source-bound authenticated API checks,
not only the local gate. The premerge retry repeated provenance and hosted-state
assertions after the audit edit and rejected head/base/check drift. Those
premerge observations are historical after integration; release-candidate
validation uses its own current-source checks and the merged PR state.

### Upstream old/new source comparison

Compared old commit `7bebc2e59eb8820162b7ac8f62a92bfdb2732447` with new commit
`c06f6a0003f7c6165a00c89d1697731c9e8a5c72` through GitHub Contents API.
Both versions contain byte-identical action and referenced installer files:

| Path | Old and new Git blob SHA |
| --- | --- |
| `action.yml` | `bfe4fcd6726e2a272313ea120c3492fa1d979e0e` |
| `install-from-binstall-release.sh` | `65ef8de1f5c4df887ae79da96059b2ea4d552bde` |
| `install-from-binstall-release.ps1` | `5bba48bab9ca20cdd82bf8042f67892f41486287` |

Immutable sources: [action](https://github.com/cargo-bins/cargo-binstall/blob/c06f6a0003f7c6165a00c89d1697731c9e8a5c72/action.yml),
[Unix installer](https://github.com/cargo-bins/cargo-binstall/blob/c06f6a0003f7c6165a00c89d1697731c9e8a5c72/install-from-binstall-release.sh),
[Windows installer](https://github.com/cargo-bins/cargo-binstall/blob/c06f6a0003f7c6165a00c89d1697731c9e8a5c72/install-from-binstall-release.ps1).
The action's complete input/execution contract, identical at both revisions:

```yaml
name: 'Install cargo-binstall'
description: 'Install cargo-binstall tool'

inputs:
  version:
    description: 'Version of cargo-binstall to install (e.g. 1.2.3 or v1.2.3). Defaults to latest.'
    required: false
    default: ''

runs:
  using: composite
  steps:
    - name: Install cargo-binstall
      if: runner.os != 'Windows'
      shell: sh
      env:
        BINSTALL_VERSION: ${{ inputs.version }}
      run: |
        set -eu
        bash "$GITHUB_ACTION_PATH/install-from-binstall-release.sh"
    - name: Install cargo-binstall
      if: runner.os == 'Windows'
      shell: powershell
      env:
        BINSTALL_VERSION: ${{ inputs.version }}
      run: Set-ExecutionPolicy Unrestricted -Scope Process; iex "$Env:GITHUB_ACTION_PATH/install-from-binstall-release.ps1"
```

The Unix installer normalizes nonempty versions with a `v` prefix, then uses:

```sh
if [ -z "${BINSTALL_VERSION:-}" ]; then
    base_url="https://github.com/cargo-bins/cargo-binstall/releases/latest/download/cargo-binstall-"
else
    base_url="https://github.com/cargo-bins/cargo-binstall/releases/download/${BINSTALL_VERSION}/cargo-binstall-"
fi
```

The Windows installer reads `$Env:BINSTALL_VERSION`, normalizes its prefix and uses:

```powershell
$base_url = if (-not $BINSTALL_VERSION) {
    "https://github.com/cargo-bins/cargo-binstall/releases/latest/download/cargo-binstall-"
} else {
    "https://github.com/cargo-bins/cargo-binstall/releases/download/$BINSTALL_VERSION/cargo-binstall-"
}
```

The authenticated provenance check resolves the official tag, checks its release
notes, compares complete decoded old/new bytes and the expected blob IDs for
all three files, and emits their full decoded sources. Thus default behavior,
platform download/self-install and PATH handling are unchanged at this boundary.

### Exact-head hosted observations

The premerge snapshot recorded PR28 open/CLEAN with head `400f34fafc73a2108f1ed8a8458ba7e79ab50972`,
base `4ed582d695c580e6bb6bf7fc2c6e7a7792809ec8`. Run `38457197275` is
completed/success for that head. All six jobs succeeded: Detect changed files,
Quality gate (Linux), Built application E2E (macOS arm64, observational),
Platform tests (macOS arm64 + Intel check), Package test (Linux x64), CI success.
Main protection requires `CI success` with `strict: true`; required approving
review count is zero. Authenticated API assertions bind these values together,
and `gh pr checks 28 --required` must pass. The manager must repeat the fresh
head/base/protection/CI guard immediately before the match-head merge.

### Integration result

The complete independent retry review passed. Provenance validation
`86ca6be2-5a17-4d60-b861-1eb43cfe7eb1` and hosted eligibility validation
`51318048-c05a-464a-aa2b-0fe6ea3005fc` resolved both evidence findings.
Frozen install, workflow/online security checks, v0.7.23 metadata and the full
local gate passed on the reviewed sources. A fresh exact-head/protection/CI
guard passed immediately before the normal match-head merge.

PR28 was merged at `853f061734c1853b6d1340cf857f5cfe946f5eef`, retaining
reviewed head `400f34fafc73a2108f1ed8a8458ba7e79ab50972`. GitHub removed
the bot branch; a guarded remote lookup confirmed it absent after actual merge.
The fresh release/v0.7.24 branch starts at that updated main SHA and contains
the reviewed head by ancestry check. No newer bot update was discarded.

### Candidate metadata

Rechecked v0.7.24 is unused before the bump. The maintained script updated all
seven version outputs once; its expected TODO-scaffold rejection was resolved
with accurate action-source maintenance notes. Expected-tag validation
`2a301a65-95b9-4c36-94cc-29be29d20c19` passed for v0.7.24.

The candidate validation group `1f55fb66-5ac9-4f9d-8501-c19e0dd25aa5`
passed frozen install without lockfile changes, actionlint 1.7.12, authenticated
Zizmor 1.30.1 (no new findings; 33 existing suppressions), expected-tag metadata
and the full repository gate. It covered 316 frontend tests, 367 Rust tests,
122 release-script tests, builds and smoke checks. Existing audit-registry
findings and two authenticated-CLI tests ignored by the maintained suite remain
unchanged. Final focused checks and the exact broad gate are repeated after
this checklist update for source-bound independent review.
