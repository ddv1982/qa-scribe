const [targetPlatform, label = targetPlatform] = process.argv.slice(2)

if (!targetPlatform) {
  console.error('Usage: node scripts/assert-package-platform.cjs <platform> <label>')
  process.exit(1)
}

if (process.platform !== targetPlatform) {
  console.error(
    `Refusing to package ${label} on ${process.platform}. Native dependencies must be rebuilt on the target OS.`
  )
  process.exit(1)
}
