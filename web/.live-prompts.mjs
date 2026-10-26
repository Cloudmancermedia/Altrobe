// Runs a few real commands through the live prompt box and records every /api/prompt response.
import { chromium } from 'playwright'

const prompts = [
  'Put the Orc in Thunderfury and show it on an Undead female',
  'put this Undead in Judgement',
  'an Undead Paladin in tier 2 with Sulfuras',
]

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
let last = Date.now()
const log = []
page.on('response', async (r) => {
  if (!r.url().includes('/api/prompt')) return
  last = Date.now()
  let body = ''
  try { body = await r.text() } catch {}
  const j = (() => { try { return JSON.parse(body) } catch { return {} } })()
  const req = JSON.parse(r.request().postData() ?? '{}')
  const results = (req.messages?.at(-1)?.content ?? []).filter((c) => c.toolResult).map((c) => JSON.stringify(c.toolResult.content[0].json).length)
  log.push({ status: r.status(), step: req.ticket ? (req.messages.length + 1) / 2 : 1, bytes: (r.request().postData() ?? '').length, maxResult: Math.max(0, ...results), error: j.error, tools: (j.message?.content ?? j.content ?? []).filter?.((c) => c.toolUse).map((c) => c.toolUse.name) })
  console.log(JSON.stringify(log.at(-1)))
})

await page.goto('https://altrobe.com/?prompt=preview', { waitUntil: 'networkidle', timeout: 120_000 })
const box = page.locator('textarea:visible').first()
await box.waitFor({ timeout: 60_000 })
for (const p of prompts) {
  console.log(`--- ${p}`)
  await box.waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('textarea:disabled'), null, { timeout: 180_000 })
  await box.fill(p)
  await box.press('Enter')
  last = Date.now()
  // Done when no /api/prompt response has arrived for 25 seconds and the box is enabled again.
  while (Date.now() - last < 25_000 || await page.locator('textarea:disabled').count()) {
    if (Date.now() - last > 180_000) { console.log('timeout'); break }
    await page.waitForTimeout(1000)
  }
  const lines = await page.locator('ol li, [aria-live] li').allTextContents()
  console.log('lines:', JSON.stringify(lines.slice(-3)))
}
await page.screenshot({ path: new URL('./live-prompts.png', import.meta.url).pathname })
await browser.close()
