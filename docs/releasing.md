# Release Workflow

Use this workflow when publishing downloadable QA Scribe desktop artifacts.

The app runtime is Tauri with a bundled Vite frontend. Bun is used for the
frontend install/build/test path; Node is used for repository release scripts.

## Version And Tag

The stable release workflow accepts only stable SemVer versions and tags in the
`X.Y.Z` / `vX.Y.Z` shape. Prerelease or build-metadata versions such as
`1.0.0-beta.1` and `1.0.0+build.1` are rejected instead of being published as
stable/latest artifacts.

Create a release branch from the current protected `main`, then bump the version
with the single write-path script instead of hand-editing
files. It updates `package.json`, `frontend/package.json`, `Cargo.toml`
(`[workspace.package]`), `Cargo.lock` (the `qa-scribe-app`/`qa-scribe-core`/
`qa-scribe-tauri` entries), `src-tauri/tauri.conf.json`, inserts a
`## v<version> - <date>` scaffold at the top of `CHANGELOG.md`, and inserts a
new `<release>` entry in
`build/linux/io.github.ddv1982.qa-scribe.metainfo.xml`:

```bash
git fetch origin main
git switch -c release/v1.0.0 origin/main
bun run bump 1.0.0
```

Add `--dry-run` to preview the changes without writing anything:

```bash
bun run bump 1.0.0 --dry-run
```

The script fails loudly if the tracked files currently disagree on the
version, including the `Cargo.lock` package entries for `qa-scribe-app`,
`qa-scribe-core`, and `qa-scribe-tauri` (a pre-flight consistency check), and it runs
`scripts/check-release-metadata.mjs` at the end as verification. That
verification will fail until you replace the `- TODO: describe this
release.` placeholder it inserts into `CHANGELOG.md` with real release
notes — fill those in, then re-run the check:

```bash
node scripts/check-release-metadata.mjs --expected-tag v1.0.0
```

Before replacing anything, the bump script writes an on-disk
`.qa-scribe-version-transaction.json` manifest, then stages all seven new
outputs and a rollback copy beside each destination. Same-directory renames
make each file replacement atomic on the supported release hosts. If the
process is terminated between replacements, the next invocation, including a
dry run, reads the manifest before preflight and restores the prior consistent
version. If the committed phase was recorded before termination, it keeps the
new version and finishes transaction-file cleanup instead. Synchronous replacement failures still roll
back immediately; an incomplete rollback leaves the manifest and copies for
automatic retry on the next invocation. The script also refuses to overwrite a
destination changed during staging, immediately before replacement, or after an
interrupted replacement. Run the
bump only in a dedicated checkout with no concurrent repository writers:
ordinary filesystem renames do not provide compare-and-swap coordination with
another process editing between system calls.

`frontend/bun.lock` does not need updating: it only records third-party
dependency versions, not the frontend workspace's own `version` field.
`Cargo.lock` does need to stay in sync with the app version because the Rust
workspace packages are released from that lockfile; both `bun run bump` and the
release metadata check enforce this.

The metadata check also gates the Linux Tauri package identity: `src-tauri/tauri.linux.conf.json` keeps the installed desktop file at `qa-scribe.desktop`, while `build/linux/qa-scribe.desktop.hbs` keeps the visible app name as QA Scribe. `src-tauri/tauri.conf.json` must list every generated Linux PNG icon size from `build/icons/16x16.png` through `build/icons/1024x1024.png` so `.deb`/`.rpm` installers provide a desktop-resolvable hicolor icon.

The release metadata check also rejects tracked Local AI model/runtime artifacts such as `.gguf` files, model caches, Ollama caches, and `llama-server` binaries. Local AI model download remains an in-app/Ollama setup step, not a bundled release asset.

Commit the release metadata, push the branch, and merge it through a pull
request after the required checks pass:

```bash
git add -A
git commit -m "lore(release): v1.0.0"
git push -u origin release/v1.0.0
gh pr create --base main --head release/v1.0.0 --title "lore(release): v1.0.0"
gh pr checks --watch
gh pr merge --merge --delete-branch
```

Tag the exact merge commit, rather than whichever commit happens to be at the
tip of `main` later, and push the tag to start the Release workflow:

```bash
release_commit="$(gh pr view release/v1.0.0 --json mergeCommit --jq '.mergeCommit.oid')"
git tag v1.0.0 "${release_commit}"
git push origin v1.0.0
```

## Artifact Model

The release workflow builds Tauri desktop artifacts:

- macOS: signed and notarized `.dmg` installers named with standard architecture suffixes, for example `QA.Scribe_1.0.0_aarch64.dmg` and `QA.Scribe_1.0.0_x64.dmg`
- Linux: `.deb`, `.rpm`, AppImage, APT repository, APT repository setup `.deb`, setup checksum sidecar, setup checksum signature, and `install-apt-repo.sh`

