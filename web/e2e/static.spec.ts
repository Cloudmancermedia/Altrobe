import { call, expect, openApp, settled, test, type Hooks } from './fixtures'

// The hosted site, reading a baked bundle (playwright.static.config.ts). Every request must succeed:
// a 404 here is a file the bake did not write or a URL the static backend built wrong.
test.skip(process.env.ALTROBE_STATIC_BUNDLE !== '1', 'no baked bundle: run `bake` or set ALTROBE_BUNDLE_DIR')

const THUNDERFURY = 19019

test('loads a character, equips an item and a set, with no install picker or prompt box', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('[data-cell="main"] .cell-label')).not.toBeEmpty()
  await expect(page.getByRole('heading', { name: 'Choose a game install' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ask' })).toHaveCount(0)

  const panel = page.getByRole('region', { name: 'Find' })
  await panel.getByRole('radio', { name: 'items' }).click()
  await panel.getByRole('searchbox').fill(String(THUNDERFURY))
  const result = panel.locator('.results li button').first()
  await expect(result).toContainText('Thunderfury')
  await result.click()
  await settled(page, 1, (h: Hooks, id: number) => h.attached(0).some((a) => a.itemId === id), THUNDERFURY)

  await panel.getByRole('radio', { name: 'sets' }).click()
  await page.getByLabel('Search sets').fill('warlord')
  const set = page.locator('.results li button').first()
  await expect(set).toContainText('Warlord')
  await set.click()
  // A filled character-screen slot shows its item's name and buttons.
  await expect(page.locator('.doll .doll-actions')).toHaveCount(7)
  await settled(page, 1)
  expect(await call(page, (h) => h.attached(0).length)).toBeGreaterThan(0)
})

test('the Find panel opens on Sets, the first tab', async ({ page }) => {
  await openApp(page)
  const tabs = page.getByRole('region', { name: 'Find' }).getByRole('radiogroup', { name: 'Find' }).getByRole('radio')
  await expect(tabs).toHaveText(['sets', 'weapons', 'items'])
  await expect(tabs.first()).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Search sets')).toBeVisible()
})

test('the Weapons tab shows each class its own weapons, and a click equips one', async ({ page }) => {
  await openApp(page)
  const panel = page.getByRole('region', { name: 'Find' })
  await panel.getByRole('radio', { name: 'weapons' }).click()
  const classSelect = panel.locator('.search-controls').getByLabel('Class')
  const groups = panel.locator('h3.result-group')
  const names = panel.locator('.results .qname')

  // No class picked: one "Popular" list.
  await classSelect.selectOption({ label: 'All classes' })
  await expect(groups).toHaveText(['Popular'])

  await call(page, (h) => h.commands.set_character(4, 0))
  await classSelect.selectOption({ label: 'Druid' })
  await expect(groups).toHaveText(['Two-hand', 'One-hand'])
  await expect(names.filter({ hasText: 'Staff of Dominance' })).toHaveCount(1)
  await expect(names.filter({ hasText: 'Arcanite Reaper' })).toHaveCount(0)

  await call(page, (h) => h.commands.set_character(1, 0))
  await classSelect.selectOption({ label: 'Warrior' })
  await expect(names.filter({ hasText: 'Arcanite Reaper' })).toHaveCount(1)
  await expect(names.filter({ hasText: "Perdition's Blade" })).toHaveCount(0)

  await call(page, (h) => h.commands.set_character(2, 0))
  await classSelect.selectOption({ label: 'Hunter' })
  await expect(groups).toHaveText(['Two-hand', 'One-hand', 'Ranged'])

  await panel.locator('.results li button.result', { hasText: "Rhok'delar" }).click()
  await settled(page, 1, (h: Hooks) => h.attached(0).some((a) => a.itemId === 18713))
})

test('names over heads and the logo use the bundled Quattrocento Bold, the closest free match to the game\'s font', async ({ page }) => {
  await openApp(page)
  await page.getByLabel('First name').fill('Thrall')
  const plate = page.locator('.nameplate')
  await expect(plate).toHaveText(/Thrall/)
  for (const el of [plate, page.getByRole('heading', { level: 1 })]) {
    const style = await el.evaluate((e) => ({ family: getComputedStyle(e).fontFamily, weight: getComputedStyle(e).fontWeight }))
    expect(style.family).toMatch(/^"?Quattrocento"?,/)
    expect(style.weight).toBe('700')
  }
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 16px Quattrocento') })).toBe(true)
})

test('the name over the head is clipped by its view, never drawn over the rest of the page', async ({ page }) => {
  await openApp(page)
  await page.getByLabel('First name').fill('Thrall')
  await expect(page.locator('.nameplate')).toHaveText(/Thrall/)
  const clip = await page.locator('.nameplate').evaluate((e) => getComputedStyle(e.closest('.stage-cell')!).overflow)
  expect(clip).toBe('hidden')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the page scrolls as one column: character first, then search, with the share buttons on screen', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('[data-cell="main"] .cell-label')).not.toBeEmpty()
    const box = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect()
      const panel = (s: string) => { const e = document.querySelector(s)!; return { scroll: e.scrollHeight, client: e.clientHeight } }
      const buttons = [...document.querySelectorAll('.share button')].map((b) => b.getBoundingClientRect().right)
      return {
        pageWidth: document.documentElement.scrollWidth,
        doll: rect('.doll').top, find: rect('.side.right').top, character: rect('.side.left').top,
        left: panel('.side.left'), right: panel('.side.right'), buttonsRight: Math.max(...buttons),
      }
    })
    expect(box.pageWidth, 'no sideways scrolling').toBeLessThanOrEqual(390)
    expect(box.buttonsRight, 'share buttons fit').toBeLessThanOrEqual(390)
    expect(box.left.scroll, 'Character panel shows in full').toBeLessThanOrEqual(box.left.client + 1)
    expect(box.right.scroll, 'Find panel shows in full').toBeLessThanOrEqual(box.right.client + 1)
    expect(box.doll).toBeLessThan(box.find)
    expect(box.find).toBeLessThan(box.character)
  })
})

test('a Human Mage sees new-in-Forever sets after the classic groups, and one dresses the character', async ({ page }) => {
  await openApp(page)
  await call(page, (h) => h.commands.set_character(1, 0))
  await settled(page, 1)
  await page.getByRole('region', { name: 'Find' }).getByRole('radio', { name: 'sets' }).click()
  await page.locator('.search-controls').getByLabel('Class').selectOption({ label: 'Mage' })

  const headings = page.locator('h3.result-group')
  await expect(headings.filter({ hasText: 'New in Forever' })).toHaveCount(1)
  const names = await headings.allTextContents()
  expect(names.indexOf('New in Forever')).toBe(names.indexOf('Tier 3') + 1)

  const before = await call(page, (h) => JSON.stringify(h.commands.get_look()))
  const first = page.locator('h3.result-group:text-is("New in Forever") + ul.results li button').first()
  await expect(first).toContainText(/cloth|no armor/)
  await first.click()
  await settled(page, 1, (h: Hooks, look: string) => JSON.stringify(h.commands.get_look()) !== look, before)
})
