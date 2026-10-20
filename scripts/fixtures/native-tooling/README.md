# Native tooling migration expectations

`lint-parity.json` records the 109 active production rules from the pinned legacy
configuration at commit `82f1502`. It includes severities, normalized default
options, file scopes, native rule mappings, and the four exact test relaxations.
Historical preset hashes identify the source read before dependency removal.
They are provenance records, not paths in the current installation.

The guard asks Oxlint to parse and normalize the current configuration. It
compares the normalized rule settings in representative production, test,
harness, Vite, and test-support contexts. Oxlint's printed configuration retains
overrides. Behavioral fixtures independently prove that those overrides apply.

`typed-cases.json` supplies valid and invalid examples for every active typed
rule. `lint-cases.json` adds Hooks, Refresh, meaningful default options, directive
scope, and strict syntax. The harness exercises all typed invalid examples in
production, both test extensions, test harnesses, and strict test-support files.
Only the four documented rules relax in tests. Unsafe arguments and member
access remain errors. The Vite configuration receives a separate typed failure.
Build output and scripts remain ignored.

`lint-diagnostics.json` freezes the reviewed native diagnostic identities,
severities, and source ranges for those literal fixtures. It is an expectation,
not generated during verification. Clean and warning-only groups must exit zero;
the error group must exit one. Parser diagnostics cannot satisfy typed rule
expectations. Review fixture edits and expectation edits together.

The migration has four explicit dispositions. The
[upstream migrator at version 1.89.0](https://github.com/oxc-project/oxlint-migrate/blob/ce9d32e548bb75d77a9034d9b9bb0b5ec5aab907/src/generated/unsupported-rules.json)
identifies strict syntax as the replacement for `no-dupe-args` and `no-octal`.
The fixtures reject duplicate parameters and old octal literals and accept their
corrected counterparts. The old TypeScript preset already disabled
`no-dupe-args` for TypeScript files. React compiler configuration and gating
validators have no configurable inputs in Oxlint's fixed compiler setup. The
native Hooks implementation preserves the applicable compiler diagnostics.

Oxlint's `preserve-caught-error` exposes `requireCatchParameter`, but no custom
Error-class list. The legacy list was empty. The recorded native setting omits
that unsupported empty option. Fixtures prove built-in Error preservation,
rejection of lost causes, and allowed catch clauses without parameters.

The dependency tests describe legacy packages in inert metadata and source
fixtures. They never install or execute TypeScript 6. Static runtime-import
inspection excludes declarations, type-only imports, comments, and examples in
strings. It accepts TypeScript package metadata reads. Computed dynamic module
loads require dependency review and are outside that static proof.
