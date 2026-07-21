import { chmod, lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const VERSION_TRANSACTION_MANIFEST = '.qa-scribe-version-transaction.json'

/**
 * Apply a complete version plan as a process-interruption-safe transaction.
 * The phase manifest is written before staging and atomically replaced before
 * commit, so a later invocation can restore or clean up partial work.
 */
export async function applyPlanTransaction(plan, options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd())
  const replace = options.replace ?? atomicReplace
  const transactionId = options.transactionId ?? randomUUID()
  await recoverInterruptedVersionTransaction({ rootDir, replace })

  const staged = []
  const seenTargets = new Set()
  for (const [index, change] of plan.entries()) {
    const targetPath = resolvePlanTarget(rootDir, change.path)
    if (seenTargets.has(targetPath)) {
      throw new Error(`Version bump plan contains duplicate target ${change.path}`)
    }
    seenTargets.add(targetPath)

    const currentContent = await readFile(targetPath, 'utf8')
    if (typeof change.previousContent === 'string' && currentContent !== change.previousContent) {
      throw new Error(`Version bump target changed after preflight: ${change.path}`)
    }
    const targetStat = await lstat(targetPath)
    if (!targetStat.isFile()) {
      throw new Error(`Version bump target is not a regular file: ${change.path}`)
    }

    const prefix = `.${basename(targetPath)}.qa-scribe-bump-${transactionId}-${index}`
    staged.push({
      ...change,
      originalContent: currentContent,
      previousDigest: contentDigest(currentContent),
      nextDigest: contentDigest(change.nextContent),
      targetPath,
      stagedPath: resolve(dirname(targetPath), `${prefix}.next`),
      rollbackPath: resolve(dirname(targetPath), `${prefix}.rollback`),
      mode: targetStat.mode & 0o777
    })
  }

  const manifest = transactionManifest(rootDir, transactionId, 'staging', staged)
  await writeTransactionManifest(rootDir, manifest)
  try {
    for (const item of staged) {
      await writeFile(item.stagedPath, item.nextContent, { encoding: 'utf8', flag: 'wx', mode: item.mode })
      await chmod(item.stagedPath, item.mode)
      await writeFile(item.rollbackPath, item.originalContent, { encoding: 'utf8', flag: 'wx', mode: item.mode })
      await chmod(item.rollbackPath, item.mode)
    }
    manifest.phase = 'committing'
    await writeTransactionManifest(rootDir, manifest)
  } catch (error) {
    await cleanupTransactionFiles(staged)
    await removeTransactionManifest(rootDir)
    throw error
  }

  const replaced = []
  try {
    for (const item of staged) {
      const currentContent = await readFile(item.targetPath, 'utf8')
      if (currentContent !== item.originalContent) {
        throw new Error(`Version bump target changed after staging: ${item.path}`)
      }
      await replace(item.stagedPath, item.targetPath, { phase: 'commit', item })
      replaced.push(item)
    }
    manifest.phase = 'committed'
    await writeTransactionManifest(rootDir, manifest)
  } catch (commitError) {
    const rollbackFailures = await rollbackTransactionItems([...replaced].reverse(), replace)
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [commitError, ...rollbackFailures.map(({ error }) => error)],
        'Version bump replacement failed and rollback was incomplete. The next invocation will retry recovery from the preserved transaction manifest.',
        { cause: commitError }
      )
    }
    await cleanupTransactionFiles(staged)
    await removeTransactionManifest(rootDir)
    throw new Error(`Version bump replacement failed; all replaced files were restored: ${commitError.message}`, { cause: commitError })
  }

  await cleanupTransactionFiles(staged)
  await removeTransactionManifest(rootDir)
}

