# v0.7.23 release checklist

Publish the verified UI/dependency work through the existing protected PR and
main-triggered Release workflow. The workflow creates the new tag at the exact
merge SHA and publishes only after platform and APT jobs succeed.

- [x] Inspect release documentation, protected branch requirements, current main,
  existing work and next version availability (v0.7.23 is unused).
- [x] Preserve accepted work in a scoped recovery stash and integrate it onto a
  fresh release/v0.7.23 branch from current main, retaining upstream action pins.
- [x] Correct prior coverage/toolchain documentation, bump all version metadata
  with the maintained script, and provide real v0.7.23 changelog notes.
- [x] Verify frozen dependency install, workflow lint and online Zizmor,
  expected-tag metadata, native critical/UI workflows and the full local gate.
- [ ] Independently review, explicitly stage/commit the intended release files,
  push the release branch and open its PR against main.
- [ ] Observe protected CI success for the exact release PR revision and merge
  through the normal protected path.
- [ ] Observe the merge-triggered Release run, verify exact v0.7.23 tag-to-merge
  identity, published stable/latest release, installers and live APT version.
- [ ] Verify Dependabot PR #28 is superseded on main with passing CI, then close
  it and delete its branch if Dependabot has not already done so.

## Evidence rules

Source-preparation boxes are checked only after their command output is read.
The committed snapshot necessarily precedes hosted outcomes. Reconcile every
later unchecked box in final Flow delivery with PR/run/release URLs and SHAs,
rather than claiming those outcomes before they happen or adding a post-release
documentation-only commit merely to tick boxes.

Local checks follow docs/releasing.md: frozen install, pinned workflow tools,
authenticated Zizmor, `bun run verify`, explicit expected-tag metadata and native
E2E/UI checks. Hosted `CI success` is required with strict up-to-date protection.
No admin bypass, force push, direct main push or manual tag is included.

Preserve unrelated disk-cleanup-plan.md and all current-main action updates.
The user authorized CI-conditioned merge and automatic release publication.
If a gate fails, diagnose it before changing source or retrying publication.

Integration check: release/v0.7.23 starts at origin/main `1efeab5`; the preserved
stash is `12984bf83844da13cd8fb10cb6f53ccbb4ee18c5`. Only three expected
cargo-binstall references conflicted. Their diff against main now exactly
matches PR #28, while checkout 7.0.1, paths-filter 4.0.3 and deploy-pages 5.0.1
remain intact. `git diff --check` and ancestry checks passed; unrelated work
remains untracked and unstaged.

Metadata check: the maintained bump script updated all seven outputs once; its
expected scaffold rejection was resolved with real changelog notes.
`node scripts/check-release-metadata.mjs --expected-tag v0.7.23` passed.
Prior documentation now distinguishes the 640px E2E minimum from production
320px and production Vite 7 from Vitest's nested Vite 8 dependency.

Local checks passed: frozen install without lockfile changes, actionlint 1.7.12,
authenticated Zizmor 1.30.1 (no new findings; 33 existing suppressions), full
`bun run verify`, all five isolated native critical workflows, and the UI
scenario with 21 captures at actual 1280×860 and 640×860 in both themes.
The candidate still requires independent review and hosted CI/publication.
