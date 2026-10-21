import { describe, expect, test } from 'vitest'
import type { BundleItem, BundleSet } from '../api/search'
import type { CharactersResponse } from '../api/types'
import { createCommands } from '../commands'
import { createStore, initialState } from '../store'
import { createHostedTools } from './hosted-tools'
import specs from '../../../infra/lambda/prompt/instructions.ts?raw'

const item = (itemId: number, name: string, slot: string, extra: Partial<BundleItem> = {}): BundleItem =>
  ({ itemId, name, slot, quality: 3, iconFileDataId: 0, internal: false, unnamed: false, requiredLevel: 60, itemLevel: 66, armor: 'plate', allowableClass: -1, ...extra })

const catalog: BundleItem[] = [
  item(1, 'Judgement Crown', 'head'),
  item(2, 'Judgement Breastplate', 'chest'),
  item(3, 'Wrath Helm', 'head'),
  item(4, 'Wrath Legs', 'legs'),
  item(5, 'Worn Cloak', 'back', { requiredLevel: 10, armor: 'cloth', quality: 2 }),
  item(6, 'Dev Hat', 'head', { internal: true }),
  item(7, 'Mail Coif', 'head', { requiredLevel: 20, itemLevel: 25, armor: 'mail', quality: 2 }),
  item(8, 'Hand Axe', 'mainhand', { requiredLevel: 18, armor: null, weapon: 'axe', hands: 'one-hand', quality: 2 }),
  item(246100, 'Whispering Cowl', 'head', { requiredLevel: 40, armor: 'leather', newInForever: true }),
]
const byId = new Map(catalog.map((i) => [i.itemId, i]))
const set = (setId: number, name: string, ids: number[]): BundleSet =>
  ({ setId, name, internal: false, pieces: ids.map((id) => ({ slot: byId.get(id)!.slot, item: byId.get(id)! })), skipped: [{ itemId: 99, reason: 'not worn' }] })
const sets: BundleSet[] = [set(217, 'Judgement Armor', [1, 2]), set(218, 'Battlegear of Wrath', [3, 4])]

const characters: CharactersResponse = {
  build: 'b1',
  races: [
    { race: 2, name: 'Orc', faction: 'horde', classes: [{ classId: 1, name: 'Warrior' }], sexes: [{ sex: 0, hd: true, sd: true }] },
    { race: 5, name: 'Undead', faction: 'horde', classes: [{ classId: 5, name: 'Priest' }], sexes: [{ sex: 1, hd: true, sd: false }] },
  ],
}

const titles = [
  { titleId: 1284, male: 'High Warlord %s', female: 'High Warlord %s', faction: 'horde' as const },
  { titleId: 1270, male: 'Grand Marshal %s', female: 'Grand Marshal %s', faction: 'alliance' as const },
  { titleId: 1352, male: '%s the Harbinger of Darkness', female: '%s the Harbinger of Darkness' },
]

function setup() {
  const store = createStore(initialState())
  const command = { n: 1 }
  store.set({ characters, animations: [{ id: 0, name: 'Stand' }, { id: 5, name: 'Run' }], options: [
    { optionId: 10, name: 'Hair Style', defaultChoiceId: 100, choices: [{ choiceId: 100, name: 'Bald' }, { choiceId: 101, name: 'Mohawk' }] },
    { optionId: 11, name: 'Hair Color', defaultChoiceId: 110, choices: [{ choiceId: 110, name: '', swatch: '#1a1a1a' }, { choiceId: 111, name: '', swatch: '#b22222' }] },
    { optionId: 12, name: 'Tusks', defaultChoiceId: 120, choices: [{ choiceId: 120, name: 'None' }, { choiceId: 121, name: 'Long' }] },
  ] as never })
  store.set({ look: { ...store.get().look, race: 2, sex: 0 } })
  const cmd = createCommands({ store, searchItems: async () => [], appUrl: () => 'http://app.test/', titles: async () => titles })
  const runTool = createHostedTools({
    cmd, store,
    catalog: async () => catalog,
    sets: async () => sets,
    setPieces: async () => [1, 2, 3, 4],
    knownNames: async () => new Set(['thrall', 'bloodfist']),
    titles: async () => titles,
  })
  const run = (name: string, input: Record<string, unknown>) => runTool(name, input, command.n)
  return { store, run, command }
}

