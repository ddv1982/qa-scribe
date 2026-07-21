import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { buildPlan, cargoLockCrateVersions } from './bump-version.mjs'
import { applyPlanTransaction, recoverInterruptedVersionTransaction } from './version-transaction.mjs'

const BUMP_SCRIPT_PATH = resolve('scripts/bump-version.mjs')
const PATHS = [
  'package.json',
  'frontend/package.json',
  'Cargo.toml',
  'Cargo.lock',
  'src-tauri/tauri.conf.json',
  'CHANGELOG.md',
  'build/linux/io.github.ddv1982.qa-scribe.metainfo.xml'
]

async function makeFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'qa-scribe-version-transaction-'))
  const plan = []
  for (const [index, path] of PATHS.entries()) {
    const target = join(rootDir, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `old-${index}\n`)
    plan.push({ path, description: `fixture ${index}`, previousContent: `old-${index}\n`, nextContent: `new-${index}\n` })
  }
  return { rootDir, plan }
}

async function assertContents(rootDir, prefix) {
  for (const [index, path] of PATHS.entries()) {
    assert.equal(await readFile(join(rootDir, path), 'utf8'), `${prefix}-${index}\n`, path)
  }
}

async function assertNoTransactionFiles(rootDir) {
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else assert.doesNotMatch(entry.name, /\.qa-scribe-(?:bump-|version-transaction)/, path)
    }
  }
  await walk(rootDir)
}

