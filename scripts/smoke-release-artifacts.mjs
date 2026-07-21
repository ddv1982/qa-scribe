#!/usr/bin/env node

import { spawn } from 'node:child_process'
import {
  access,
  constants as fsConstants,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOption, readReleaseConstants } from './command-utils.mjs'

const APP_PACKAGE_NAME = 'qa-scribe'
const APP_EXECUTABLE = '/usr/bin/qa-scribe'
const SETUP_PACKAGE_NAME = 'qa-scribe-repository-setup'
const SETUP_KEYRING_PATH = '/usr/share/keyrings/qa-scribe-archive-keyring.pgp'
const SETUP_SOURCES_PATH = '/etc/apt/sources.list.d/qa-scribe.sources'
const DEFAULT_LAUNCH_MILLISECONDS = 5_000

async function main(argv = process.argv.slice(2)) {
  const linuxDebAppImageDirectory = readOption(argv, '--linux-deb-appimage')
  const linuxRpmDirectory = readOption(argv, '--linux-rpm')
  const aptSetupDeb = readOption(argv, '--apt-setup')
  const expectedKeyring = readOption(argv, '--expected-keyring')
  const macosDmgDirectory = readOption(argv, '--macos-dmg')
  const selectedModes = [linuxDebAppImageDirectory, linuxRpmDirectory, aptSetupDeb, macosDmgDirectory].filter(Boolean)

  if (selectedModes.length !== 1) {
    throw new Error(
      'Select exactly one smoke mode: --linux-deb-appimage <artifact-dir>, --linux-rpm <artifact-dir>, --apt-setup <setup.deb> --expected-keyring <keyring>, or --macos-dmg <artifact-dir>'
    )
  }

  if (linuxDebAppImageDirectory) {
    await smokeLinuxDebAndAppImageArtifacts({ artifactDirectory: linuxDebAppImageDirectory })
    return
  }

  if (linuxRpmDirectory) {
    await smokeLinuxRpmArtifact({ artifactDirectory: linuxRpmDirectory })
    return
  }

  if (aptSetupDeb) {
    if (!expectedKeyring) {
      throw new Error('--apt-setup requires --expected-keyring <keyring>')
    }
    await smokeAptSetupPackage({ setupDebPath: aptSetupDeb, expectedKeyringPath: expectedKeyring })
    return
  }

  await smokeMacosDmg({ artifactDirectory: macosDmgDirectory })
}

async function smokeLinuxDebAndAppImageArtifacts({
  artifactDirectory,
  commandRunner = runCommand,
  launcher = assertLaunchStaysRunning,
  launchMilliseconds = DEFAULT_LAUNCH_MILLISECONDS,
  pathAbsenceChecker = assertPathsAbsent,
  platform = process.platform
}) {
  if (platform !== 'linux') {
    throw new Error('Linux desktop package smoke must run on Linux')
  }

  const directory = resolve(artifactDirectory)
  const names = await readdir(directory)
  const artifacts = selectLinuxDebAndAppImageArtifacts(names)
  const paths = Object.fromEntries(Object.entries(artifacts).map(([kind, name]) => [kind, join(directory, name)]))
  await pathAbsenceChecker([APP_EXECUTABLE])
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'qa-scribe-package-smoke-'))
  const environment = await isolatedLaunchEnvironment(temporaryRoot)

  try {
    await withCleanup(
      async () => {
        await commandRunner('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', paths.deb])
        await launcher('xvfb-run', ['-a', '--server-args=-screen 0 1280x800x24', APP_EXECUTABLE], {
          env: environment,
          milliseconds: launchMilliseconds,
          label: 'installed deb application'
        })
      },
      async () => {
        await commandRunner('sudo', ['dpkg', '--purge', APP_PACKAGE_NAME])
        await pathAbsenceChecker([APP_EXECUTABLE])
      }
    )

    await access(paths.appImage, fsConstants.X_OK)
    await launcher('xvfb-run', ['-a', '--server-args=-screen 0 1280x800x24', paths.appImage], {
      env: { ...environment, APPIMAGE_EXTRACT_AND_RUN: '1' },
      milliseconds: launchMilliseconds,
      label: 'AppImage application'
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  console.log(`Release artifact smoke passed for ${basename(paths.deb)} and ${basename(paths.appImage)}.`)
}

async function smokeLinuxRpmArtifact({
  artifactDirectory,
  commandRunner = runCommand,
  launcher = assertLaunchStaysRunning,
  launchMilliseconds = DEFAULT_LAUNCH_MILLISECONDS,
  pathAbsenceChecker = assertPathsAbsent,
  platform = process.platform
}) {
  if (platform !== 'linux') {
    throw new Error('Linux RPM smoke must run on Linux')
  }

  const directory = resolve(artifactDirectory)
  const rpmName = selectLinuxRpmArtifact((await readdir(directory)))
  const rpmPath = join(directory, rpmName)
  await pathAbsenceChecker([APP_EXECUTABLE])
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'qa-scribe-rpm-smoke-'))
  const environment = await isolatedLaunchEnvironment(temporaryRoot)

  try {
    await withCleanup(
      async () => {
        await commandRunner('dnf', ['install', '-y', '--setopt=install_weak_deps=False', rpmPath])
        await commandRunner('dnf', ['install', '-y', 'xorg-x11-server-Xvfb', 'xorg-x11-xauth'])
        await launcher('xvfb-run', ['-a', '--server-args=-screen 0 1280x800x24', APP_EXECUTABLE], {
          env: environment,
          milliseconds: launchMilliseconds,
          label: 'installed rpm application'
        })
      },
      async () => {
        await commandRunner('dnf', ['remove', '-y', APP_PACKAGE_NAME])
        await pathAbsenceChecker([APP_EXECUTABLE])
      }
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  console.log(`RPM artifact smoke passed for ${rpmName}.`)
}

async function smokeAptSetupPackage({
  setupDebPath,
  expectedKeyringPath,
  commandRunner = runCommand,
  verification = verifyAptSetupInstallation,
  pathAbsenceChecker = assertPathsAbsent,
  platform = process.platform
}) {
  if (platform !== 'linux') {
    throw new Error('APT setup package smoke must run on Linux')
  }

  const setupDeb = resolve(setupDebPath)
  const keyring = resolve(expectedKeyringPath)
  await access(setupDeb, fsConstants.R_OK)
  await access(keyring, fsConstants.R_OK)
  await pathAbsenceChecker([SETUP_KEYRING_PATH, SETUP_SOURCES_PATH])

  await withCleanup(
    async () => {
      await commandRunner('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', setupDeb])
      await verification({
        keyringPath: SETUP_KEYRING_PATH,
        sourcesPath: SETUP_SOURCES_PATH,
        expectedKeyringPath: keyring,
        expectedRepositoryUrl: readReleaseConstants().pagesBaseUrl,
        architectures: ['amd64'],
        requireRootOwnership: true
      })
    },
    async () => {
      await commandRunner('sudo', ['dpkg', '--purge', SETUP_PACKAGE_NAME])
      await pathAbsenceChecker([SETUP_KEYRING_PATH, SETUP_SOURCES_PATH])
    }
  )

  console.log(`APT setup package smoke passed for ${basename(setupDeb)}.`)
}

