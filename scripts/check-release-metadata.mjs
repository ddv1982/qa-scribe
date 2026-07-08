import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  findChangelogRelease,
  latestMetainfoRelease,
  QA_SCRIBE_CARGO_LOCK_PACKAGES,
  cargoLockPackageVersions,
  readOption as readOptionFrom,
  readReleaseConstants,
  readWorkspaceCargoVersion,
  validateSemver
} from './command-utils.mjs';

const args = process.argv.slice(2);
const execFileAsync = promisify(execFile);
const releaseConstants = readReleaseConstants();

function readOption(name) {
  return readOptionFrom(args, name);
}

async function readTrackedFiles() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { maxBuffer: 1024 * 1024 * 10 });
  return stdout.split(/\r?\n/).filter(Boolean);
}

const expectedTag = readOption('--expected-tag');
const releaseNotesPath = readOption('--write-notes');
const packageJson = JSON.parse(await readFile('package.json', 'utf-8'));
const frontendPackageJson = JSON.parse(await readFile('frontend/package.json', 'utf-8'));
const frontendBunLock = await readFile('frontend/bun.lock', 'utf-8');
const tauriConfig = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf-8'));
const linuxTauriConfig = JSON.parse(await readFile('src-tauri/tauri.linux.conf.json', 'utf-8'));
const cargoToml = await readFile('Cargo.toml', 'utf-8');
const cargoLock = await readFile('Cargo.lock', 'utf-8');
const cargoVersion = readWorkspaceCargoVersion(cargoToml);

if (!validateSemver(packageJson.version)) {
  throw new Error(`package.json version must be semver-compatible, got ${packageJson.version}`);
}

if (!cargoVersion) {
  throw new Error('Cargo.toml must declare [workspace.package] version');
}

if (cargoVersion !== packageJson.version) {
  throw new Error(`Cargo.toml workspace package version ${cargoVersion} does not match package.json version ${packageJson.version}`);
}

const cargoLockVersions = cargoLockPackageVersions(cargoLock);
for (const packageName of QA_SCRIBE_CARGO_LOCK_PACKAGES) {
  const cargoLockVersion = cargoLockVersions[packageName];
  if (!cargoLockVersion) {
    throw new Error(`Cargo.lock is missing a package entry for ${packageName}`);
  }
  if (cargoLockVersion !== packageJson.version) {
    throw new Error(`Cargo.lock package ${packageName} version ${cargoLockVersion} does not match package.json version ${packageJson.version}`);
  }
}

if (frontendPackageJson.version !== packageJson.version) {
  throw new Error(`frontend/package.json version ${frontendPackageJson.version} does not match package.json version ${packageJson.version}`);
}

if (!frontendBunLock.includes('"name": "qa-scribe-frontend"')) {
  throw new Error('frontend/bun.lock must describe the qa-scribe-frontend workspace');
}

if (tauriConfig.version !== packageJson.version) {
  throw new Error(`src-tauri/tauri.conf.json version ${tauriConfig.version} does not match package.json version ${packageJson.version}`);
}

if (tauriConfig.identifier !== releaseConstants.bundleId) {
  throw new Error(`src-tauri/tauri.conf.json identifier must stay ${releaseConstants.bundleId}, got ${tauriConfig.identifier}`);
}

if (tauriConfig.productName !== 'QA Scribe') {
  throw new Error(`src-tauri/tauri.conf.json productName must stay QA Scribe, got ${tauriConfig.productName}`);
}

if (tauriConfig.mainBinaryName !== 'qa-scribe') {
  throw new Error(`src-tauri/tauri.conf.json mainBinaryName must stay qa-scribe, got ${tauriConfig.mainBinaryName}`);
}

const requiredLinuxIcons = [16, 32, 48, 64, 128, 256, 512, 1024].map(size => `../build/icons/${size}x${size}.png`);
for (const icon of requiredLinuxIcons) {
  if (!tauriConfig.bundle?.icon?.includes(icon)) {
    throw new Error(`src-tauri/tauri.conf.json bundle.icon must include ${icon}`);
  }
  await readFile(icon.replace(/^\.\.\//, '')).catch(() => {
    throw new Error(`required Linux icon file is missing or unreadable: ${icon}`);
  });
}