describe('hosted tools', () => {
  test('search_items filters like the local tool and leaves out developer items', async () => {
    const { run } = setup()
    const r = await run('search_items', { slot: 'head', armor: 'plate' })
    expect(r.status).toBe('success')
    expect((r.json.items as { itemId: number }[]).map((i) => i.itemId)).toEqual([1, 3])
    const lvl = await run('search_items', { min_level: 15, max_level: 25, limit: 1 })
    expect(lvl.json).toMatchObject({ total: 2, items: [{ itemId: 7, name: 'Mail Coif', requiredLevel: 20, armor: 'mail' }] })
    expect((await run('search_items', { weapon: 'axe', hands: 'one-hand' })).json).toMatchObject({ total: 1, items: [{ itemId: 8 }] })
  })

  test('search_items keeps only items new in Forever when asked, and marks them', async () => {
    const { run } = setup()
    expect((await run('search_items', { new_in_forever: true })).json).toMatchObject({ total: 1, items: [{ itemId: 246100, newInForever: true }] })
    expect((await run('search_items', { query: 'judgement' })).json).toMatchObject({ items: [{ newInForever: false }, { newInForever: false }] })
  })

  test('search_items refuses an unknown armor type, weapon type or hands', async () => {
    const { run } = setup()
    expect(await run('search_items', { armor: 'scale' })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('scale') } })
    expect((await run('search_items', { weapon: 'laser' })).status).toBe('error')
    expect((await run('search_items', { hands: 'three-hand' })).status).toBe('error')
  })

  test('search_sets lists pieces by slot', async () => {
    const { run } = setup()
    const r = await run('search_sets', { query: 'judgement' })
    expect(r.json).toEqual({ total: 1, sets: [{ setId: 217, name: 'Judgement Armor', internal: false, pieces: [{ slot: 'head', itemId: 1, name: 'Judgement Crown' }, { slot: 'chest', itemId: 2, name: 'Judgement Breastplate' }] }] })
  })

  test('equip_set replaces the set worn before, keeps loose items, and can keep the old pieces', async () => {
    const { run, store } = setup()
    await run('search_sets', {})
    await run('equip_item', { slot: 'back', itemId: 5 })
    await run('equip_set', { setId: 218 })
    expect(store.get().look.items).toEqual({ back: 5, head: 3, legs: 4 })
    const r = await run('equip_set', { setId: 217 })
    expect(r.status).toBe('success')
    expect(r.json).toMatchObject({ set: 'Judgement Armor', skipped: [{ itemId: 99, reason: 'not worn' }] })
    // The Wrath legs go: Judgement has no legs. The cloak stays.
    expect(store.get().look.items).toEqual({ back: 5, head: 1, chest: 2 })
    await run('equip_set', { setId: 218, replace: false })
    expect(store.get().look.items).toEqual({ back: 5, head: 3, chest: 2, legs: 4 })
  })

  test('equip_set with an unknown set is an error', async () => {
    const { run } = setup()
    expect(await run('equip_set', { setId: 1 })).toMatchObject({ status: 'error' })
  })

  test('build_outfit equips the outfit and says what it could not fill', async () => {
    const { run, store } = setup()
    const r = await run('build_outfit', { level: 22, armor: 'mail', weapons: ['axe'] })
    expect(r.status).toBe('success')
    expect(r.json).toMatchObject({ level: 22, items: { head: { itemId: 7 }, mainhand: { itemId: 8 } } })
    expect(r.json.missing).toContain('chest')
    expect(store.get().look.items).toEqual({ head: 7, mainhand: 8 })
  })

  test("build_outfit takes a class and dresses it in the armor that class wears at that level, whatever armor is passed", async () => {
    // "an undead and orc warlock in level 30 greens and blues" put leather on warlocks (live, 2026-10-21).
    const { run } = setup()
    const warrior = await run('build_outfit', { level: 22, class: 'Warrior' })
    expect(warrior.json).toMatchObject({ armor: 'mail', items: { head: { itemId: 7, armor: 'mail' } } })
    const priest = await run('build_outfit', { level: 22, class: 'priest', armor: 'leather' })
    expect(priest.json.armor).toBe('cloth')
    expect(Object.values(priest.json.items as Record<string, { armor: string | null }>).every((i) => i.armor === null || i.armor === 'cloth')).toBe(true)
    expect(await run('build_outfit', { level: 22, class: 'Bard' })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('Warlock') } })
  })

  test('build_outfit keeps an item equipped by name earlier in the same command', async () => {
    // "my undead and orc warrior in the green iron helm" could end in a leather helm: an outfit built after
    // the helm was equipped dressed the head too (2026-10-21).
    const { run, store, command } = setup()
    await run('equip_item', { slot: 'head', itemId: 3 })
    const r = await run('build_outfit', { level: 22, class: 'Warrior' })
    expect(store.get().look.items.head).toBe(3)
    expect(r.json).toMatchObject({ kept: ['head'] })
    command.n = 2
    await run('build_outfit', { level: 22, class: 'Warrior' })
    expect(store.get().look.items.head).toBe(7)
  })

  test("search_items finds a name the user words a little differently: 'helmet' for Helm", async () => {
    // "Give them both the green iron helmet" searched "green iron helmet", found nothing (the item is
    // Green Iron Helm), then "helmet", and put on Adventurer's Pith Helmet (live, 2026-10-21).
    const { run } = setup()
    const r = await run('search_items', { query: 'wrath helmet', slot: 'head' })
    expect(r.json).toMatchObject({ total: 1, items: [{ itemId: 3, name: 'Wrath Helm' }], note: expect.stringMatching(/close/) })
    // An exact match stays exact, with no note.
    expect((await run('search_items', { query: 'wrath helm' })).json).toEqual(expect.not.objectContaining({ note: expect.anything() }))
  })

  test('search_items falls back to the name alone when its filters leave nothing, and says so', async () => {
    const { run } = setup()
    const r = await run('search_items', { query: 'wrath helm', slot: 'head', armor: 'leather' })
    expect(r.json).toMatchObject({ total: 1, items: [{ itemId: 3, name: 'Wrath Helm' }], note: expect.stringMatching(/filters/) })
    // Without a name to fall back on, an empty result stays empty.
    expect((await run('search_items', { slot: 'head', armor: 'cloth' })).json).toMatchObject({ total: 0, items: [] })
  })

  test('build_outfit with nothing to wear changes nothing', async () => {
    const { run, store } = setup()
    const r = await run('build_outfit', { level: 1 })
    expect(r.status).toBe('success')
    expect(r.json).toMatchObject({ items: {}, missing: expect.arrayContaining(['head', 'mainhand']) })
    expect(store.get().look.items).toEqual({})
  })

  test('list_characters names races, sexes and classes; list_animations wraps its list', async () => {
    const { run } = setup()
    const r = await run('list_characters', {})
    expect(r.json.result).toEqual([
      { race: 2, name: 'Orc', faction: 'horde', sexes: [{ sex: '0 (male)', hd: true, sd: true }], classes: ['Warrior'] },
      { race: 5, name: 'Undead', faction: 'horde', sexes: [{ sex: '1 (female)', hd: true, sd: false }], classes: ['Priest'] },
    ])
    expect((await run('list_animations', {})).json).toEqual({ animations: ['Stand', 'Run'] })
  })

  test('change commands go through the command API and answer with the look', async () => {
    const { run, store } = setup()
    expect((await run('set_character', { race: 5, sex: 1 })).status).toBe('success')
    expect(store.get().look.race).toBe(5)
    expect((await run('set_animation', { name: 'Run' })).json).toMatchObject({ animation: 'Run' })
    expect((await run('compare', { characters: [{ race: 2, sex: 0 }] })).status).toBe('success')
    expect((await run('get_look', {})).json).toMatchObject({ race: 5, compare: [{ character: expect.any(String) }] })
    expect((await run('equip_item', { slot: 'head', itemId: 1 })).json).toMatchObject({ items: { head: { itemId: 1 } } })
    expect((await run('unequip', { slot: 'head' })).json).toMatchObject({ items: {} })
  })

  test("compare dresses a character in a set by its ID, with its own items on top", async () => {
    const { run, store } = setup()
    await run('search_sets', { query: 'judgement' })
    await run('search_sets', { query: 'wrath' })
    expect((await run('compare', { characters: [{ race: 5, sex: 1, setId: 217 }, { race: 2, sex: 0, setId: 218, items: { head: 7 } }] })).status).toBe('success')
    expect(store.get().look.compare.map((c) => c.items)).toEqual([{ head: 1, chest: 2 }, { head: 7, legs: 4 }])
    expect(await run('compare', { characters: [{ race: 2, sex: 0, setId: 999 }] })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('search_sets') } })
  })

  test('suggest_names shows the pairs that pass the name check and sends back the ones that fail', async () => {
    const { run, store } = setup()
    const r = await run('suggest_names', { names: [
      { firstName: 'Korvash', lastName: 'Stormfist' },
      { firstName: 'varok', lastName: 'Gravelhide' },
      { firstName: 'Brakkar', lastName: '' },
    ] })
    expect(r.json).toEqual({ shown: 1, rejected: [
      { firstName: 'varok', lastName: 'Gravelhide', problems: ['first name: Start with a capital'] },
      { firstName: 'Brakkar', lastName: '', problems: ['last name: Both names are needed'] },
    ] })
    expect(store.get().nameIdeas).toEqual([{ firstName: 'Korvash', lastName: 'Stormfist' }])
    expect(store.get().look.identity?.firstName).toBeUndefined()
    expect((await run('suggest_names', { names: Array(9).fill({ firstName: 'Mira', lastName: 'Vale' }) })).status).toBe('error')
  })

  test("suggest_names sends back names the name lists already offer, so the AI's are new", async () => {
    const { run, store } = setup()
    const r = await run('suggest_names', { names: [{ firstName: 'Thrall', lastName: 'Stormfist' }, { firstName: 'Varok', lastName: 'bloodfist' }, { firstName: 'Varok', lastName: 'Ashmane' }] })
    expect(r.json).toEqual({ shown: 1, rejected: [
      { firstName: 'Thrall', lastName: 'Stormfist', problems: ['first name: already in the name lists; make up a new one'] },
      { firstName: 'Varok', lastName: 'bloodfist', problems: ['last name: Start with a capital', 'last name: already in the name lists; make up a new one'] },
    ] })
    expect(store.get().nameIdeas).toEqual([{ firstName: 'Varok', lastName: 'Ashmane' }])
  })

  test('a second suggest_names call in a command adds to the names shown; a new command starts over', async () => {
    const { run, store, command } = setup()
    const pairs = (list: string[][]) => list.map(([firstName, lastName]) => ({ firstName, lastName }))
    await run('suggest_names', { names: pairs([['Varok', 'Ashmane'], ['Thrall', 'Ashmane']]) })
    await run('suggest_names', { names: pairs([['Durga', 'Ironhide'], ['Varok', 'Ashmane'], ['Aldra', 'Vale'], ['Bresk', 'Morrow'], ['Cyndel', 'Fenwick'], ['Dorvan', 'Quill']]) })
    expect(store.get().nameIdeas.map((p) => p.firstName)).toEqual(['Varok', 'Durga', 'Aldra', 'Bresk', 'Cyndel'])
    command.n = 2
    await run('suggest_names', { names: pairs([['Eshka', 'Tarn'], ['Dorvan', 'Quill']]) })
    expect(store.get().nameIdeas.map((p) => p.firstName)).toEqual(['Eshka', 'Dorvan'])
  })

  test('suggest_names takes up to 8 names, so spares cover refusals, and shows the first 5 that pass', async () => {
    const { run, store } = setup()
    const lasts = ['Ashmane', 'Bellow', 'Cinder', 'Dunmore', 'Eskridge', 'Fallow', 'Gristle', 'Hollin']
    const names = ['Aarok', 'Thrall', 'Brokk', 'Cedrak', 'Dumak', 'Erkan', 'Furok', 'Gorvak'].map((f, i) => ({ firstName: f, lastName: lasts[i] }))
    expect((await run('suggest_names', { names })).json).toMatchObject({ shown: 5, rejected: [{ firstName: 'Thrall' }] })
    expect(store.get().nameIdeas.map((p) => p.firstName)).toEqual(['Aarok', 'Brokk', 'Cedrak', 'Dumak', 'Erkan'])
  })

  test('suggest_names refuses a pair that reuses a name already in the batch, and lets similar sounds through', async () => {
    const { run, store } = setup()
    const r = await run('suggest_names', { names: [
      { firstName: 'Zara', lastName: 'Ashmane' },
      { firstName: 'Kara', lastName: 'Stormcall' },
      { firstName: 'Zara', lastName: 'Duskwood' },
      { firstName: 'Velka', lastName: 'Ashgrove' },
      { firstName: 'Morna', lastName: 'Ironmane' },
      { firstName: 'Brekka', lastName: 'Thornwood' },
    ] })
    // Sound rules (Zara and Kara, Ashmane and Ironmane) cost Nova 17 to 30% more tokens and left more batches
    // short of five (benchmarked 2026-10-19), so only an exact repeat is refused.
    expect(store.get().nameIdeas.map((p) => `${p.firstName} ${p.lastName}`)).toEqual(['Zara Ashmane', 'Kara Stormcall', 'Velka Ashgrove', 'Morna Ironmane', 'Brekka Thornwood'])
    expect(r.json).toEqual({ shown: 5, rejected: [{ firstName: 'Zara', lastName: 'Duskwood', problems: ['first name: Zara is already suggested'] }] })
  })

  test('a resent pair that is already shown is no refusal, and shown counts every name showing', async () => {
    const { run, store } = setup()
    await run('suggest_names', { names: [{ firstName: 'Zorran', lastName: 'Frostdrum' }, { firstName: 'Thrall', lastName: 'Ashmane' }] })
    const r = await run('suggest_names', { names: [{ firstName: 'Zorran', lastName: 'Frostdrum' }, { firstName: 'Velkesh', lastName: 'Mirebloom' }] })
    expect(r.json).toEqual({ shown: 2, rejected: [] })
    expect(store.get().nameIdeas).toEqual([{ firstName: 'Zorran', lastName: 'Frostdrum' }, { firstName: 'Velkesh', lastName: 'Mirebloom' }])
  })

  test('a command gets three rounds of suggest_names; a fourth is refused, so a stuck model stops', async () => {
    const { run, command } = setup()
    expect((await run('suggest_names', { names: [{ firstName: 'Zorran', lastName: 'Frostdrum' }] })).status).toBe('success')
    expect((await run('suggest_names', { names: [{ firstName: 'Velkesh', lastName: 'Mirebloom' }] })).status).toBe('success')
    expect((await run('suggest_names', { names: [{ firstName: 'Brakkun', lastName: 'Tallowmere' }] })).status).toBe('success')
    expect(await run('suggest_names', { names: [{ firstName: 'Orvak', lastName: 'Saltmere' }] })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('reply') } })
    command.n = 2
    expect((await run('suggest_names', { names: [{ firstName: 'Orvak', lastName: 'Saltmere' }] })).status).toBe('success')
  })

  test('compare replaces the characters beside the main one and names the ones it removed; add keeps them', async () => {
    const { run, store } = setup()
    // An Orc in its own helmet: the main character is an Orc too, so one in the same outfit would be a copy.
    await run('compare', { characters: [{ race: 2, sex: 0, items: { head: 3 } }] })
    const added = await run('compare', { add: true, characters: [{ race: 5, sex: 1 }] })
    expect(store.get().look.compare.map((c) => c.race)).toEqual([2, 5])
    expect(added.json.removed).toBeUndefined()
    const replaced = await run('compare', { characters: [{ race: 5, sex: 1 }] })
    expect(store.get().look.compare.map((c) => c.race)).toEqual([5])
    expect(replaced.json).toMatchObject({ removed: ['Orc male'], note: expect.stringMatching(/add true/) })
  })

  test('set_character names the characters still beside the main one', async () => {
    const { run, command } = setup()
    expect((await run('set_character', { race: 5, sex: 1 })).json.besideIt).toBeUndefined()
    await run('compare', { characters: [{ race: 2, sex: 0 }] })
    command.n = 2
    expect((await run('set_character', { race: 2, sex: 0 })).json).toMatchObject({ besideIt: ['Orc male'], note: expect.stringMatching(/empty list/) })
  })

  test('equip_set and compare take only a set ID that search_sets returned in this command', async () => {
    const { run, store, command } = setup()
    expect(await run('equip_set', { setId: 217 })).toMatchObject({ status: 'error', json: { error: expect.stringMatching(/search_sets first/) } })
    expect(await run('compare', { characters: [{ race: 5, sex: 1, setId: 217 }] })).toMatchObject({ status: 'error', json: { error: expect.stringMatching(/search_sets first/) } })
    expect(store.get().look.items).toEqual({})
    await run('search_sets', { query: 'judgement' })
    expect((await run('equip_set', { setId: 217 })).status).toBe('success')
    command.n = 2
    expect((await run('equip_set', { setId: 217 })).status).toBe('error')
  })

  test('a second set_character in one command is refused, so the first race named stays the main character', async () => {
    // "an orc warrior and an undead warrior side by side" switched the main character to Orc, then to
    // Undead, then put both beside it: three characters (live, 2026-10-21).
    const { run, store, command } = setup()
    expect((await run('set_character', { race: 5, sex: 1 })).status).toBe('success')
    expect(await run('set_character', { race: 2, sex: 0 })).toMatchObject({ status: 'error', json: { error: expect.stringMatching(/compare/) } })
    expect(store.get().look.race).toBe(5)
    command.n = 2
    expect((await run('set_character', { race: 2, sex: 0 })).status).toBe('success')
  })

  test('compare leaves out a copy of the main character: same race, sex and outfit', async () => {
    const { run, store } = setup()
    await run('equip_item', { slot: 'head', itemId: 1 })
    const r = await run('compare', { characters: [{ race: 2, sex: 0, items: { head: 1 } }, { race: 5, sex: 1 }, { race: 2, sex: 0 }] })
    expect(store.get().look.compare.map((c) => c.race)).toEqual([5])
    expect(r.json).toMatchObject({ note: expect.stringMatching(/main character/) })
    // The same race in another outfit is a real comparison and stays.
    await run('compare', { characters: [{ race: 2, sex: 0, items: { head: 3 } }] })
    expect(store.get().look.compare.map((c) => c.race)).toEqual([2])
  })

  test('suggest_names refuses famous Warcraft names', async () => {
    const { run } = setup()
    const r = await run('suggest_names', { names: [{ firstName: 'Sylvanas', lastName: 'Duskmoor' }, { firstName: 'Brekka', lastName: 'Warsong' }] })
    expect(r.json).toMatchObject({ shown: 0, rejected: [
      { problems: ['first name: a famous Warcraft name; make up a new one'] },
      { problems: ['last name: a famous Warcraft name; make up a new one'] },
    ] })
  })

  test('runs every tool the prompt API offers (infra/lambda/prompt/instructions.ts)', async () => {
    const block = specs.slice(specs.indexOf('const SPECS'), specs.indexOf('export const TOOL_NAMES'))
    const names = [...block.matchAll(/^\s+\['([a-z_]+)', /gm)].map((m) => m[1])
    expect(names.length).toBeGreaterThanOrEqual(19)
    const { run } = setup()
    for (const name of names) expect((await run(name, {})).json.error ?? '', name).not.toMatch(/^Unknown tool/)
  })

  test('errors and tools outside the hosted list come back as errors', async () => {
    const { run } = setup()
    expect(await run('equip_item', { slot: 'nose', itemId: 1 })).toMatchObject({ status: 'error', json: { error: 'unknown slot "nose"' } })
    expect(await run('share_link', {})).toMatchObject({ status: 'error', json: { error: expect.stringContaining('share_link') } })
    expect(await run('toString', {})).toMatchObject({ status: 'error' })
  })

  test('list_customization names the options, then lists one option\'s choices', async () => {
    const { run } = setup()
    expect((await run('list_customization', {})).json).toEqual({ character: 'Orc male', options: [
      { optionId: 10, name: 'Hair Style', choices: 2 }, { optionId: 11, name: 'Hair Color', choices: 2 }, { optionId: 12, name: 'Tusks', choices: 2 },
    ] })
    expect((await run('list_customization', { option: 'tusk' })).json).toEqual({ character: 'Orc male', options: [
      { optionId: 12, name: 'Tusks', choices: [{ choiceId: 120, name: 'None' }, { choiceId: 121, name: 'Long' }] },
    ] })
    // Unnamed choices (colors) are numbered, as the panel shows them, with the color, so "red hair" can be picked.
    expect((await run('list_customization', { option: 'hair color' })).json).toEqual({ character: 'Orc male', options: [{ optionId: 11, name: 'Hair Color', choices: [{ choiceId: 110, name: '#1', color: '#1a1a1a' }, { choiceId: 111, name: '#2', color: '#b22222' }] }] })
  })

  test('set_customization also takes the option and choice by name, and says what to pick on a miss', async () => {
    const { run, store } = setup()
    expect((await run('set_customization', { option: 'tusks', choice: 'long' })).status).toBe('success')
    expect(store.get().look.custom).toMatchObject({ 12: 121 })
    expect((await run('set_customization', { option: 'hair style', choice: 'Mohawk' })).status).toBe('success')
    expect(store.get().look.custom).toMatchObject({ 10: 101 })
    expect(await run('set_customization', { option: 'hair', choice: 'Mohawk' })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('Hair Style, Hair Color') } })
    expect(await run('set_customization', { option: 'tusks', choice: 'short' })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('None, Long') } })
    expect(await run('set_customization', { option: 'hair color', choice: 'red' })).toMatchObject({ status: 'error', json: { error: expect.stringContaining('list_customization') } })
  })

  test('set_customization picks a choice; randomize and reset work on every option', async () => {
    const { run, store } = setup()
    expect((await run('set_customization', { optionId: 12, choiceId: 121 })).status).toBe('success')
    expect(store.get().look.custom['12']).toBe(121)
    expect((await run('reset_customization', {})).status).toBe('success')
    expect(store.get().look.custom['12']).toBeUndefined()
    expect((await run('randomize_customization', {})).status).toBe('success')
  })

  test('set_identity takes a title by its wording and a class by name, for the character\'s faction', async () => {
    const { run, store } = setup()
    const r = await run('set_identity', { firstName: 'Aldric', lastName: 'Ashborne', title: 'High Warlord', guild: 'Ashen Vanguard', level: 60, class: 'warrior' })
    expect(r.status).toBe('success')
    expect(store.get().look.identity).toEqual({ firstName: 'Aldric', lastName: 'Ashborne', titleId: 1284, guild: 'Ashen Vanguard', level: 60, classId: 1 })
    expect((await run('set_identity', { title: 'the Harbinger of Darkness' })).status).toBe('success')
    expect(store.get().look.identity?.titleId).toBe(1352)
    // An Orc can't hold an Alliance rank; the error names titles that would work.
    const wrong = await run('set_identity', { title: 'Grand Marshal' })
    expect(wrong).toMatchObject({ status: 'error', json: { error: expect.stringContaining('High Warlord') } })
    expect((await run('set_identity', { title: '' })).status).toBe('success')
    expect(store.get().look.identity?.titleId).toBeUndefined()
  })

  test('set_view turns the camera; get_look says who the character is', async () => {
    const { run, store } = setup()
    expect((await run('set_view', { view: 'back' })).status).toBe('success')
    expect(store.get().look.cam.view).toBe('back')
    await run('set_identity', { firstName: 'Aldric', title: 'High Warlord' })
    expect((await run('get_look', {})).json).toMatchObject({ identity: { firstName: 'Aldric', title: 'High Warlord Aldric' } })
  })
})
