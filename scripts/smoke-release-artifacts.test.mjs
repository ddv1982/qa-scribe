import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  expectedAptSources,
  selectLinuxDesktopArtifacts,
  selectSingle,
  smokeAptSetupPackage,
  smokeLinuxDebAndAppImageArtifacts,
  smokeLinuxRpmArtifact,
  smokeMacosDmg,
  verifyAptSetupInstallation
} from './smoke-release-artifacts.mjs'

test('selectLinuxDesktopArtifacts requires exactly one final desktop artifact of each format', () => {
  assert.deepEqual(
    selectLinuxDesktopArtifacts([
      'qa-scribe_1.2.3_amd64.deb',
      'qa-scribe-repository-setup_1.0_all.deb',
      'qa-scribe-1.2.3-1.x86_64.rpm',
      'QA.Scribe_1.2.3_amd64.AppImage',
      'SHA256SUMS'
    ]),
    {
      deb: 'qa-scribe_1.2.3_amd64.deb',
      rpm: 'qa-scribe-1.2.3-1.x86_64.rpm',
      appImage: 'QA.Scribe_1.2.3_amd64.AppImage'
    }
  )
})

test('artifact selection rejects missing or duplicate final packages', () => {
  assert.throws(
    () => selectLinuxDesktopArtifacts(['qa-scribe_1.2.3_amd64.deb', 'QA.Scribe_1.2.3_amd64.AppImage']),
    /exactly one desktop rpm artifact, found 0/
  )
  assert.throws(
    () => selectSingle(['one.dmg', 'two.dmg'], name => name.endsWith('.dmg'), 'DMG'),
    /exactly one DMG artifact, found 2/
  )
})

test('expectedAptSources renders the strict installed Deb822 contract', () => {
  assert.equal(
    expectedAptSources({
      repositoryUrl: 'https://example.test/qa-scribe/apt/',
      architectures: ['amd64']
    }),
    [
      'Types: deb',
      'URIs: https://example.test/qa-scribe/apt/',
      'Suites: stable',
      'Components: main',
      'Architectures: amd64',
      'Signed-By: /usr/share/keyrings/qa-scribe-archive-keyring.pgp',
      ''
    ].join('\n')
  )
})

async function aptSetupFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-apt-setup-'))
  const keyringPath = join(directory, 'installed-keyring.pgp')
  const expectedKeyringPath = join(directory, 'release-keyring.pgp')
  const sourcesPath = join(directory, 'qa-scribe.sources')
  const keyring = Buffer.from([0x99, 0x01, 0x02, 0x03, 0x04])
  const repositoryUrl = 'https://example.test/qa-scribe/apt/'
  const sources = expectedAptSources({ repositoryUrl, architectures: ['amd64'] })
  await writeFile(keyringPath, keyring)
  await writeFile(expectedKeyringPath, keyring)
  await writeFile(sourcesPath, sources, 'utf8')
  await Promise.all([chmod(keyringPath, 0o644), chmod(expectedKeyringPath, 0o644), chmod(sourcesPath, 0o644)])
  return { directory, keyringPath, expectedKeyringPath, sourcesPath, repositoryUrl }
}