const forbiddenTrackedFiles = (await readTrackedFiles()).filter(file =>
  file.endsWith('.gguf') ||
  file.includes('/model-cache/') ||
  file.includes('/ollama-cache/') ||
  basename(file).startsWith('llama-server')
);
if (forbiddenTrackedFiles.length > 0) {
  throw new Error(`release must not track Local AI model/runtime artifacts: ${forbiddenTrackedFiles.join(', ')}`);
}

if (packageJson.desktopName !== 'qa-scribe.desktop') {
  throw new Error(`package.json desktopName must stay qa-scribe.desktop, got ${packageJson.desktopName}`);
}

if (linuxTauriConfig.productName !== packageJson.name) {
  throw new Error(`src-tauri/tauri.linux.conf.json productName ${linuxTauriConfig.productName} must match package.json name ${packageJson.name}`);
}

const linuxDesktopTemplate = '../build/linux/qa-scribe.desktop.hbs';
if (linuxTauriConfig.bundle?.linux?.deb?.desktopTemplate !== linuxDesktopTemplate) {
  throw new Error(`src-tauri/tauri.linux.conf.json deb desktopTemplate must be ${linuxDesktopTemplate}`);
}

if (linuxTauriConfig.bundle?.linux?.rpm?.desktopTemplate !== linuxDesktopTemplate) {
  throw new Error(`src-tauri/tauri.linux.conf.json rpm desktopTemplate must be ${linuxDesktopTemplate}`);
}

const tag = expectedTag ?? `v${packageJson.version}`;

if (!tag.startsWith('v')) {
  throw new Error(`release tag must start with "v", got ${tag}`);
}

if (tag !== `v${packageJson.version}`) {
  throw new Error(`release tag ${tag} does not match package.json version ${packageJson.version}`);
}

const changelog = await readFile('CHANGELOG.md', 'utf-8');
const release = findChangelogRelease(changelog, tag);

if (!release?.notes) {
  throw new Error(`CHANGELOG.md must contain a non-empty section headed "## ${tag} - YYYY-MM-DD"`);
}

const metainfoPath = `build/linux/${releaseConstants.bundleId}.metainfo.xml`;
const metainfo = await readFile(metainfoPath, 'utf-8');
const metainfoRelease = latestMetainfoRelease(metainfo);

if (!metainfoRelease) {
  throw new Error(`${metainfoPath} must contain a <release version="..." date="..."> entry`);
}

if (metainfoRelease.version !== packageJson.version) {
  throw new Error(`${metainfoPath} latest release version ${metainfoRelease.version} does not match package.json version ${packageJson.version}`);
}

if (metainfoRelease.date !== release.date) {
  throw new Error(`${metainfoPath} release date ${metainfoRelease.date} does not match CHANGELOG.md date ${release.date}`);
}

if (!metainfo.includes('<project_license>MIT</project_license>')) {
  throw new Error(`${metainfoPath} must declare <project_license>MIT</project_license>`);
}

if (!metainfo.includes(`<launchable type="desktop-id">${packageJson.desktopName}</launchable>`)) {
  throw new Error(`${metainfoPath} must launch ${packageJson.desktopName}`);
}

const desktopTemplate = await readFile('build/linux/qa-scribe.desktop.hbs', 'utf-8');
if (!desktopTemplate.includes('Name=QA Scribe')) {
  throw new Error('build/linux/qa-scribe.desktop.hbs must preserve the visible Name=QA Scribe label');
}

if (!desktopTemplate.includes('Exec={{exec}}') || !desktopTemplate.includes('Icon={{icon}}')) {
  throw new Error('build/linux/qa-scribe.desktop.hbs must keep Tauri Exec and Icon template variables');
}

if (releaseNotesPath) {
  await writeFile(releaseNotesPath, `${release.notes}\n`, 'utf-8');
}

console.log(`Release metadata ok for ${tag} (${basename(process.cwd())})`);