test('every output is staged before the first destination replacement', async () => {
  const { rootDir, plan } = await makeFixture()
  let checked = false
  try {
    await applyPlanTransaction(plan, {
      rootDir,
      transactionId: 'all-staged',
      replace: async (source, target, context) => {
        if (!checked && context.phase === 'commit') {
          for (const [index, path] of PATHS.entries()) {
            const prefix = `.${path.split('/').at(-1)}.qa-scribe-bump-all-staged-${index}`
            const names = await readdir(dirname(join(rootDir, path)))
            assert.ok(names.includes(`${prefix}.next`), `${path} next content`)
            assert.ok(names.includes(`${prefix}.rollback`), `${path} rollback content`)
          }
          checked = true
        }
        await rename(source, target)
      }
    })
    assert.equal(checked, true)
    await assertContents(rootDir, 'new')
    await assertNoTransactionFiles(rootDir)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('a replacement failure at every position restores all prior files', async (t) => {
  for (let failureIndex = 0; failureIndex < PATHS.length; failureIndex += 1) {
    await t.test(`replacement ${failureIndex + 1}`, async () => {
      const { rootDir, plan } = await makeFixture()
      let commitIndex = 0
      try {
        await assert.rejects(applyPlanTransaction(plan, {
          rootDir,
          transactionId: `failure-${failureIndex}`,
          replace: async (source, target, context) => {
            if (context.phase === 'commit' && commitIndex === failureIndex) throw new Error('injected failure')
            if (context.phase === 'commit') commitIndex += 1
            await rename(source, target)
          }
        }), /all replaced files were restored/)
        await assertContents(rootDir, 'old')
        await assertNoTransactionFiles(rootDir)
      } finally {
        await rm(rootDir, { recursive: true, force: true })
      }
    })
  }
})

test('changes before and after staging never overwrite concurrent edits', async () => {
  const first = await makeFixture()
  try {
    await writeFile(join(first.rootDir, PATHS[3]), 'concurrent-edit\n')
    await assert.rejects(applyPlanTransaction(first.plan, { rootDir: first.rootDir }), /changed after preflight/)
    assert.equal(await readFile(join(first.rootDir, PATHS[3]), 'utf8'), 'concurrent-edit\n')
    await assertNoTransactionFiles(first.rootDir)
  } finally {
    await rm(first.rootDir, { recursive: true, force: true })
  }

  const second = await makeFixture()
  let firstCommit = true
  try {
    await assert.rejects(applyPlanTransaction(second.plan, {
      rootDir: second.rootDir,
      transactionId: 'changed-after-staging',
      replace: async (source, target, context) => {
        await rename(source, target)
        if (context.phase === 'commit' && firstCommit) {
          firstCommit = false
          await writeFile(join(second.rootDir, PATHS[1]), 'concurrent-edit\n')
        }
      }
    }), /target changed after staging/)
    assert.equal(await readFile(join(second.rootDir, PATHS[1]), 'utf8'), 'concurrent-edit\n')
    await assertNoTransactionFiles(second.rootDir)
  } finally {
    await rm(second.rootDir, { recursive: true, force: true })
  }
})

test('a failed immediate rollback is recovered automatically on the next invocation', async () => {
  const { rootDir, plan } = await makeFixture()
  let commitIndex = 0
  try {
    await assert.rejects(applyPlanTransaction(plan, {
      rootDir,
      transactionId: 'rollback-recovery',
      replace: async (source, target, context) => {
        if (context.phase === 'commit' && commitIndex === 3) throw new Error('commit failure')
        if (context.phase === 'commit') commitIndex += 1
        if (context.phase === 'rollback' && context.item.path === PATHS[1]) throw new Error('rollback failure')
        await rename(source, target)
      }
    }), /next invocation will retry recovery/)
    assert.equal(await recoverInterruptedVersionTransaction({ rootDir }), true)
    await assertContents(rootDir, 'old')
    await assertNoTransactionFiles(rootDir)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('interrupted recovery refuses to overwrite a later edit', async () => {
  const { rootDir } = await makeFixture()
  const items = []
  try {
    for (const [index, path] of PATHS.entries()) {
      const target = join(rootDir, path)
      const prefix = `.${path.split('/').at(-1)}.qa-scribe-bump-conflict-${index}`
      const staged = join(dirname(target), `${prefix}.next`)
      const rollback = join(dirname(target), `${prefix}.rollback`)
      await writeFile(staged, `new-${index}\n`)
      await writeFile(rollback, `old-${index}\n`)
      items.push({
        path,
        targetPath: path,
        stagedPath: join(dirname(path), `${prefix}.next`),
        rollbackPath: join(dirname(path), `${prefix}.rollback`),
        previousDigest: createHash('sha256').update(`old-${index}\n`).digest('hex'),
        nextDigest: createHash('sha256').update(`new-${index}\n`).digest('hex')
      })
    }
    await writeFile(join(rootDir, PATHS[0]), 'new-0\n')
    await writeFile(join(rootDir, PATHS[3]), 'edited-after-interruption\n')
    await writeFile(join(rootDir, '.qa-scribe-version-transaction.json'), JSON.stringify({
      version: 2,
      transactionId: 'conflict',
      phase: 'committing',
      items
    }))

    await assert.rejects(recoverInterruptedVersionTransaction({ rootDir }), error => {
      assert.ok(error instanceof AggregateError)
      assert.ok(error.errors.some(item => /target changed after interruption: Cargo.lock/.test(item.message)))
      return true
    })
    assert.equal(await readFile(join(rootDir, PATHS[0]), 'utf8'), 'old-0\n')
    assert.equal(await readFile(join(rootDir, PATHS[3]), 'utf8'), 'edited-after-interruption\n')
    assert.equal(await readFile(join(rootDir, '.qa-scribe-version-transaction.json'), 'utf8').then(Boolean), true)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('completed transaction recovery keeps new files and only cleans temporary state', async () => {
  const { rootDir } = await makeFixture()
  const items = []
  try {
    for (const [index, path] of PATHS.entries()) {
      const target = join(rootDir, path)
      const prefix = `.${path.split('/').at(-1)}.qa-scribe-bump-committed-${index}`
      const staged = join(dirname(target), `${prefix}.next`)
      const rollback = join(dirname(target), `${prefix}.rollback`)
      await writeFile(target, `new-${index}\n`)
      await writeFile(staged, `new-${index}\n`)
      await writeFile(rollback, `old-${index}\n`)
      items.push({
        path,
        targetPath: path,
        stagedPath: join(dirname(path), `${prefix}.next`),
        rollbackPath: join(dirname(path), `${prefix}.rollback`),
        previousDigest: createHash('sha256').update(`old-${index}\n`).digest('hex'),
        nextDigest: createHash('sha256').update(`new-${index}\n`).digest('hex')
      })
    }
    await writeFile(join(rootDir, '.qa-scribe-version-transaction.json'), JSON.stringify({
      version: 2,
      transactionId: 'committed',
      phase: 'committed',
      items
    }))
    assert.equal(await recoverInterruptedVersionTransaction({ rootDir }), true)
    await assertContents(rootDir, 'new')
    await assertNoTransactionFiles(rootDir)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

const CARGO_TOML = `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "0.4.24"\n`
const CARGO_LOCK = ['qa-scribe-app', 'qa-scribe-core', 'qa-scribe-tauri']
  .map(name => `[[package]]\nname = "${name}"\nversion = "0.4.24"\n`)
  .join('\n')
const CHANGELOG = '# Changelog\n\n## v0.4.24 - 2026-07-02\n\n- Prior.\n'
const METAINFO = '<component><releases>\n    <release version="0.4.24" date="2026-07-02" />\n  </releases></component>\n'

async function writeCliFixture(rootDir) {
  const packageJsonRaw = `${JSON.stringify({ name: 'qa-scribe', version: '0.4.24' }, null, 2)}\n`
  const frontendPackageJsonRaw = `${JSON.stringify({ name: 'frontend', version: '0.4.24' }, null, 2)}\n`
  const tauriConfRaw = `${JSON.stringify({ version: '0.4.24', identifier: 'io.github.ddv1982.qa-scribe' }, null, 2)}\n`
  const contents = [packageJsonRaw, frontendPackageJsonRaw, CARGO_TOML, CARGO_LOCK, tauriConfRaw, CHANGELOG, METAINFO]
  for (const [index, path] of PATHS.entries()) await writeFile(join(rootDir, path), contents[index])
  return buildPlan({
    packageJsonRaw,
    packageJson: JSON.parse(packageJsonRaw),
    frontendPackageJsonRaw,
    frontendPackageJson: JSON.parse(frontendPackageJsonRaw),
    cargoToml: CARGO_TOML,
    cargoLock: CARGO_LOCK,
    tauriConfRaw,
    tauriConf: JSON.parse(tauriConfRaw),
    changelog: CHANGELOG,
    metainfo: METAINFO
  }, {
    newVersion: '0.5.0',
    today: '2026-07-21',
    metainfoPath: PATHS[6]
  })
}

test('CLI dry-run leaves every version-bearing file unchanged', async () => {
  const { rootDir } = await makeFixture()
  try {
    await writeCliFixture(rootDir)
    const before = await Promise.all(PATHS.map(path => readFile(join(rootDir, path), 'utf8')))
    const result = spawnSync(process.execPath, [BUMP_SCRIPT_PATH, '0.5.0', '--dry-run'], { cwd: rootDir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await Promise.all(PATHS.map(path => readFile(join(rootDir, path), 'utf8'))), before)
    await assertNoTransactionFiles(rootDir)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('the next CLI invocation rolls back a process killed between replacements', { skip: process.platform === 'win32' }, async () => {
  const { rootDir } = await makeFixture()
  try {
    const plan = await writeCliFixture(rootDir)
    const planPath = join(rootDir, 'interrupt-plan.json')
    await writeFile(planPath, JSON.stringify(plan))
    const childScript = `
      import { rename, readFile } from 'node:fs/promises';
      import { applyPlanTransaction } from ${JSON.stringify(new URL('./version-transaction.mjs', import.meta.url).href)};
      const plan = JSON.parse(await readFile(process.env.QA_SCRIBE_TEST_PLAN, 'utf8'));
      let replacements = 0;
      await applyPlanTransaction(plan, {
        rootDir: process.env.QA_SCRIBE_TEST_ROOT,
        transactionId: 'process-interruption',
        replace: async (source, target, context) => {
          await rename(source, target);
          if (context.phase === 'commit' && ++replacements === 2) process.kill(process.pid, 'SIGKILL');
        }
      });
    `
    const interrupted = spawnSync(process.execPath, ['--input-type=module', '--eval', childScript], {
      env: { ...process.env, QA_SCRIBE_TEST_PLAN: planPath, QA_SCRIBE_TEST_ROOT: rootDir },
      encoding: 'utf8'
    })
    assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr)

    const recovery = spawnSync(process.execPath, [BUMP_SCRIPT_PATH, '0.5.0', '--dry-run'], { cwd: rootDir, encoding: 'utf8' })
    assert.equal(recovery.status, 0, recovery.stderr)
    assert.match(recovery.stdout, /Recovered an interrupted version bump before preflight/)
    assert.equal(JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')).version, '0.4.24')
    assert.deepEqual(cargoLockCrateVersions(await readFile(join(rootDir, 'Cargo.lock'), 'utf8')), {
      'qa-scribe-app': '0.4.24',
      'qa-scribe-core': '0.4.24',
      'qa-scribe-tauri': '0.4.24'
    })
    await assertNoTransactionFiles(rootDir)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