export async function recoverInterruptedVersionTransaction(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd())
  const replace = options.replace ?? atomicReplace
  const manifestPath = resolve(rootDir, VERSION_TRANSACTION_MANIFEST)
  await rm(`${manifestPath}.next`, { force: true })
  const rawManifest = await readFileIfExists(manifestPath)
  if (rawManifest == null) return false

  const manifest = parseTransactionManifest(rawManifest)
  const items = manifest.items.map(item => ({
    ...item,
    targetPath: resolveTransactionPath(rootDir, item.targetPath),
    stagedPath: resolveTransactionPath(rootDir, item.stagedPath),
    rollbackPath: resolveTransactionPath(rootDir, item.rollbackPath)
  }))

  if (manifest.phase === 'committing') {
    const rollbackFailures = []
    for (const item of [...items].reverse()) {
      const currentContent = await readFileIfExists(item.targetPath)
      if (currentContent != null && contentDigest(currentContent) === item.previousDigest) continue
      if (currentContent == null || contentDigest(currentContent) !== item.nextDigest) {
        rollbackFailures.push({
          item,
          error: new Error(`Version bump target changed after interruption: ${item.path}`)
        })
        continue
      }
      const rollbackContent = await readFileIfExists(item.rollbackPath)
      if (rollbackContent != null) {
        if (contentDigest(rollbackContent) !== item.previousDigest) {
          rollbackFailures.push({
            item,
            error: new Error(`Rollback copy for ${item.path} does not contain the prior content`)
          })
          continue
        }
        try {
          await replace(item.rollbackPath, item.targetPath, { phase: 'recovery', item })
        } catch (error) {
          rollbackFailures.push({ item, error })
        }
        continue
      }
      rollbackFailures.push({
        item,
        error: new Error(`Missing rollback copy for committed version bump target ${item.path}`)
      })
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        rollbackFailures.map(({ error }) => error),
        'Interrupted version bump recovery is incomplete; transaction files were preserved for another recovery attempt.'
      )
    }
  }

  await cleanupTransactionFiles(items)
  await removeTransactionManifest(rootDir)
  return true
}

async function atomicReplace(stagedPath, targetPath) {
  await rename(stagedPath, targetPath)
}

async function rollbackTransactionItems(items, replace) {
  const failures = []
  for (const item of items) {
    try {
      const currentContent = await readFileIfExists(item.targetPath)
      if (currentContent == null || contentDigest(currentContent) !== item.nextDigest) {
        throw new Error(`Version bump target changed before rollback: ${item.path}`)
      }
      await replace(item.rollbackPath, item.targetPath, { phase: 'rollback', item })
    } catch (error) {
      failures.push({ item, error })
    }
  }
  return failures
}

async function cleanupTransactionFiles(staged) {
  const cleanupErrors = []
  for (const item of staged) {
    for (const path of [item.stagedPath, item.rollbackPath]) {
      try {
        await rm(path, { force: true })
      } catch (error) {
        cleanupErrors.push(`${path}: ${error.message}`)
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Could not clean version bump transaction files:\n${cleanupErrors.map(message => `  - ${message}`).join('\n')}`)
  }
}

function transactionManifest(rootDir, transactionId, phase, items) {
  return {
    version: 2,
    transactionId,
    phase,
    items: items.map(item => ({
      path: item.path,
      targetPath: relative(rootDir, item.targetPath),
      stagedPath: relative(rootDir, item.stagedPath),
      rollbackPath: relative(rootDir, item.rollbackPath),
      previousDigest: item.previousDigest,
      nextDigest: item.nextDigest
    }))
  }
}

async function writeTransactionManifest(rootDir, manifest) {
  const manifestPath = resolve(rootDir, VERSION_TRANSACTION_MANIFEST)
  const nextPath = `${manifestPath}.next`
  const handle = await open(nextPath, 'w', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(nextPath, manifestPath)
}

async function removeTransactionManifest(rootDir) {
  const manifestPath = resolve(rootDir, VERSION_TRANSACTION_MANIFEST)
  await rm(manifestPath, { force: true })
  await rm(`${manifestPath}.next`, { force: true })
}

async function readFileIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function parseTransactionManifest(rawManifest) {
  let manifest
  try {
    manifest = JSON.parse(rawManifest)
  } catch (error) {
    throw new Error(`Version transaction manifest is not valid JSON: ${error.message}`)
  }
  if (
    manifest?.version !== 2 ||
    !['staging', 'committing', 'committed'].includes(manifest.phase) ||
    !Array.isArray(manifest.items)
  ) {
    throw new Error('Version transaction manifest has an unsupported shape')
  }
  for (const item of manifest.items) {
    if (
      typeof item?.path !== 'string' ||
      typeof item.targetPath !== 'string' ||
      typeof item.stagedPath !== 'string' ||
      typeof item.rollbackPath !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.previousDigest) ||
      !/^[a-f0-9]{64}$/.test(item.nextDigest)
    ) {
      throw new Error('Version transaction manifest contains an invalid item')
    }
  }
  return manifest
}

function resolvePlanTarget(rootDir, path) {
  const targetPath = resolve(rootDir, path)
  const relativePath = relative(rootDir, targetPath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Version bump target is outside the repository: ${path}`)
  }
  return targetPath
}

function resolveTransactionPath(rootDir, path) {
  if (isAbsolute(path)) throw new Error('Version transaction manifest paths must be relative')
  return resolvePlanTarget(rootDir, path)
}

function contentDigest(content) {
  return createHash('sha256').update(content).digest('hex')
}
