import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { normalizeDeb822Sources, normalizeLegacySources } from './normalize-ci-apt-sources.mjs'

const script = fileURLToPath(new URL('./normalize-ci-apt-sources.mjs', import.meta.url))
const hosted = ['--runner-os', 'Linux', '--runner-environment', 'github-hosted']
const cli = (root, context = hosted) => spawnSync(process.execPath, [script, '--root', root, ...context], { encoding: 'utf8' })
const temporaryRoot = t => {
  const root = mkdtempSync(join(tmpdir(), 'qa-ci-apt-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

const cases = [
  {
    name: 'Deb822 multiple and continued URIs preserve fields, comments, and inline key',
    transform: normalizeDeb822Sources,
    input: '# http://azure.archive.ubuntu.com/ubuntu\r\nTypes: deb deb-src\r\nURIs: http://azure.archive.ubuntu.com/ubuntu/ https://packages.microsoft.com/repos/code\r\n # http://azure.archive.ubuntu.com/ubuntu\r\n mirror+file:/etc/apt/apt-mirrors.txt\r\nSuites: noble noble-updates noble-security\r\nComponents: main universe\r\nArchitectures: amd64\r\nSigned-By:\r\n -----BEGIN PGP PUBLIC KEY BLOCK-----\r\n .\r\n http://azure.archive.ubuntu.com/ubuntu\r\n -----END PGP PUBLIC KEY BLOCK-----\r\n',
    expected: '# http://azure.archive.ubuntu.com/ubuntu\r\nTypes: deb deb-src\r\nURIs: https://archive.ubuntu.com/ubuntu https://packages.microsoft.com/repos/code\r\n # http://azure.archive.ubuntu.com/ubuntu\r\n https://archive.ubuntu.com/ubuntu\r\nSuites: noble noble-updates noble-security\r\nComponents: main universe\r\nArchitectures: amd64\r\nSigned-By:\r\n -----BEGIN PGP PUBLIC KEY BLOCK-----\r\n .\r\n http://azure.archive.ubuntu.com/ubuntu\r\n -----END PGP PUBLIC KEY BLOCK-----\r\n',
    count: 2,
  },
  {
    name: 'Deb822 HTTPS Azure and triple-slash mirror selector retain security suite',
    transform: normalizeDeb822Sources,
    input: 'Types: deb\nURIs: https://azure.archive.ubuntu.com/ubuntu mirror+file:///etc/apt/apt-mirrors.txt\nSuites: resolute-security\nComponents: main\nEnabled: yes',
    expected: 'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu https://archive.ubuntu.com/ubuntu\nSuites: resolute-security\nComponents: main\nEnabled: yes',
    count: 2,
  },
  {
    name: 'Deb822 disabled stanzas and unrelated URI values remain byte-identical',
    transform: normalizeDeb822Sources,
    input: 'Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\nEnabled: no\nSuites: noble\n\n# disabled record\n# URIs: http://azure.archive.ubuntu.com/ubuntu\n\nTypes: deb\nURIs: https://archive.ubuntu.com/ubuntu http://security.ubuntu.com/ubuntu http://ports.ubuntu.com/ubuntu-ports mirror+file:/etc/apt/apt-mirrors-security.txt https://ppa.launchpadcontent.net/owner/ppa/ubuntu https://ddv1982.github.io/qa-scribe/apt http://azure.archive.ubuntu.com.evil/ubuntu http://azure.archive.ubuntu.com/ubuntu-extra\nSuites: noble\n',
    expected: 'Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\nEnabled: no\nSuites: noble\n\n# disabled record\n# URIs: http://azure.archive.ubuntu.com/ubuntu\n\nTypes: deb\nURIs: https://archive.ubuntu.com/ubuntu http://security.ubuntu.com/ubuntu http://ports.ubuntu.com/ubuntu-ports mirror+file:/etc/apt/apt-mirrors-security.txt https://ppa.launchpadcontent.net/owner/ppa/ubuntu https://ddv1982.github.io/qa-scribe/apt http://azure.archive.ubuntu.com.evil/ubuntu http://azure.archive.ubuntu.com/ubuntu-extra\nSuites: noble\n',
    count: 0,
  },
  {
    name: 'legacy active URI position preserves options, security suite, and comments',
    transform: normalizeLegacySources,
    input: '  deb [arch=amd64 signed-by=/keys/key.gpg] http://azure.archive.ubuntu.com/ubuntu/ noble-security main # http://azure.archive.ubuntu.com/ubuntu\r\ndeb-src https://azure.archive.ubuntu.com/ubuntu/ noble universe\r\ndeb mirror+file:/etc/apt/apt-mirrors.txt noble main\ndeb mirror+file:///etc/apt/apt-mirrors.txt noble main',
    expected: '  deb [arch=amd64 signed-by=/keys/key.gpg] https://archive.ubuntu.com/ubuntu noble-security main # http://azure.archive.ubuntu.com/ubuntu\r\ndeb-src https://archive.ubuntu.com/ubuntu noble universe\r\ndeb https://archive.ubuntu.com/ubuntu noble main\ndeb https://archive.ubuntu.com/ubuntu noble main',
    count: 4,
  },
  {
    name: 'legacy inactive, unrelated, and deceptive URI records remain unchanged',
    transform: normalizeLegacySources,
    input: '# deb http://azure.archive.ubuntu.com/ubuntu noble main\n\ndeb https://archive.ubuntu.com/ubuntu noble main\ndeb http://security.ubuntu.com/ubuntu noble-security main\ndeb http://ports.ubuntu.com/ubuntu-ports noble main\ndeb mirror+file:/etc/apt/apt-mirrors-security.txt noble main\ndeb https://packages.microsoft.com/repos/code stable main\ndeb https://ppa.launchpadcontent.net/owner/ppa/ubuntu noble main\ndeb https://ddv1982.github.io/qa-scribe/apt stable main\ndeb http://azure.archive.ubuntu.com.evil/ubuntu noble main\ndeb http://azure.archive.ubuntu.com/ubuntu/path noble main\ndeb [signed-by=http://azure.archive.ubuntu.com/ubuntu] https://other.example/ubuntu noble main\nother http://azure.archive.ubuntu.com/ubuntu\n',
    expected: '# deb http://azure.archive.ubuntu.com/ubuntu noble main\n\ndeb https://archive.ubuntu.com/ubuntu noble main\ndeb http://security.ubuntu.com/ubuntu noble-security main\ndeb http://ports.ubuntu.com/ubuntu-ports noble main\ndeb mirror+file:/etc/apt/apt-mirrors-security.txt noble main\ndeb https://packages.microsoft.com/repos/code stable main\ndeb https://ppa.launchpadcontent.net/owner/ppa/ubuntu noble main\ndeb https://ddv1982.github.io/qa-scribe/apt stable main\ndeb http://azure.archive.ubuntu.com.evil/ubuntu noble main\ndeb http://azure.archive.ubuntu.com/ubuntu/path noble main\ndeb [signed-by=http://azure.archive.ubuntu.com/ubuntu] https://other.example/ubuntu noble main\nother http://azure.archive.ubuntu.com/ubuntu\n',
    count: 0,
  },
]

for (const { name, transform, input, expected, count } of cases) {
  test(name, () => {
    assert.deepEqual(transform(input), { text: expected, uriCount: count })
    assert.deepEqual(transform(expected), { text: expected, uriCount: 0 })
  })
}

test('recognized malformed records fail instead of guessing URI positions', () => {
  assert.throws(() => normalizeLegacySources('deb [arch=amd64 http://azure.archive.ubuntu.com/ubuntu noble main\n'), /Invalid legacy/)
  assert.throws(() => normalizeDeb822Sources('Types: deb\nURIs http://azure.archive.ubuntu.com/ubuntu\n'), /Invalid Deb822/)
  assert.throws(() => normalizeDeb822Sources('Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\nEnabled: maybe\n'), /Invalid Deb822/)
})

test('CLI changes only immediate source files, preserves metadata, and is idempotent', t => {
  const root = temporaryRoot(t)
  mkdirSync(join(root, 'sources.list.d', 'nested'), { recursive: true })
  const source = join(root, 'sources.list')
  writeFileSync(source, 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
  chmodSync(source, 0o640)
  const before = statSync(source)
  writeFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\n')
  const untouched = ['apt-mirrors.txt', 'sources.list.d/ignored.list.save', 'sources.list.d/nested/ignored.list']
  for (const path of untouched) writeFileSync(join(root, path), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
  const first = cli(root)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.stdout, 'APT sources normalized: 2 files, 2 URIs.\n')
  assert.equal(readFileSync(source, 'utf8'), 'deb https://archive.ubuntu.com/ubuntu noble main\n')
  assert.equal(readFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), 'utf8'), 'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble\n')
  const after = statSync(source)
  assert.deepEqual([after.mode, after.uid, after.gid, after.ino], [before.mode, before.uid, before.gid, before.ino])
  for (const path of untouched) assert.equal(readFileSync(join(root, path), 'utf8'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
  const second = cli(root)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout, 'APT sources unchanged: no eligible URIs.\n')
  assert.equal(statSync(source).mtimeMs, after.mtimeMs)
})

test('CLI skips ineligible or absent runner context before accessing the root', t => {
  const root = join(temporaryRoot(t), 'not-a-directory')
  writeFileSync(root, 'sentinel')
  for (const context of [[], ['--runner-os', 'Linux'], ['--runner-environment', 'github-hosted'], ['--runner-os', 'macOS', '--runner-environment', 'github-hosted'], ['--runner-os', 'Linux', '--runner-environment', 'self-hosted']]) {
    const result = cli(root, context)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'APT sources unchanged: requires GitHub-hosted Linux.\n')
  }
  assert.equal(readFileSync(root, 'utf8'), 'sentinel')
})

test('CLI requires an explicit root and accepts missing source files as a no-op', t => {
  const absent = spawnSync(process.execPath, [script, ...hosted], { encoding: 'utf8' })
  assert.equal(absent.status, 1)
  assert.match(absent.stderr, /--root/)
  for (const root of [temporaryRoot(t), join(temporaryRoot(t), 'missing')]) {
    const result = cli(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'APT sources unchanged: no eligible URIs.\n')
  }
})

test('CLI plans all transformations before writing and propagates read failures', t => {
  const root = temporaryRoot(t)
  mkdirSync(join(root, 'sources.list.d'))
  writeFileSync(join(root, 'sources.list'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
  symlinkSync(join(root, 'missing'), join(root, 'sources.list.d', 'broken.sources'))
  const result = cli(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ENOENT/)
  assert.equal(readFileSync(join(root, 'sources.list'), 'utf8'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
})

test('CLI leaves every file unchanged when a later source has invalid syntax', t => {
  const root = temporaryRoot(t)
  mkdirSync(join(root, 'sources.list.d'))
  writeFileSync(join(root, 'sources.list'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
  writeFileSync(join(root, 'sources.list.d', 'broken.sources'), 'Types: deb\nURIs http://azure.archive.ubuntu.com/ubuntu\n')
  const result = cli(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Invalid Deb822/)
  assert.equal(result.stdout, '')
  assert.equal(readFileSync(join(root, 'sources.list'), 'utf8'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
})

test('CLI propagates a forced write failure without reporting success', t => {
  const root = temporaryRoot(t)
  writeFileSync(join(root, 'sources.list'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
  const preload = join(root, 'deny-write.mjs')
  writeFileSync(preload, "import fs from 'node:fs'\nimport { syncBuiltinESMExports } from 'node:module'\nfs.writeFileSync = () => { throw new Error('forced write failure') }\nsyncBuiltinESMExports()\n")
  const result = spawnSync(process.execPath, ['--import', preload, script, '--root', root, ...hosted], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /forced write failure/)
  assert.equal(result.stdout, '')
  assert.equal(readFileSync(join(root, 'sources.list'), 'utf8'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n')
})