async function smokeMacosDmg({
  artifactDirectory,
  commandRunner = runCommand,
  launcher = assertLaunchStaysRunning,
  launchMilliseconds = DEFAULT_LAUNCH_MILLISECONDS,
  platform = process.platform
}) {
  if (platform !== 'darwin') {
    throw new Error('DMG smoke must run on macOS')
  }

  const directory = resolve(artifactDirectory)
  const names = await readdir(directory)
  const dmgName = selectSingle(names, name => name.endsWith('.dmg'), 'DMG')
  const dmgPath = join(directory, dmgName)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'qa-scribe-dmg-smoke-'))
  const mountPath = join(temporaryRoot, 'mounted')
  const copyPath = join(temporaryRoot, 'copied')
  await mkdir(mountPath)
  await mkdir(copyPath)
  let mounted = false

  await withCleanup(
    async () => {
      await commandRunner('hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountPath])
      mounted = true

      const mountedNames = await readdir(mountPath)
      const appName = selectSingle(mountedNames, name => name.endsWith('.app'), 'application bundle in mounted DMG')
      const mountedApp = join(mountPath, appName)
      const copiedApp = join(copyPath, appName)
      await commandRunner('ditto', [mountedApp, copiedApp])

      const executable = join(copiedApp, 'Contents', 'MacOS', 'qa-scribe')
      await access(executable, fsConstants.X_OK)
      await launcher(executable, [], {
        env: process.env,
        milliseconds: launchMilliseconds,
        label: 'application copied from DMG'
      })
    },
    async () => {
      await withCleanup(
        async () => {
          if (mounted) {
            await commandRunner('hdiutil', ['detach', mountPath])
          }
        },
        async () => rm(temporaryRoot, { recursive: true, force: true })
      )
    }
  )

  console.log(`DMG mount/copy/launch smoke passed for ${dmgName}.`)
}

function selectLinuxDesktopArtifacts(names) {
  return {
    ...selectLinuxDebAndAppImageArtifacts(names),
    rpm: selectLinuxRpmArtifact(names)
  }
}

function selectLinuxDebAndAppImageArtifacts(names) {
  return {
    deb: selectSingle(names, name => /^qa-scribe_[^/]+\.deb$/.test(name), 'desktop deb'),
    appImage: selectSingle(names, name => name.endsWith('.AppImage'), 'AppImage')
  }
}

function selectLinuxRpmArtifact(names) {
  return selectSingle(names, name => /^qa-scribe-[^/]+\.rpm$/.test(name), 'desktop rpm')
}

