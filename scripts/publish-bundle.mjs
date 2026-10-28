// npm run publish:bundle -- --product <code> [--bundle output/bundle] [--bucket <name>] [--distribution <id>]
//   [--profile <aws profile>] [--prune] [--dry-run]
// Uploads the build that {bundle}/{product}/current.json names to the assets bucket, then switches the
// live current.json and invalidates it in CloudFront. Uses the AWS CLI and whatever credentials it
// finds (a profile locally, the deploy role in CI). --bucket and --distribution default to the
// BUNDLE_BUCKET and ASSET_DISTRIBUTION_ID environment variables. --prune then deletes every build
// folder but the new one and the one it replaced. --dry-run prints the commands only (it still reads
// the bucket to show what --prune would delete).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { buildsToPrune, fail, prunePlan, publishPlan, root, run } from './lib.mjs'

const opts = { bundle: join(root, 'output', 'bundle'), bucket: process.env.BUNDLE_BUCKET, distribution: process.env.ASSET_DISTRIBUTION_ID }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry-run') opts.dryRun = true
  else if (a === '--prune') opts.prune = true
  else if (['--product', '--bundle', '--bucket', '--distribution', '--profile'].includes(a) && argv[i + 1]) opts[a.slice(2)] = argv[++i]
  else fail(`Unknown or incomplete argument: ${a}`)
}
if (!opts.product) fail('--product is required, for example --product wowf')
if (!opts.bucket || !opts.distribution) fail('Set --bucket and --distribution, or BUNDLE_BUCKET and ASSET_DISTRIBUTION_ID')

let current
try {
  current = JSON.parse(readFileSync(join(opts.bundle, opts.product, 'current.json'), 'utf8'))
} catch (e) {
  fail(`Could not read ${opts.product}/current.json in ${opts.bundle}: ${e.message}`)
}

const buildDir = join(opts.bundle, opts.product, current.build)
const files = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else files.push({ path: relative(buildDir, p).split(sep).join('/'), size: statSync(p).size })
  }
}
try { walk(buildDir) } catch (e) { fail(`Could not read the build folder ${buildDir}: ${e.message}`) }

// Reads only, so --dry-run runs these too. A failed read returns null.
const profileArgs = opts.profile ? ['--profile', opts.profile] : []
const awsRead = (args) => {
  const r = spawnSync('aws', [...args, ...profileArgs], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}
// The build live before this publish: kept by --prune, so a rollback is one current.json away. When it
// is this build, the publish rewrites files CloudFront may hold, so the plan invalidates the build.
const liveText = awsRead(['s3', 'cp', `s3://${opts.bucket}/${opts.product}/current.json`, '-'])
const previous = liveText ? JSON.parse(liveText).build : null

let plan
try {
  plan = publishPlan({ bundleDir: opts.bundle, product: opts.product, bucket: opts.bucket, distribution: opts.distribution, profile: opts.profile, current, files, republish: previous === current.build })
} catch (e) {
  fail(e.message)
}

console.log(`Publishing ${opts.product} ${current.build}: ${files.length} files, ${plan.filter((s) => s.kind === 'gzip').reduce((n, s) => n + s.files.length, 0)} gzipped.`)

const tmp = mkdtempSync(join(tmpdir(), 'altrobe-publish-'))
try {
  for (const step of plan) {
    let args = step.args
    if (step.kind === 'gzip') {
      // The gzipped copies keep their paths, so one sync uploads them all to where the originals go.
      const stage = join(tmp, String(plan.indexOf(step)))
      if (!opts.dryRun) {
        for (const p of step.files) {
          const gz = join(stage, ...p.split('/'))
          mkdirSync(dirname(gz), { recursive: true })
          writeFileSync(gz, gzipSync(readFileSync(join(step.from, ...p.split('/'))), { level: 9 }))
        }
      }
      args = args.map((x) => (x === '{stage}' ? stage : x))
    }
    console.log(`aws ${args.join(' ')}`)
    if (!opts.dryRun) run('aws', args)
  }
  if (opts.prune) {
    const listed = awsRead(['s3api', 'list-objects-v2', '--bucket', opts.bucket, '--prefix', `${opts.product}/`, '--delimiter', '/', '--query', 'CommonPrefixes[].Prefix', '--output', 'json'])
    if (listed === null) fail(`Could not list s3://${opts.bucket}/${opts.product}/ to prune old builds.`)
    const folders = (JSON.parse(listed) ?? []).map((p) => p.slice(opts.product.length + 1))
    const builds = buildsToPrune({ folders, current: current.build, previous })
    console.log(previous && previous !== current.build ? `Keeping ${current.build} and ${previous}; pruning ${builds.length ? builds.join(', ') : 'nothing'}.` : 'No distinct previous build, so nothing is pruned.')
    for (const step of prunePlan({ bucket: opts.bucket, product: opts.product, builds, profile: opts.profile })) {
      console.log(`aws ${step.args.join(' ')}`)
      if (!opts.dryRun) run('aws', step.args)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
console.log(opts.dryRun ? 'Dry run: nothing was uploaded.' : `${opts.product} now serves ${current.build}.`)
