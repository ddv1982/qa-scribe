import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { checkMonotonic } from './check-apt-monotonic.mjs'

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const lines = workflow.split('\n')
const start = lines.indexOf('  publish-apt-repository:')
assert.ok(start >= 0, 'APT publication job exists')
const end = lines.findIndex((line, index) => index > start && /^  [a-z0-9-]+:$/.test(line))
const job = lines.slice(start + 1, end < 0 ? undefined : end).join('\n')
const jobGroup = job.match(/^      group: (.+)$/m)?.[1]
const cancel = job.match(/^      cancel-in-progress: (.+)$/m)?.[1]
const inheritedGroup = workflow.match(/^concurrency:\n  group: (.+)$/m)?.[1]

test('APT check and deploy own one fixed noncanceling cross-tag concurrency group', () => {
  assert.match(job, /^    concurrency:$/m)
  assert.equal(jobGroup, 'qa-scribe-apt-publication')
  assert.equal(cancel, 'false')
  const guard = job.indexOf('run: node scripts/check-apt-monotonic.mjs')
  const deploy = job.indexOf('uses: actions/deploy-pages@')
  assert.ok(guard >= 0 && deploy > guard, 'the live-version recheck and deployment must stay inside the serialized job')
})

// Model GitHub's documented group exclusion, using the actual workflow group
// and the real live-index guard. This is not hosted deployment evidence.
async function publishSchedule(order) {
  let live = '1.2.0'
  const observations = []
  const rejected = []
  const group = jobGroup ?? inheritedGroup ?? '${{ github.ref }}'
  const groups = order.map((version) => group.replace('${{ github.ref }}', `refs/tags/v${version}`).toLowerCase())
  const serialized = groups.every((value) => value === groups[0]) && cancel === 'false'
  async function allowed(version) {
    try {
      await checkMonotonic({
        publishingVersion: version,
        releaseConstants: { pagesBaseUrl: 'https://fixture.invalid/', aptRepoPath: 'apt' },
        fetchImpl: async () => {
          observations.push(live)
          return new Response(`Package: qa-scribe\nVersion: ${live}\n\n`)
        },
      })
      return true
    } catch (error) {
      assert.match(error.message, /live version .* is newer/)
      rejected.push(version)
      return false
    }
  }
  if (serialized) {
    for (const version of order) if (await allowed(version)) live = version
  } else {
    // Both per-tag jobs can check the same old index before either deploys.
    const decisions = await Promise.all(order.map(allowed))
    for (const [index, version] of order.entries()) if (decisions[index]) live = version
  }
  return { live, observations, rejected }
}

test('newer publication followed by an older waiting job cannot regress the live version', async () => {
  assert.deepEqual(await publishSchedule(['1.3.0', '1.2.3']), {
    live: '1.3.0', observations: ['1.2.0', '1.3.0'], rejected: ['1.2.3'],
  })
})

test('older publication followed by a newer waiting job advances the live version', async () => {
  assert.deepEqual(await publishSchedule(['1.2.3', '1.3.0']), {
    live: '1.3.0', observations: ['1.2.0', '1.2.3'], rejected: [],
  })
})
