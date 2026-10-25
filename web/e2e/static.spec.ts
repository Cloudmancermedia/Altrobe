import { appUrl, call, expect, openApp, settled, test, type Hooks } from './fixtures'
import { launchBanner } from '../src/identity/name-rules'

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

  // No class picked: every class the race can be, merged into the same groups.
  const view = panel.getByRole('radiogroup', { name: 'Weapons from' })
  await classSelect.selectOption({ label: 'All classes' })
  await expect(view.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true')
  await expect(groups.first()).toHaveText('Two-hand')
  await expect(groups).not.toContainText(['Popular'])
  await view.getByRole('radio', { name: 'New in Forever' }).click()
  await expect(groups).toHaveText(['New in Forever'])
  await view.getByRole('radio', { name: 'Classic' }).click()

  await call(page, (h) => h.commands.set_character(4, 0))
  await classSelect.selectOption({ label: 'Druid' })
  await expect(groups).toHaveText(['Two-hand', 'One-hand', 'Off hand'])
  await expect(names.filter({ hasText: 'Staff of Dominance' })).toHaveCount(1)
  await expect(names.filter({ hasText: 'Arcanite Reaper' })).toHaveCount(0)
  // Forever lets druids use polearms.
  await view.getByRole('radio', { name: 'New in Forever' }).click()
  await expect(names.filter({ hasText: 'Bear Poking Stick' })).toHaveCount(1)
  await view.getByRole('radio', { name: 'Classic' }).click()

  await call(page, (h) => h.commands.set_character(1, 0))
  await classSelect.selectOption({ label: 'Warrior' })
  await expect(names.filter({ hasText: 'Arcanite Reaper' })).toHaveCount(1)
  await expect(names.filter({ hasText: "Perdition's Blade" })).toHaveCount(0)
  await expect(groups).toHaveText(['Two-hand', 'One-hand', 'Off hand', 'Ranged'])
  await expect(names.filter({ hasText: 'Drillborer Disk' })).toHaveCount(1)

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

test('a preview link (/l/<look>) opens its look, and the address goes back to /', async ({ page }) => {
  const look = { game: 'forever', models: 'hd', race: 5, sex: 1, v: 1, identity: { firstName: 'Morgwyn', level: 60 } }
  await openApp(page, `${appUrl()}l/${Buffer.from(JSON.stringify(look)).toString('base64url')}`)
  const opened = await call(page, (h) => { const l = h.store.get().look; return { race: l.race, sex: l.sex, name: l.identity?.firstName } })
  expect(opened).toEqual({ race: 5, sex: 1, name: 'Morgwyn' })
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/')
})

test('a banner gives the reservation and launch times until launch day ends, and stays dismissed', async ({ page }) => {
  await openApp(page)
  const banner = page.getByRole('region', { name: 'WoW Forever launch' })
  if (Date.now() >= Date.parse('2026-11-05T08:00:00Z')) { await expect(banner).toHaveCount(0); return }
  // The site's own text for today, so the wording can change without this falling behind (it did, 2026-10-21).
  await expect(banner).toContainText(launchBanner(new Date())!)
  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sheathe weapons' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'WoW Forever launch' })).toHaveCount(0)
})

test('the footer is two short centred lines, About and Support over the copyright, and About opens a dialog', async ({ page }) => {
  await openApp(page)
  const footer = page.locator('footer')
  await expect(footer.getByRole('link', { name: 'Support Altrobe' })).toHaveAttribute('href', 'https://buymeacoffee.com/cloudmancer')
  await expect(footer.getByRole('link')).toHaveCount(1)
  const box = (await footer.boundingBox())!, links = (await footer.getByRole('button', { name: 'About' }).boundingBox())!
  const note = (await footer.getByText(/not affiliated with Blizzard/).boundingBox())!
  expect(box.height, 'two lines').toBeLessThan(60)
  expect(links.y + links.height, 'links over the copyright').toBeLessThanOrEqual(note.y + 1)
  expect(Math.abs(note.x + note.width / 2 - (box.x + box.width / 2)), 'centred').toBeLessThan(4)

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await footer.getByRole('button', { name: 'About' }).click()
  const about = page.getByRole('dialog', { name: 'About Altrobe' })
  await expect(about).toBeVisible()
  await expect(about.getByRole('link', { name: 'Buy me a coffee' })).toBeVisible()
  await expect(about.getByRole('link', { name: 'Download the local app' })).toHaveCount(0)
  for (const name of ['Source code', 'Report a problem or rights concern', 'Licenses', 'Item names: cmangos'])
    await expect(about.getByRole('link', { name })).toBeVisible()
  await expect(about).toContainText('World of Warcraft is a trademark of Blizzard Entertainment')
  await page.keyboard.press('Escape')
  await expect(about).toBeHidden()
  await footer.getByRole('button', { name: 'About' }).click()
  await about.getByRole('button', { name: 'Close' }).click()
  await expect(about).toBeHidden()
})

test('typing a guild or name with spaces keeps them, as you type', async ({ page }) => {
  await openApp(page)
  await page.getByLabel('First name').pressSequentially('Thrall')
  const guild = page.getByLabel('Guild')
  await guild.pressSequentially('The Guild of Many Words')
  await expect(guild).toHaveValue('The Guild of Many Words')
  await expect(page.locator('.nameplate')).toContainText('<The Guild of Many Words>')
  // Spaces at the ends are left out of the look (and the share link), but not from the box while typing.
  await guild.press('Space')
  await expect(guild).toHaveValue('The Guild of Many Words ')
  expect(await call(page, (h) => (h.commands.get_look() as { identity?: { guild?: string } }).identity?.guild)).toBe('The Guild of Many Words')

  // A name set from elsewhere still replaces what the box holds.
  const first = page.getByLabel('First name')
  await page.getByRole('button', { name: 'Generate name' }).click()
  await expect(first).not.toHaveValue('Thrall')
  const generated = await call(page, (h) => (h.commands.get_look() as { identity?: { firstName?: string } }).identity?.firstName)
  await expect(first).toHaveValue(generated!)
})

test('sheathed weapons can go on the hip or the back, and a reload keeps the choice', async ({ page }) => {
  await openApp(page)
  await call(page, (h) => { h.commands.equip_item('mainhand', 18805) })
  await expect(page.getByRole('radiogroup', { name: 'Sheathe one-handers on' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sheathe weapons' }).click()
  const where = page.getByRole('radiogroup', { name: 'Sheathe one-handers on' })
  await expect(where.getByRole('radio', { name: 'Hip' })).toHaveAttribute('aria-checked', 'true')
  await where.getByRole('radio', { name: 'Back' }).click()
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('look=')
  await page.reload()
  await expect(page.getByRole('radiogroup', { name: 'Sheathe one-handers on' }).getByRole('radio', { name: 'Back' })).toHaveAttribute('aria-checked', 'true')
})

test('the Animation list reads in plain words, grouped, and picking one plays the game\'s animation', async ({ page }) => {
  await openApp(page)
  const anim = page.getByLabel('Animation', { exact: true })
  await expect(anim.locator('optgroup[label="Casting"] option', { hasText: /^Cast \(aimed\)$/ })).toHaveCount(1)
  await expect(anim.locator('optgroup[label="Stealth"] option')).toHaveText(['Stealth', 'Stealth (walk)'])
  await anim.selectOption({ label: 'Cast (aimed)' })
  expect(await call(page, (h) => (h.commands.get_look() as { anim?: string }).anim)).toBe('SpellCastDirected')
})

test('a quick animation button plays its animation, a reload keeps it, and a second press stands', async ({ page }) => {
  await openApp(page)
  const anim = () => call(page, (h) => (h.commands.get_look() as { anim?: string }).anim)
  const quick = page.getByRole('group', { name: 'Quick animations' })
  await expect(quick.getByRole('button')).toHaveText(['Stand', 'Cast (aimed)', 'Cast (around)', 'Run', 'Attack (one-hand)', 'Attack (two-hand)', 'Shoot (bow)'])
  // Stand shows pressed while nothing else plays.
  await expect(quick.getByRole('button', { pressed: true })).toHaveText(['Stand'])

  await quick.getByRole('button', { name: 'Run' }).click()
  expect(await anim()).toBe('Run')
  await expect(quick.getByRole('button', { name: 'Run' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Animation', { exact: true })).toHaveValue('Run')

  // The address bar is the share link, so a reload keeps the animation.
  await page.reload()
  await settled(page, 1)
  expect(await anim()).toBe('Run')
  await expect(quick.getByRole('button', { name: 'Run' })).toHaveAttribute('aria-pressed', 'true')

  await quick.getByRole('button', { name: 'Run' }).click()
  expect(await anim()).toBeUndefined()
  await expect(quick.getByRole('button', { pressed: true })).toHaveText(['Stand'])
})

test('the two-hand attack button swings a staff with the staff attack', async ({ page }) => {
  await openApp(page)
  await call(page, (h) => h.commands.set_character(4, 0))
  const panel = page.getByRole('region', { name: 'Find' })
  await panel.getByRole('radio', { name: 'weapons' }).click()
  await panel.locator('.search-controls').getByLabel('Class').selectOption({ label: 'Druid' })
  await panel.locator('.results li button.result', { hasText: 'Staff of Dominance' }).click()
  await settled(page, 1, (h: Hooks) => h.attached(0).length > 0)
  const quick = page.getByRole('group', { name: 'Quick animations' })
  await quick.getByRole('button', { name: 'Attack (polearm or staff)' }).click()
  expect(await call(page, (h) => (h.commands.get_look() as { anim?: string }).anim)).toBe('Attack2HL')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the page scrolls as one column: character first, then the panel tabs and Find, with the share buttons on screen', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('[data-cell="main"] .cell-label')).not.toBeEmpty()
    const box = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect()
      const panel = (s: string) => { const e = document.querySelector(s)!; return { scroll: e.scrollHeight, client: e.clientHeight } }
      const buttons = [...document.querySelectorAll('.share button')].map((b) => b.getBoundingClientRect().right)
      return {
        pageWidth: document.documentElement.scrollWidth,
        doll: rect('.doll').top, tabs: rect('.panel-tabs').top, find: rect('.side.right').top,
        right: panel('.side.right'), buttonsRight: Math.max(...buttons),
      }
    })
    expect(box.pageWidth, 'no sideways scrolling').toBeLessThanOrEqual(390)
    expect(box.buttonsRight, 'share buttons fit').toBeLessThanOrEqual(390)
    expect(box.right.scroll, 'Find panel shows in full').toBeLessThanOrEqual(box.right.client + 1)
    expect(box.doll).toBeLessThan(box.tabs)
    expect(box.tabs).toBeLessThan(box.find)
  })

  test('Find and Character are tabs under the character, one shown at a time, each keeping what you typed', async ({ page }) => {
    await openApp(page)
    const tabs = page.getByRole('radiogroup', { name: 'Panels' }).getByRole('radio')
    await expect(tabs).toHaveText(['Find', 'Character'])
    await expect(tabs.first()).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('complementary', { name: 'Find' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Character' })).toBeHidden()

    await page.getByLabel('Search sets').fill('warlord')
    await tabs.nth(1).click()
    await expect(page.getByRole('complementary', { name: 'Character' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Find' })).toBeHidden()
    await page.fill('#id-first', 'Thrall')

    await tabs.first().click()
    await expect(page.getByLabel('Search sets')).toHaveValue('warlord')
    await tabs.nth(1).click()
    await expect(page.locator('#id-first')).toHaveValue('Thrall')
  })
})

test.describe('on a small phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true })

  test('the quick animation buttons wrap to fit the screen', async ({ page }) => {
    await openApp(page)
    await page.getByRole('radiogroup', { name: 'Panels' }).getByRole('radio', { name: 'Character' }).click()
    const buttons = page.getByRole('group', { name: 'Quick animations' }).getByRole('button')
    await expect(buttons).toHaveCount(7)
    const right = await buttons.evaluateAll((list) => Math.max(...list.map((b) => b.getBoundingClientRect().right)))
    expect(right, 'every button on screen').toBeLessThanOrEqual(360)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scrolling').toBeLessThanOrEqual(360)
  })
})

test('on a wide screen both side panels show and the panel tabs do not', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('complementary', { name: 'Find' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Character' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Panels' })).toBeHidden()
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

test('a side-by-side character picked on screen gets its own set; the main one keeps its outfit', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Add character' }).click()
  await settled(page, 2)
  // A new character is the one the panels edit.
  await expect(page.locator('[data-cell="compare0"]')).toHaveClass(/selected/)
  await expect(page.getByRole('region', { name: 'Find' }).locator('.editing-note')).not.toContainText('(main)')

  await page.getByLabel('Search sets').fill('warlord')
  await page.locator('.results li button').first().click()
  await settled(page, 2, (h: Hooks) => h.attached(1).length > 0 && h.attached(0).length === 0)
  const own = page.getByRole('checkbox', { name: 'Wear the main outfit' })
  await expect(own).not.toBeChecked()

  // A click on the main character's view picks it; its slots are still empty.
  await page.locator('[data-cell="main"]').click()
  await expect(page.locator('[data-cell="main"]')).toHaveClass(/selected/)
  await expect(page.locator('.doll .doll-actions')).toHaveCount(0)
  // A drag turns the camera and picks no one.
  const box = (await page.locator('[data-cell="compare0"]').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('[data-cell="main"]')).toHaveClass(/selected/)

  // Back in the main outfit, the side-by-side character wears nothing again.
  await own.check()
  await settled(page, 2, (h: Hooks) => h.attached(1).length === 0)
})

test('a side-by-side character keeps its own name and animation through the share link', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Add character' }).click()
  await settled(page, 2)
  await page.locator('#id-first').fill('Velka')
  await page.locator('#id-guild').fill('Ashen Vanguard')
  await page.getByRole('group', { name: 'Quick animations' }).getByRole('button', { name: 'Run' }).click()
  const look = () => call(page, (h) => h.commands.get_look() as { anim?: string; identity?: unknown; compare: { anim?: string; identity?: { firstName?: string; guild?: string } }[] })
  let l = await look()
  expect([l.anim, l.identity, l.compare[0].anim, l.compare[0].identity]).toEqual([undefined, undefined, 'Run', { firstName: 'Velka', guild: 'Ashen Vanguard' }])
  await expect(page.getByRole('checkbox', { name: 'Play the main animation' })).not.toBeChecked()
  await expect(page.locator('[data-cell="compare0"] .nameplate')).toContainText('Velka')
  await expect(page.locator('[data-cell="main"] .nameplate')).toHaveCount(0)

  // The share link (a /l/ preview link on the site) opens both, in a new page.
  const link = await page.getByLabel('Share link').inputValue()
  await page.goto(link.replace(/^https?:\/\/[^/]+/, appUrl().replace(/\/$/, '')))
  await settled(page, 2)
  l = await look()
  expect([l.anim, l.compare[0].anim, l.compare[0].identity]).toEqual([undefined, 'Run', { firstName: 'Velka', guild: 'Ashen Vanguard' }])
  await expect(page.locator('[data-cell="compare0"] .nameplate')).toContainText('Velka')
})

test("Skyborne customization: no placeholder names, an empty tattoo color reads None, and a tattoo pattern shows in a color", async ({ page }) => {
  const look = { v: 1, game: 'forever', build: '', models: 'hd', race: 95, sex: 0 }
  await openApp(page, `${appUrl()}#look=${Buffer.from(JSON.stringify(look)).toString('base64url')}`)
  const hair = await page.getByLabel('Hair Color', { exact: true }).locator('option').allTextContents()
  expect(hair.some((t) => /New \d/.test(t))).toBe(false)
  const color = page.getByLabel('Body Tattoo Color', { exact: true })
  await expect(color.locator('option:checked')).toHaveText('None (default)')

  await page.getByLabel('Body Tattoo', { exact: true }).selectOption({ label: 'Zephyr' })
  await expect(color.locator('option:checked')).not.toHaveText('None (default)')
  const custom = await call(page, (h) => (h.commands.get_look() as { custom?: Record<string, number> }).custom ?? {})
  expect(Object.keys(custom)).toHaveLength(2)
})

test('the header links to the tutorial video under the tagline, in a new tab', async ({ page }) => {
  await openApp(page)
  const link = page.locator('.brand').getByRole('link', { name: 'Watch the tutorial' })
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=Ij51rZt48V8')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('a character in its own outfit sheathes on its own, and Clear weapons empties every outfit', async ({ page }) => {
  await openApp(page)
  const panel = page.getByRole('region', { name: 'Find' })
  await panel.getByRole('radio', { name: 'items' }).click()
  await panel.getByRole('searchbox').fill(String(THUNDERFURY))
  await panel.locator('.results li button').first().click()
  await page.getByRole('button', { name: 'Add character' }).click()
  await settled(page, 2)
  await page.getByRole('checkbox', { name: 'Wear the main outfit' }).uncheck()
  type Out = { sheathed?: boolean; items?: Record<string, number>; compare: { sheathe?: string; items?: Record<string, number> }[] }
  const look = () => call(page, (h) => h.commands.get_look() as Out)
  expect((await look()).compare[0].items?.mainhand).toBe(THUNDERFURY)

  await page.getByRole('button', { name: 'Sheathe weapons' }).click()
  let l = await look()
  expect([l.sheathed, l.compare[0].sheathe]).toEqual([undefined, 'hip'])
  // The main character still draws its weapons.
  await page.locator('[data-cell="main"]').click()
  await expect(page.getByRole('button', { name: 'Sheathe weapons' })).toBeVisible()

  await page.getByRole('button', { name: 'Clear weapons' }).click()
  l = await look()
  expect([l.items?.mainhand, l.compare[0].items?.mainhand]).toEqual([undefined, undefined])

  // Its own animation unbinds it too: a new character, back in the main outfit but on its own animation.
  await page.getByRole('button', { name: 'Add character' }).click()
  await settled(page, 3)
  await page.getByRole('checkbox', { name: 'Play the main animation' }).nth(1).uncheck()
  await page.getByRole('button', { name: 'Sheathe weapons' }).click()
  l = await look()
  expect([l.sheathed, l.compare[1].sheathe, l.compare[1].items]).toEqual([undefined, 'hip', undefined])
})

test('Auto-rotate turns a character slowly and back to the front when stopped; one on its own animation turns on its own', async ({ page }) => {
  await openApp(page)
  const toggle = page.getByRole('button', { name: 'Auto-rotate' })
  const angle = (i: number) => call(page, (h, n: number) => h.cameraAngle(n), i)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  const front = await angle(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(1500)
  // Slow: a full turn takes 30 seconds, so 1.5 seconds turn it about 18 degrees.
  const turned = Math.abs(await angle(0) - front)
  expect(turned).toBeGreaterThan(5)
  expect(turned).toBeLessThan(45)

  // Off, it goes back to the front, wherever the turn had got to, and stays.
  await toggle.click()
  await expect.poll(() => angle(0)).toBeCloseTo(front, 1)
  await page.waitForTimeout(500)
  expect(await angle(0)).toBeCloseTo(front, 1)

  // A side-by-side character in the main outfit and animation turns with the main one; on its own
  // animation, it turns on its own.
  await page.getByRole('button', { name: 'Add character' }).click()
  await settled(page, 2)
  await page.getByRole('checkbox', { name: 'Play the main animation' }).uncheck()
  await toggle.click()
  await page.waitForTimeout(1000)
  expect(Math.abs(await angle(1) - front)).toBeGreaterThan(3)
  expect(await angle(0)).toBeCloseTo(front, 1)

  // Share links leave it out: a reload, which opens the address bar's link, faces front.
  await page.reload()
  await settled(page, 2)
  await page.waitForTimeout(500)
  expect(await angle(1)).toBeCloseTo(front, 1)
})

test('Copy shortlist puts the shortlist on the clipboard, numbered, first choice first', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openApp(page)
  for (const [first, last] of [['Velka', 'Mirebloom'], ['Zorak', 'Darksoul']]) {
    await page.locator('#id-first').fill(first)
    await page.locator('#id-last').fill(last)
    await page.getByRole('button', { name: 'Add to shortlist' }).click()
  }
  await page.getByRole('button', { name: 'Copy shortlist' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  // The newest addition goes to the top of the shortlist.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1. Zorak Darksoul\n2. Velka Mirebloom')
})

test('on a desktop window the page never scrolls, and the side panels never scroll sideways', async ({ page }) => {
  // The AI label's hidden text sat outside the left panel, so the page grew below it (2026-10-24), and the
  // Off hand link pushed weapon rows past the right panel's edge.
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page)
  await page.getByRole('region', { name: 'Find' }).getByRole('radio', { name: 'weapons' }).click()
  await expect(page.locator('.results .qname').first()).toBeVisible()
  // This build has no prompt box, so put a hidden label like its AI one at the foot of a left panel taller
  // than the window, as the live one is.
  await page.evaluate(() => {
    const section = document.createElement('section')
    section.style.paddingTop = '1500px'
    const s = document.createElement('span')
    s.className = 'visually-hidden'
    s.textContent = 'Uses the daily AI allowance'
    section.append(s)
    document.querySelector('aside.side.left')!.append(section)
  })
  const size = () => page.evaluate(() => {
    const doc = document.documentElement
    const sides = [...document.querySelectorAll('aside.side')].map((a) => a.scrollWidth - a.clientWidth)
    return { page: [doc.scrollWidth - innerWidth, doc.scrollHeight - innerHeight], sides }
  })
  expect(await size()).toEqual({ page: [0, 0], sides: [0, 0] })
})

test('the views have no separator lines, and the selection outline fades after a moment', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Add character' }).click()
  await page.getByRole('button', { name: 'Add character' }).click()
  await settled(page, 3)
  // A finished fade can leave a transparent shadow rather than none; both draw nothing.
  const shadows = () => page.locator('.stage-cell').evaluateAll((cells) => cells.map((c) => {
    const s = getComputedStyle(c).boxShadow
    return s.startsWith('rgba(0, 0, 0, 0)') ? 'none' : s
  }))
  await page.locator('[data-cell="compare0"]').click()
  // Picked: the outline shows at once, then fades, so screenshots come out clean.
  expect((await shadows())[1]).not.toBe('none')
  await expect.poll(shadows, { timeout: 5000 }).toEqual(['none', 'none', 'none'])
  await expect(page.locator('[data-cell="compare0"]')).toHaveClass(/selected/)
})
