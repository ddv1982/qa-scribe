# Verify I1 in the native application

The parent owns the native lane. Run this recipe only after the baseline qualification releases that lane and after the parent reviews the candidate source. The implementation delegate has not run this spec or built the native application.

Use the maintained runner from the repository root. Set `QA_SCRIBE_E2E_SOURCE_SHA` to the exact candidate commit. Keep the pinned toolchain and isolated app data. The runner copies `v18.sqlite` and its four images from this directory, checks the frozen database hash, then runs the initial process and two fresh native processes against that private copy. It refuses to overwrite an existing database during initial preparation.

```sh
export PATH=/Users/vriesd/.npm/_npx/bb6645c1041000be/node_modules/.bin:/tmp/ask-ai-node24/node-v24.22.1-darwin-arm64/bin:$PATH
export TMPDIR=/private/tmp
export QA_SCRIBE_E2E_SOURCE_SHA=<candidate-commit>
QA_SCRIBE_I1_NATIVE_LANE_RELEASED=1 QA_SCRIBE_E2E_SPEC=ask-ai-ownership-migration.e2e.mjs bun run e2e
```

On Linux, use the same variables and spec with `GDK_BACKEND=x11 xvfb-run -a bun run e2e`. The repository-pinned Bun version is 1.3.5. Node is 24.22.1 in the supplied macOS recipe. CI uses its installed pinned tools and does not require either absolute host path.

An already built candidate can use `QA_SCRIBE_E2E_SKIP_BUILD=1`. The runner requires its ordinary E2E binary under `target/debug/qa-scribe-tauri`. Record the source commit and binary hash before using this option. Never substitute the baseline binary. The receipt records the running binary hash.

The initial process runs lanes 1, 2, and 4 through 10. Each reopen runs lane 3. Each invocation writes `ownership-migration.json` and `lane-<n>-<phase>.png` in its own artifact directory. The maintained execution receipt and native logs remain alongside them. Every receipt must report completion, and no synthetic provider execution may occur.

1. Lane 1 compares every original chat and attachment cell with the frozen fixture. It opens active Notes through the existing UI and checks the literal composer, 100 messages, and four sent images.
2. Lane 2 opens submitted Notes and checks its original receipt and canonical Note. An explicit command replay with a stale revision must return the original receipt without a Note write.
3. Lane 3 opens the same Notes in two subsequent native processes. Its exact state and visible composer must match the first process.
4. Lane 4 opens mixed Notes. It checks all ten messages, all context variants, and all three original unresolved stages. Two stages still target the same Finding.
5. Lane 5 uses scoped history and exact command reads to recover an archive. It checks its original ID and ten messages, then rejects a composer mutation.
6. Lane 6 seeds hidden Finding and Test cases conversations through the I1 commands. The existing Notes UI must retain its original composer and show neither hidden input.
7. Lane 7 creates and replays one UUID through the command boundary. One row exists. Another owner fails without an activity change.
8. Lane 8 rejects record-owned Note submission and Notes restart through the command boundary. The canonical Note stays unchanged.
9. Lane 9 selects the original legacy Finding, opens the existing Ask AI panel, reviews one original staged proposal, applies it locally, and clicks the ordinary record Save button. The same stage becomes Saved. Other legacy stages remain retained.
10. Lane 10 seeds a synthetic source through the command boundary, selects its original Session and Finding through the existing UI, clicks its record Delete action, and confirms Delete finding permanently. A read-only command confirms the source disappeared. Exact read, scoped history, and same-UUID replay retain its conversation. A new launch fails.

Lanes 5 through 8 exercise hidden APIs. Lane 10 combines existing UI deletion with hidden conversation retention checks. Their screenshots show the surrounding existing application and accompany command diagnostics. They do not prove future record-launch, Continue, or History controls. Lanes 1, 2, 3, 4, 6, 9, and 10 also check the stated existing UI behavior. A syntax check and fixture-runner unit tests do not establish that the native selectors pass.

The benchmark and its baseline preparation helpers remain parent-owned. This recipe does not qualify performance or claim that any native lane passed.
