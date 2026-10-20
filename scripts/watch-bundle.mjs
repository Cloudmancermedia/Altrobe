// node scripts/watch-bundle.mjs --product <code> [--region us] [--live https://assets.altrobe.com] [--out output/watch] [--force]
// Asks Blizzard's version service for the product's current build and compares it with the live
// {product}/current.json. Saves the version service answer to {out}/versions.txt, so the bake reads
// the same build (--versions-file), and the live build's manifest to {out}/previous-manifest.json for
// the bake's count check (--previous). Prints the result; in GitHub Actions also writes the step
// outputs build, live and changed. --force reports a change even when the live build is current, to
// republish it after an Altrobe change. Reads only; writes nothing to AWS.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFromVersions, fail, isNewBuild, root } from './lib.mjs'

const opts = { region: 'us', live: 'https://assets.altrobe.com', out: join(root, 'output', 'watch') }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (['--product', '--region', '--live', '--out'].includes(a) && argv[i + 1]) opts[a.slice(2)] = argv[++i]
  else if (a === '--force') opts.force = true
  else fail(`Unknown or incomplete argument: ${a}`)
}
if (!opts.product) fail('--product is required, for example --product wow_classic_beta')

async function get(url, { optional = false } = {}) {
  const res = await fetch(url, { cache: 'no-store' })
  // CloudFront answers 403 for a missing key (origin access control), so both mean "not published".
  if (optional && (res.status === 403 || res.status === 404)) return null
  if (!res.ok) fail(`GET ${url} answered ${res.status} ${res.statusText}`)
  return res.text()
}

mkdirSync(opts.out, { recursive: true })
const versions = await get(`https://us.version.battle.net/v2/products/${encodeURIComponent(opts.product)}/versions`)
writeFileSync(join(opts.out, 'versions.txt'), versions)
let build
try {
  build = buildFromVersions(versions, opts.region)
} catch (e) {
  fail(e.message)
}

const liveText = await get(`${opts.live}/${opts.product}/current.json`, { optional: true })
const live = liveText ? JSON.parse(liveText) : null
if (live) {
  const manifest = await get(`${opts.live}/${opts.product}/${live.path}manifest.json`, { optional: true })
  if (manifest) writeFileSync(join(opts.out, 'previous-manifest.json'), manifest)
}

const changed = isNewBuild(live, build, { force: opts.force })
console.log(`${opts.product}: version service has ${build}, live is ${live?.build ?? '(nothing published)'}. ${changed ? (opts.force && live?.build === build ? 'Forced republish.' : 'New build.') : 'Up to date.'}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\nlive=${live?.build ?? ''}\nchanged=${changed}\n`)
