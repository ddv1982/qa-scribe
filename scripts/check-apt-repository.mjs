#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readReleaseConstants } from './command-utils.mjs'

const releaseConstants = readReleaseConstants()
const workDir = mkdtempSync(join(tmpdir(), 'qaapt-'))
const gnupgHome = mkdtempSync(join(tmpdir(), 'qaag-'))
const verificationHome = mkdtempSync(join(tmpdir(), 'qaav-'))
const outputDir = join(workDir, 'repository')
const keyParametersPath = join(workDir, 'key-parameters')
const publicKeyPath = join(workDir, 'qa-scribe-archive-keyring.pgp')
const setupPackagePath = join(workDir, releaseConstants.setupPackageFilename)

try {
  chmodSync(gnupgHome, 0o700)
  chmodSync(verificationHome, 0o700)
  writeFileSync(join(gnupgHome, 'gpg-agent.conf'), 'allow-loopback-pinentry\n', 'utf8')
  writeFileSync(
    keyParametersPath,
    `%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Name-Real: QA Scribe APT Check
Name-Email: apt-check@qa-scribe.local
Expire-Date: 0
%commit
`,
    'utf8'
  )

  run('gpgconf', ['--launch', 'gpg-agent'], { GNUPGHOME: gnupgHome })
  run('gpg-connect-agent', ['/bye'], { GNUPGHOME: gnupgHome })
  run('gpg', ['--quiet', '--batch', '--homedir', gnupgHome, '--pinentry-mode', 'loopback', '--generate-key', keyParametersPath], {
    GNUPGHOME: gnupgHome
  })
  const fingerprint = readFirstFingerprint(
    runWithOutput('gpg', ['--batch', '--homedir', gnupgHome, '--with-colons', '--list-secret-keys'], { GNUPGHOME: gnupgHome })
  )

  run('python3', [
    'scripts/build_apt_repository.py',
    'dist/rust/artifacts/*.deb',
    '--output',
    outputDir,
    '--gpg-key',
    fingerprint,
    '--gpg-homedir',
    gnupgHome,
    '--public-key-out',
    publicKeyPath,
    '--setup-package-out',
    setupPackagePath,
    '--clean'
  ])

  run('gpgconf', ['--launch', 'gpg-agent'], { GNUPGHOME: verificationHome })
  run('gpg-connect-agent', ['/bye'], { GNUPGHOME: verificationHome })
  run('gpg', ['--quiet', '--batch', '--homedir', verificationHome, '--import', publicKeyPath], { GNUPGHOME: verificationHome })
  run('gpg', [
    '--quiet',
    '--batch',
    '--homedir',
    verificationHome,
    '--trust-model',
    'always',
    '--verify',
    join(outputDir, 'dists', 'stable', 'Release.gpg'),
    join(outputDir, 'dists', 'stable', 'Release')
  ], { GNUPGHOME: verificationHome })
  run(
    'gpg',
    ['--quiet', '--batch', '--homedir', verificationHome, '--trust-model', 'always', '--verify', join(outputDir, 'dists', 'stable', 'InRelease')],
    { GNUPGHOME: verificationHome }
  )
  console.log('Signed APT repository check passed.')
} finally {
  spawnSync('gpgconf', ['--kill', 'gpg-agent'], { stdio: 'ignore', env: { ...process.env, GNUPGHOME: gnupgHome } })
  spawnSync('gpgconf', ['--kill', 'gpg-agent'], { stdio: 'ignore', env: { ...process.env, GNUPGHOME: verificationHome } })
  rmSync(workDir, { recursive: true, force: true })
  rmSync(gnupgHome, { recursive: true, force: true })
  rmSync(verificationHome, { recursive: true, force: true })
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status === 0) return
  throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}`)
}

function runWithOutput(command, args, env = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env } })
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}`)
  }
  return result.stdout
}

function readFirstFingerprint(output) {
  for (const line of output.split('\n')) {
    const fields = line.split(':')
    if (fields[0] === 'fpr' && fields[9]) return fields[9]
  }

  throw new Error('Could not find generated APT check signing key fingerprint.')
}
