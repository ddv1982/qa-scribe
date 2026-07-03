#!/usr/bin/env node
// Guards the APT Pages deploy against publishing an older release over a newer
// live one. release.yml's APT repository is generated from-scratch for the
// current tag only, so a re-run of an older tag would silently clobber the
// live repository backwards. This fetches the live Packages index (if any),
// compares its qa-scribe package version against the version about to be
// published, and fails the job when the live version is newer.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readOption as readOptionFrom, readReleaseConstants } from './command-utils.mjs'

const PACKAGE_NAME = 'qa-scribe'
const ARCHITECTURE = 'amd64'
const COMPONENT = 'main'

export function compareVersions(a, b) {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  const length = Math.max(partsA.length, partsB.length)
  for (let index = 0; index < length; index += 1) {
    const partA = partsA[index] ?? 0
    const partB = partsB[index] ?? 0
    if (partA !== partB) return partA < partB ? -1 : 1
  }
  return 0
}

export function extractPackageVersion(packagesText, packageName) {
  const stanzas = packagesText.split(/\n\n+/).map(stanza => stanza.trim()).filter(Boolean)
  for (const stanza of stanzas) {
    const nameMatch = stanza.match(/^Package: (.+)$/m)
    if (nameMatch?.[1] !== packageName) continue
    const versionMatch = stanza.match(/^Version: (.+)$/m)
    if (!versionMatch) continue
    return versionMatch[1].trim()
  }
  return null
}

export function packagesUrl(releaseConstants, { component = COMPONENT, architecture = ARCHITECTURE } = {}) {
  const base = releaseConstants.pagesBaseUrl.endsWith('/')
    ? releaseConstants.pagesBaseUrl
    : `${releaseConstants.pagesBaseUrl}/`
  return `${base}${releaseConstants.aptRepoPath}/${component}/binary-${architecture}/Packages`
}

export async function checkMonotonic({ publishingVersion, fetchImpl = fetch, releaseConstants = readReleaseConstants() }) {
  const url = packagesUrl(releaseConstants)
  const response = await fetchImpl(url)

  if (response.status === 404) {
    return { status: 'first-publish', url }
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch live APT Packages index (${response.status}): ${url}`)
  }

  const packagesText = await response.text()
  const liveVersion = extractPackageVersion(packagesText, PACKAGE_NAME)
  if (!liveVersion) {
    throw new Error(`Live APT Packages index at ${url} does not contain a ${PACKAGE_NAME} stanza with a Version field`)
  }

  const comparison = compareVersions(liveVersion, publishingVersion)
  if (comparison > 0) {
    throw new Error(
      `Refusing to publish APT repository: live version ${liveVersion} is newer than publishing version ${publishingVersion} (${url}). ` +
        'Re-running an older release tag would overwrite the live from-scratch APT repository backwards.'
    )
  }

  return { status: comparison === 0 ? 'idempotent-rerun' : 'newer-publish', url, liveVersion }
}

async function main() {
  const args = process.argv.slice(2)
  const versionOption = readOptionFrom(args, '--version')
  const publishingVersion = versionOption ?? JSON.parse(await readFile('package.json', 'utf8')).version

  const result = await checkMonotonic({ publishingVersion })
  if (result.status === 'first-publish') {
    console.log(`APT Packages index not found at ${result.url} (first publish); proceeding.`)
  } else if (result.status === 'idempotent-rerun') {
    console.log(`Live APT version ${result.liveVersion} equals publishing version ${publishingVersion}; idempotent re-run, proceeding.`)
  } else {
    console.log(`Live APT version ${result.liveVersion} is older than publishing version ${publishingVersion}; proceeding.`)
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  main().catch(error => {
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  })
}