Artifacts are written to `dist/rust/artifacts/`. The GitHub Release intentionally publishes only user-facing installers and APT bootstrap files; the archive keyring stays on GitHub Pages because it is consumed by `install-apt-repo.sh`.

CI and release jobs install the exact Tauri CLI version pinned in
`scripts/tool-versions.json`. `scripts/install-tauri-cli.mjs` validates that the
pin shares the locked `tauri` runtime's major/minor version before invoking
`cargo binstall`; patch versions may differ because the two crates are not
published in lockstep. Workflow files do not carry another CLI version.

## macOS Prerequisites

Configure these GitHub Actions secrets before pushing a release tag:

- `CSC_LINK`: base64-encoded Developer ID Application `.p12` certificate
- `CSC_KEY_PASSWORD`: password for the `.p12` certificate
- `MACOS_DEVELOPER_ID`: optional Developer ID identity passed to `codesign`
- `MACOS_TEAM_ID`: optional Apple Developer Team ID
- `APPLE_API_KEY`: base64-encoded App Store Connect `.p8` private key content
- `APPLE_API_KEY_ID`: App Store Connect key ID
- `APPLE_API_ISSUER`: App Store Connect issuer ID

Create the signing inputs from an Apple Developer Program account:

1. Create a Developer ID Application certificate in Apple Developer Certificates.
2. Import it into Keychain Access, then export it as a password-protected `.p12`.
3. Encode the certificate for GitHub:

```bash
openssl base64 -A -in DeveloperIDApplication.p12 -out developer-id-application.p12.base64
```

4. Create an App Store Connect API key with Developer access, download the `.p8` once, and record its Key ID and Issuer ID.
5. Encode the API key for GitHub:

```bash
openssl base64 -A -in AuthKey_XXXXXXXXXX.p8 -out authkey.p8.base64
```

6. Add the values in GitHub under Settings -> Secrets and variables -> Actions -> Repository secrets:

```bash
gh secret set CSC_LINK < developer-id-application.p12.base64
gh secret set CSC_KEY_PASSWORD
gh secret set APPLE_API_KEY < authkey.p8.base64
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER
gh secret set MACOS_DEVELOPER_ID
gh secret set MACOS_TEAM_ID
```

`MACOS_DEVELOPER_ID` and `MACOS_TEAM_ID` are optional because the workflow derives them from the certificate when possible, but setting them explicitly makes failures easier to diagnose.

The workflow imports the certificate into a temporary keychain, signs the `.app`, notarizes and staples it, creates a `.dmg`, signs/notarizes/staples the `.dmg`, then verifies both artifacts.

## Linux Prerequisites

Linux release jobs run on Ubuntu and build the current host platform through
Tauri, embedding `frontend/dist` into the desktop bundle.

Configure these signing inputs:

- `DEB_SIGNING_PRIVATE_KEY`: base64-encoded ASCII-armored GPG private key
- `DEB_SIGNING_KEY_FINGERPRINT`: full fingerprint for the Linux signing key
- `DEB_SIGNING_KEY_PASSPHRASE`: passphrase for the Linux signing key
- `DEB_SIGNING_PUBLIC_KEY`: repository variable containing the base64-encoded ASCII-armored public key

Create and encode the Linux signing inputs:

```bash
gpg --quick-generate-key "QA Scribe APT <apt@qa-scribe.local>" ed25519 sign 0
gpg --armor --export-secret-keys YOUR_FINGERPRINT | openssl base64 -A -out deb-signing-private-key.asc.base64
gpg --armor --export YOUR_FINGERPRINT | openssl base64 -A -out deb-signing-public-key.asc.base64

gh secret set DEB_SIGNING_PRIVATE_KEY < deb-signing-private-key.asc.base64
gh secret set DEB_SIGNING_KEY_FINGERPRINT --body "YOUR_FINGERPRINT"
gh secret set DEB_SIGNING_KEY_PASSPHRASE
gh variable set DEB_SIGNING_PUBLIC_KEY < deb-signing-public-key.asc.base64
```

The names are historical. The key signs APT metadata and the APT setup package checksum.

The APT repository is generated under `dist/rust/apt-pages/apt` and deployed with GitHub Pages. Repository Pages must be configured to use GitHub Actions as the Pages source.

The release workflow exports the archive keyring, repository setup package, setup checksum sidecar, setup checksum signature, and `install-apt-repo.sh` to GitHub Pages because Linux installs use public Pages URLs for the bootstrap flow. The installer script itself is not published with a detached signature; it authenticates the setup package through the pinned key and signed checksum.

## Release Behavior