function selectSingle(names, predicate, label) {
  const matches = names.filter(predicate).sort()
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} artifact, found ${matches.length}: ${matches.join(', ') || '<none>'}`)
  }
  return matches[0]
}

function expectedAptSources({ repositoryUrl, architectures }) {
  return [
    'Types: deb',
    `URIs: ${repositoryUrl}`,
    'Suites: stable',
    'Components: main',
    ...(architectures.length > 0 ? [`Architectures: ${architectures.join(' ')}`] : []),
    `Signed-By: ${SETUP_KEYRING_PATH}`,
    ''
  ].join('\n')
}

async function verifyAptSetupInstallation({
  keyringPath,
  sourcesPath,
  expectedKeyringPath,
  expectedRepositoryUrl,
  architectures,
  requireRootOwnership
}) {
  const [keyringStat, sourcesStat, installedKeyring, expectedKeyring, installedSources] = await Promise.all([
    lstat(keyringPath),
    lstat(sourcesPath),
    readFile(keyringPath),
    readFile(expectedKeyringPath),
    readFile(sourcesPath, 'utf8')
  ])

  for (const [label, fileStat] of [['keyring', keyringStat], ['sources', sourcesStat]]) {
    if (!fileStat.isFile()) {
      throw new Error(`Installed APT ${label} path is not a regular file`)
    }
    const mode = fileStat.mode & 0o777
    if (mode !== 0o644) {
      throw new Error(`Installed APT ${label} mode is ${mode.toString(8)}, expected 644`)
    }
    if (requireRootOwnership && (fileStat.uid !== 0 || fileStat.gid !== 0)) {
      throw new Error(`Installed APT ${label} must be owned by root:root, got ${fileStat.uid}:${fileStat.gid}`)
    }
  }

  if (!installedKeyring.equals(expectedKeyring)) {
    throw new Error('Installed APT keyring content differs from the release keyring artifact')
  }

  const expectedSources = expectedAptSources({ repositoryUrl: expectedRepositoryUrl, architectures })
  if (installedSources !== expectedSources) {
    throw new Error(`Installed APT sources content differs from the expected Deb822 source:\n${installedSources}`)
  }
}

async function isolatedLaunchEnvironment(temporaryRoot) {
  const config = join(temporaryRoot, 'config')
  const data = join(temporaryRoot, 'data')
  const cache = join(temporaryRoot, 'cache')
  await Promise.all([mkdir(config), mkdir(data), mkdir(cache)])
  return {
    ...process.env,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    NO_AT_BRIDGE: '1'
  }
}

async function assertPathsAbsent(paths) {
  for (const path of paths) {
    try {
      await lstat(path)
      throw new Error(`Disposable package smoke requires an absent path before/after install: ${path}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

async function withCleanup(work, cleanup) {
  let workError
  try {
    await work()
  } catch (error) {
    workError = error
  }

  try {
    await cleanup()
  } catch (cleanupError) {
    if (workError) {
      throw new AggregateError([workError, cleanupError], `Package smoke and cleanup both failed: ${workError.message}; ${cleanupError.message}`)
    }
    throw cleanupError
  }

  if (workError) throw workError
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: false
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}`))
      }
    })
  })
}

async function assertLaunchStaysRunning(command, args, { env, milliseconds, label }) {
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    env,
    stdio: 'inherit',
    shell: false
  })
  const exit = new Promise(resolvePromise => {
    child.once('error', error => resolvePromise({ error }))
    child.once('exit', (code, signal) => resolvePromise({ code, signal }))
  })
  const earlyExit = await Promise.race([
    exit,
    new Promise(resolvePromise => setTimeout(() => resolvePromise(null), milliseconds))
  ])

  if (earlyExit) {
    if (earlyExit.error) throw earlyExit.error
    throw new Error(`${label} exited before the ${milliseconds}ms launch smoke completed (code ${earlyExit.code ?? 'null'}, signal ${earlyExit.signal ?? 'none'})`)
  }

  terminateProcessTree(child, 'SIGTERM')
  const terminated = await Promise.race([
    exit.then(() => true),
    new Promise(resolvePromise => setTimeout(() => resolvePromise(false), 5_000))
  ])
  if (!terminated) {
    terminateProcessTree(child, 'SIGKILL')
    await exit
  }
}

function terminateProcessTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal)
    } else {
      child.kill(signal)
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainModule) {
  main().catch(error => {
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  })
}

export {
  expectedAptSources,
  selectLinuxDebAndAppImageArtifacts,
  selectLinuxDesktopArtifacts,
  selectLinuxRpmArtifact,
  selectSingle,
  smokeAptSetupPackage,
  smokeLinuxDebAndAppImageArtifacts,
  smokeLinuxRpmArtifact,
  smokeMacosDmg,
  verifyAptSetupInstallation
}
