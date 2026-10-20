// node scripts/find-forever-launch.mjs --product <the product we publish> [--region us]
// Looks for Forever going live: a public product (publicProducts) on a 1.60 build other than the one we
// publish. Prints what each public product runs; in GitHub Actions also writes the step output
// products (space-separated, empty when none). Reads only Blizzard's version service.
import { appendFileSync } from 'node:fs'
import { buildFromVersions, fail, foreverLaunchProducts, publicProducts } from './lib.mjs'

const opts = { region: 'us' }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (['--product', '--region'].includes(a) && argv[i + 1]) opts[a.slice(2)] = argv[++i]
  else fail(`Unknown or incomplete argument: ${a}`)
}
if (!opts.product) fail('--product is required, for example --product wow_classic_beta')

async function get(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) fail(`GET ${url} answered ${res.status} ${res.statusText}`)
  return res.text()
}

const rows = []
for (const product of publicProducts(await get('https://us.version.battle.net/v2/summary'))) {
  const versions = await get(`https://us.version.battle.net/v2/products/${product}/versions`)
  try {
    rows.push({ product, version: buildFromVersions(versions, opts.region) })
  } catch {
    console.log(`${product}: no ${opts.region} build`) // some products ship only to other regions
  }
}
for (const r of rows) console.log(`${r.product}: ${r.version}`)
const found = foreverLaunchProducts(rows, opts.product)
console.log(found.length ? `Forever looks live as ${found.join(', ')}; we publish ${opts.product}.` : `No public product other than ${opts.product} is on Forever's 1.60 builds.`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `products=${found.join(' ')}\n`)
