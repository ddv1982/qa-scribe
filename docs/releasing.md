# Release Workflow

Use this workflow when publishing downloadable QA Scribe desktop artifacts.

The app runtime is Tauri with a bundled Vite frontend. Bun is used for the
frontend install/build/test path; Node is used for repository release scripts.

## Version And Tag

The stable release workflow accepts only stable SemVer versions and tags in the
`X.Y.Z` / `vX.Y.Z` shape. Prerelease or build-metadata versions such as
`1.0.0-beta.1` and `1.0.0+build.1` are rejected instead of being published as
stable/latest artifacts.

Bump the version with the single write-path script instead of hand-editing
files. It updates `package.json`, `frontend/package.json`, `Cargo.toml`
(`[workspace.package]`), `Cargo.lock` (the `qa-scribe-app`/`qa-scribe-core`/
`qa-scribe-tauri` entries), `src-tauri/tauri.conf.json`, inserts a
`## v<version> - <date>` scaffold at the top of `CHANGELOG.md`, and inserts a
new `<release>` entry in
`build/linux/io.github.ddv1982.qa-scribe.metainfo.xml`:

```bash
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

`frontend/bun.lock` does not need updating: it only records third-party
dependency versions, not the frontend workspace's own `version` field.
`Cargo.lock` does need to stay in sync with the app version because the Rust
workspace packages are released from that lockfile; both `bun run bump` and the
release metadata check enforce this.

The metadata check also gates the Linux Tauri package identity: `src-tauri/tauri.linux.conf.json` keeps the installed desktop file at `qa-scribe.desktop`, while `build/linux/qa-scribe.desktop.hbs` keeps the visible app name as QA Scribe. `src-tauri/tauri.conf.json` must list every generated Linux PNG icon size from `build/icons/16x16.png` through `build/icons/1024x1024.png` so `.deb`/`.rpm` installers provide a desktop-resolvable hicolor icon.

The release metadata check also rejects tracked Local AI model/runtime artifacts such as `.gguf` files, model caches, Ollama caches, and `llama-server` binaries. Local AI model download remains an in-app/Ollama setup step, not a bundled release asset.

Then commit, tag, and push:

```bash
git add -A
git commit -m "lore(release): v1.0.0"
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

## Artifact Model

The release workflow builds Tauri desktop artifacts:

- macOS: signed and notarized `.dmg` installers named with standard architecture suffixes, for example `QA.Scribe_1.0.0_aarch64.dmg` and `QA.Scribe_1.0.0_x64.dmg`
- Linux: `.deb`, `.rpm`, AppImage, APT repository, APT repository setup `.deb`, setup checksum sidecar, setup checksum signature, and `install-apt-repo.sh`

Artifacts are written to `dist/rust/artifacts/`. The GitHub Release intentionally publishes only user-facing installers and APT bootstrap files; the archive keyring stays on GitHub Pages because it is consumed by `install-apt-repo.sh`.

CI and release jobs install the Tauri CLI with the pinned workflow `TAURI_CLI_VERSION`, which should match the Tauri crate version resolved in `Cargo.lock`.

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

`bun run verify` is the broad local gate: frontend audit, typecheck, lint,
CSS color and contrast checks, tests, bindings check, release metadata and Linux
package metadata unit tests, frontend build, prebuilt frontend contract check,
Rust fmt/clippy/tests/build, and the smoke harness. Use the explicit release
metadata check with the expected tag before tagging so the changelog/package
versions match the release being prepared.

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
```
