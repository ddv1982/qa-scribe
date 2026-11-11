# CI and release simplification

Baseline: `main` at v0.8.26, investigated 2026-10-27. Protected branch
requires `CI success` with strict up-to-date checks. CI always runs Linux
quality, conditionally runs macOS and Linux package checks, and records macOS
built-app E2E as observational. Release repeats the full Linux gate on the
merge commit, then builds and smoke-tests signed installers, signs checksums,
deploys APT, and publishes the draft. The v0.8.26 release succeeded in about
39 minutes: validation took 24 minutes and the parallel builds were dominated
by macOS arm64 at 13 minutes. The published release has all 11 expected assets.
These are one-run observations, not reliability or performance benchmarks.

## Phase 1: remove drift without changing gates

Share the identical Linux validation dependency installation between CI and
release, preserve the existing jobs and privileges, and correct the runner
information in `ci.md`. Validate workflow contracts locally and the protected
CI on the PR. A real release after merge is needed to prove the release-side
call on GitHub-hosted runners.

## Phase 2: measure before shortening the critical path

Collect job durations and failures for several releases, including cold-cache
runs, and identify failures that require operator recovery. Compare CI and
release validation at their exact commits; a PR check on a different commit is
not evidence for the merge commit. Investigate whether a verified exact-commit
CI result can safely replace repeated release validation, or whether builds can
start earlier without exposing signing secrets to unvalidated code. Keep the
current gate until a replacement demonstrates equivalent coverage and failure
behavior. Do not assume a shorter YAML file makes the release simpler.

## Phase 3: simplify operation and recovery

Exercise draft recovery, reruns, older-tag APT protection, and asset verification
on a disposable test repository before changing publication. Consolidate the
operator instructions around the normal version bump, PR, merge-triggered run,
and verification, retaining explicit recovery steps. Keep signed checksum,
installer smoke, separate write privileges, and monotonic APT safeguards unless
an equally strong replacement is proven. Verify a real release and its expected
assets after the changes land.

The stable required-check name matters: GitHub notes that a workflow skipped by
path filters can leave a required check pending. Keep the unconditional CI
workflow and its aggregate check while changing internal routing. See
[GitHub's required-check troubleshooting](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
and [secure use guidance](https://docs.github.com/en/actions/reference/security/secure-use).