Pushing a `v*` tag triggers `.github/workflows/release.yml`.

The release workflow:

- validates tag, package version, changelog, Rust workspace, and Linux metainfo metadata
- audits frontend dependencies with `bun run frontend:audit`
- creates or refreshes a draft GitHub Release
- builds and verifies signed/notarized macOS arm64 and x64 artifacts
- builds the frontend once for Tauri packaging
- validates the prebuilt frontend contains `index.html` and non-empty CSS assets before Tauri consumes it
- builds Linux output as `.deb`, `.rpm`, and AppImage through Tauri
- validates Linux package metadata and builds a signed APT repository
- installs and launches the final deb and executes the AppImage on the
  disposable Ubuntu runner
- mounts the final artifacts read-only in a digest-pinned Fedora 43 container,
  installs the RPM through dependency-resolving `dnf` before adding the Xvfb
  launch harness, and launches it there
- installs the actual generated APT setup deb, checks its installed keyring and
  source content/permissions/ownership, and purges it
- mounts each final DMG, copies the app bundle out, and launches the copied app
  after signing/notarization and before upload
- stages `install-apt-repo.sh` with the pinned APT signing key fingerprint and validates the rendered installer keeps that effective fingerprint
- publishes public APT bootstrap assets in the APT Pages artifact for installer-side signature verification
- uploads macOS and Linux release assets
- deploys the APT repository to GitHub Pages
- publishes the GitHub Release only after all platform and APT jobs succeed

## Local Validation

Before pushing a release tag, run on the host platform:

```bash
bun install --cwd frontend --frozen-lockfile
bun run verify
node scripts/check-release-metadata.mjs --expected-tag v1.0.0
```

`bun run verify` is the broad local gate: frontend audit, Rust dependency audit,
typecheck, lint, CSS color and contrast checks, tests, bindings check, release
metadata and Linux package metadata unit tests, frontend build, prebuilt frontend
contract check, Rust fmt/clippy/tests/build, and the smoke harness. Use the explicit release
metadata check with the expected tag before tagging so the changelog/package
versions match the release being prepared.

### Optional Authenticated-Provider Smoke

Real Claude Code, Codex CLI, or GitHub Copilot CLI checks are manual and optional. They are never part of the required E2E or release gate because they depend on a local account, network service, model response, and usage allowance. When a release changes provider detection or generation execution, test each provider affected by that release on a developer machine after `bun run verify`:

1. Use an already-authenticated provider CLI; do not copy credentials into qa-scribe.
2. Launch the candidate app, refresh provider status in Settings, and confirm the provider reports ready.
3. Create a disposable Session with non-sensitive text and explicitly generate one Testware Draft or Finding; verify streaming completes and the generated record persists after switching Sessions.
4. Start a second disposable generation and cancel it; verify the UI leaves no running job.
5. Delete the disposable Session and record the app version, provider CLI version, platform, and result in the release notes or release checklist.

A real-provider failure is investigated separately from deterministic E2E. Do not add retries or credentials to the required gate to make this optional smoke pass.

On macOS, validate app packaging:

```bash
cd src-tauri
QA_SCRIBE_USE_PREBUILT_FRONTEND=1 cargo tauri build --bundles app
```

On Linux, also validate package-manager artifacts. The package metadata validator extracts each `.deb`/`.rpm`, reads the installed desktop file, and fails when `Icon=` does not resolve to an installed `/usr/share/icons/hicolor/*/apps/` or `/usr/share/pixmaps/` icon.

```bash
node scripts/package-tauri-linux.mjs
python3 scripts/validate_linux_package_metadata.py "dist/rust/artifacts/*.deb" "dist/rust/artifacts/*.rpm"
node scripts/check-apt-repository.mjs
node scripts/check-apt-installer.mjs
node scripts/smoke-release-artifacts.mjs --linux-deb-appimage dist/rust/artifacts
docker run --rm \
  --volume "${PWD}:/workspace:ro" \
  --volume "$(command -v bun):/usr/local/bin/bun:ro" \
  --workdir /workspace \
  fedora:43@sha256:781b7642e8bf256e9cf75d2aa58d86f5cc695fd2df113517614e181a5eee9138 \
  bun scripts/smoke-release-artifacts.mjs --linux-rpm dist/rust/artifacts
```

The Ubuntu smoke installs and purges the deb with `sudo`; use it only on a
disposable Linux machine where `qa-scribe` is not already installed. The RPM
smoke installs inside its disposable Fedora container. The APT setup mode is run by the release workflow after the signed
repository builder creates the real setup package and exported keyring.

After producing a signed/notarized DMG on a disposable macOS host, run:

```bash
node scripts/smoke-release-artifacts.mjs --macos-dmg dist/rust/artifacts
```