test('verifyAptSetupInstallation checks installed modes and exact keyring/source content', async () => {
  const fixture = await aptSetupFixture()
  try {
    await verifyAptSetupInstallation({
      keyringPath: fixture.keyringPath,
      sourcesPath: fixture.sourcesPath,
      expectedKeyringPath: fixture.expectedKeyringPath,
      expectedRepositoryUrl: fixture.repositoryUrl,
      architectures: ['amd64'],
      requireRootOwnership: false
    })
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('verifyAptSetupInstallation rejects permissive modes and changed source content', async (t) => {
  await t.test('mode', async () => {
    const fixture = await aptSetupFixture()
    try {
      await chmod(fixture.sourcesPath, 0o666)
      await assert.rejects(
        verifyAptSetupInstallation({
          keyringPath: fixture.keyringPath,
          sourcesPath: fixture.sourcesPath,
          expectedKeyringPath: fixture.expectedKeyringPath,
          expectedRepositoryUrl: fixture.repositoryUrl,
          architectures: ['amd64'],
          requireRootOwnership: false
        }),
        /mode is 666, expected 644/
      )
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  await t.test('content', async () => {
    const fixture = await aptSetupFixture()
    try {
      await writeFile(fixture.sourcesPath, (await readFile(fixture.sourcesPath, 'utf8')).replace('Suites: stable', 'Suites: testing'))
      await assert.rejects(
        verifyAptSetupInstallation({
          keyringPath: fixture.keyringPath,
          sourcesPath: fixture.sourcesPath,
          expectedKeyringPath: fixture.expectedKeyringPath,
          expectedRepositoryUrl: fixture.repositoryUrl,
          architectures: ['amd64'],
          requireRootOwnership: false
        }),
        /sources content differs/
      )
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })
})

test('Ubuntu smoke installs and removes the deb before executing AppImage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-linux-smoke-plan-'))
  const deb = join(directory, 'qa-scribe_1.2.3_amd64.deb')
  const rpm = join(directory, 'qa-scribe-1.2.3-1.x86_64.rpm')
  const appImage = join(directory, 'QA.Scribe_1.2.3_amd64.AppImage')
  const commands = []
  const launches = []
  const absenceChecks = []
  try {
    await Promise.all([writeFile(deb, ''), writeFile(rpm, ''), writeFile(appImage, '')])
    await chmod(appImage, 0o755)

    await smokeLinuxDebAndAppImageArtifacts({
      artifactDirectory: directory,
      platform: 'linux',
      launchMilliseconds: 1234,
      commandRunner: async (command, args) => commands.push([command, args]),
      launcher: async (command, args, options) => launches.push([command, args, options]),
      pathAbsenceChecker: async paths => absenceChecks.push(paths)
    })

    assert.deepEqual(commands, [
      ['sudo', ['apt-get', 'install', '-y', '--no-install-recommends', deb]],
      ['sudo', ['dpkg', '--purge', 'qa-scribe']]
    ])
    assert.equal(launches.length, 2)
    assert.deepEqual(launches.map(([command]) => command), ['xvfb-run', 'xvfb-run'])
    assert.equal(launches[0][1].at(-1), '/usr/bin/qa-scribe')
    assert.equal(launches[1][1].at(-1), appImage)
    assert.equal(launches[1][2].env.APPIMAGE_EXTRACT_AND_RUN, '1')
    assert.ok(launches.every(([, , options]) => options.milliseconds === 1234))
    assert.equal(absenceChecks.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Fedora RPM smoke uses dnf dependency resolution and never --nodeps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-rpm-smoke-plan-'))
  const rpm = join(directory, 'qa-scribe-1.2.3-1.x86_64.rpm')
  const commands = []
  const launches = []
  const absenceChecks = []
  try {
    await writeFile(rpm, '')
    await smokeLinuxRpmArtifact({
      artifactDirectory: directory,
      platform: 'linux',
      launchMilliseconds: 2345,
      commandRunner: async (command, args) => commands.push([command, args]),
      launcher: async (command, args, options) => launches.push([command, args, options]),
      pathAbsenceChecker: async paths => absenceChecks.push(paths)
    })

    assert.deepEqual(commands, [
      ['dnf', ['install', '-y', '--setopt=install_weak_deps=False', rpm]],
      ['dnf', ['install', '-y', 'xorg-x11-server-Xvfb', 'xorg-x11-xauth']],
      ['dnf', ['remove', '-y', 'qa-scribe']]
    ])
    assert.ok(commands.every(([, args]) => !args.includes('--nodeps')))
    assert.equal(launches.length, 1)
    assert.equal(launches[0][0], 'xvfb-run')
    assert.equal(launches[0][1].at(-1), '/usr/bin/qa-scribe')
    assert.equal(launches[0][2].milliseconds, 2345)
    assert.equal(absenceChecks.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('APT setup smoke installs the actual deb, verifies installed paths, then purges it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-apt-smoke-plan-'))
  const setupDeb = join(directory, 'qa-scribe-repository-setup_1.0_all.deb')
  const keyring = join(directory, 'qa-scribe-archive-keyring.pgp')
  const commands = []
  const absenceChecks = []
  let verification
  try {
    await Promise.all([writeFile(setupDeb, 'deb'), writeFile(keyring, 'keyring')])
    await smokeAptSetupPackage({
      setupDebPath: setupDeb,
      expectedKeyringPath: keyring,
      platform: 'linux',
      commandRunner: async (command, args) => commands.push([command, args]),
      pathAbsenceChecker: async paths => absenceChecks.push(paths),
      verification: async options => { verification = options }
    })

    assert.deepEqual(commands, [
      ['sudo', ['apt-get', 'install', '-y', '--no-install-recommends', setupDeb]],
      ['sudo', ['dpkg', '--purge', 'qa-scribe-repository-setup']]
    ])
    assert.equal(verification.expectedKeyringPath, keyring)
    assert.equal(verification.keyringPath, '/usr/share/keyrings/qa-scribe-archive-keyring.pgp')
    assert.equal(verification.sourcesPath, '/etc/apt/sources.list.d/qa-scribe.sources')
    assert.equal(verification.requireRootOwnership, true)
    assert.deepEqual(verification.architectures, ['amd64'])
    assert.equal(absenceChecks.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('APT setup smoke still purges the installed package when verification fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-apt-smoke-failure-'))
  const setupDeb = join(directory, 'qa-scribe-repository-setup_1.0_all.deb')
  const keyring = join(directory, 'qa-scribe-archive-keyring.pgp')
  const commands = []
  try {
    await Promise.all([writeFile(setupDeb, 'deb'), writeFile(keyring, 'keyring')])
    await assert.rejects(
      smokeAptSetupPackage({
        setupDebPath: setupDeb,
        expectedKeyringPath: keyring,
        platform: 'linux',
        commandRunner: async (command, args) => commands.push([command, args]),
        pathAbsenceChecker: async () => {},
        verification: async () => { throw new Error('injected installed-file mismatch') }
      }),
      /injected installed-file mismatch/
    )
    assert.deepEqual(commands.map(([, args]) => args.slice(0, 2)), [
      ['apt-get', 'install'],
      ['dpkg', '--purge']
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('macOS smoke mounts the DMG, copies its app, launches the copied executable, and detaches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-macos-smoke-plan-'))
  const dmg = join(directory, 'QA.Scribe_1.2.3_aarch64.dmg')
  const commands = []
  const launches = []
  try {
    await writeFile(dmg, 'dmg')
    await smokeMacosDmg({
      artifactDirectory: directory,
      platform: 'darwin',
      launchMilliseconds: 2345,
      commandRunner: async (command, args) => {
        commands.push([command, args])
        if (command === 'hdiutil' && args[0] === 'attach') {
          const mountPath = args.at(-1)
          const executable = join(mountPath, 'QA Scribe.app', 'Contents', 'MacOS', 'qa-scribe')
          await mkdir(join(executable, '..'), { recursive: true })
          await writeFile(executable, '#!/bin/sh\n')
          await chmod(executable, 0o755)
        }
        if (command === 'ditto') {
          const executable = join(args[1], 'Contents', 'MacOS', 'qa-scribe')
          await mkdir(join(executable, '..'), { recursive: true })
          await writeFile(executable, '#!/bin/sh\n')
          await chmod(executable, 0o755)
        }
      },
      launcher: async (command, args, options) => launches.push([command, args, options])
    })

    assert.deepEqual(commands.map(([command]) => command), ['hdiutil', 'ditto', 'hdiutil'])
    assert.equal(commands[0][1][0], 'attach')
    assert.equal(commands[0][1][1], dmg)
    assert.equal(commands[0][1][2], '-readonly')
    assert.equal(commands[2][1][0], 'detach')
    assert.match(commands[1][1][0], /mounted\/QA Scribe\.app$/)
    assert.match(commands[1][1][1], /copied\/QA Scribe\.app$/)
    assert.equal(launches.length, 1)
    assert.match(launches[0][0], /copied\/QA Scribe\.app\/Contents\/MacOS\/qa-scribe$/)
    assert.deepEqual(launches[0][1], [])
    assert.equal(launches[0][2].milliseconds, 2345)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('macOS smoke removes its temporary root when launch and detach both fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-scribe-macos-smoke-cleanup-'))
  const dmg = join(directory, 'QA.Scribe_1.2.3_aarch64.dmg')
  let temporaryRoot
  try {
    await writeFile(dmg, 'dmg')
    await assert.rejects(
      smokeMacosDmg({
        artifactDirectory: directory,
        platform: 'darwin',
        commandRunner: async (command, args) => {
          if (command === 'hdiutil' && args[0] === 'attach') {
            const mountPath = args.at(-1)
            temporaryRoot = join(mountPath, '..')
            const executable = join(mountPath, 'QA Scribe.app', 'Contents', 'MacOS', 'qa-scribe')
            await mkdir(join(executable, '..'), { recursive: true })
            await writeFile(executable, '#!/bin/sh\n')
            await chmod(executable, 0o755)
          }
          if (command === 'ditto') {
            const executable = join(args[1], 'Contents', 'MacOS', 'qa-scribe')
            await mkdir(join(executable, '..'), { recursive: true })
            await writeFile(executable, '#!/bin/sh\n')
            await chmod(executable, 0o755)
          }
          if (command === 'hdiutil' && args[0] === 'detach') {
            throw new Error('injected detach failure')
          }
        },
        launcher: async () => { throw new Error('injected launch failure') }
      }),
      error => {
        assert.ok(error instanceof AggregateError)
        assert.match(error.message, /injected launch failure/)
        assert.match(error.message, /injected detach failure/)
        return true
      }
    )
    await assert.rejects(access(temporaryRoot), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CI and release workflows separate Ubuntu smoke from pinned Fedora RPM smoke', async () => {
  const [ci, release] = await Promise.all([
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('.github/workflows/release.yml', 'utf8')
  ])

  for (const workflow of [ci, release]) {
    assert.match(workflow, /RPM_SMOKE_IMAGE: fedora:43@sha256:[a-f0-9]{64}/)
    assert.match(workflow, /node scripts\/smoke-release-artifacts\.mjs --linux-deb-appimage dist\/rust\/artifacts/)
    assert.match(workflow, /docker run --rm/)
    assert.match(workflow, /--volume "\$\{PWD\}:\/workspace:ro"/)
    assert.match(workflow, /--volume "\$\(command -v bun\):\/usr\/local\/bin\/bun:ro"/)
    assert.match(workflow, /bun scripts\/smoke-release-artifacts\.mjs --linux-rpm dist\/rust\/artifacts/)
    assert.doesNotMatch(workflow, /dnf install -y (?:nodejs|xorg-x11)/)
    assert.doesNotMatch(workflow, /--linux-desktop/)
  }
  assert.match(
    release,
    /node scripts\/smoke-release-artifacts\.mjs --apt-setup dist\/rust\/artifacts\/qa-scribe-repository-setup_1\.0_all\.deb --expected-keyring dist\/rust\/artifacts\/qa-scribe-archive-keyring\.pgp/
  )
  assert.match(release, /node scripts\/smoke-release-artifacts\.mjs --macos-dmg dist\/rust\/artifacts/)

  const macSmoke = release.indexOf('node scripts/smoke-release-artifacts.mjs --macos-dmg')
  assert.ok(macSmoke > release.indexOf('Sign and notarize macOS app bundle'))
  assert.ok(macSmoke > release.indexOf('Build, sign, and notarize macOS DMG'))
  assert.ok(macSmoke > release.indexOf('Clean up Apple signing environment'))
  assert.ok(macSmoke < release.indexOf('Stage macOS release assets'))

  const aptSmoke = release.indexOf('node scripts/smoke-release-artifacts.mjs --apt-setup')
  assert.ok(aptSmoke > release.indexOf('Build signed APT repository and checksums'))
  assert.ok(aptSmoke < release.indexOf('Stage Linux release assets'))

  const captureKeychains = release.indexOf('qa-scribe-previous-keychains.txt')
  const replaceKeychains = release.indexOf('security list-keychains -d user -s "$keychain_path"')
  const restoreKeychains = release.indexOf('security list-keychains -d user -s "${previous_keychains[@]}"')
  const deleteKeychain = release.indexOf('security delete-keychain "${keychain_path}"')
  assert.ok(captureKeychains > 0)
  assert.ok(replaceKeychains > captureKeychains)
  assert.ok(restoreKeychains > replaceKeychains)
  assert.ok(deleteKeychain > restoreKeychains)
  assert.doesNotMatch(release, /security default-keychain -d user -s "\$keychain_path"/)
})
