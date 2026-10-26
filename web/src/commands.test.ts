import { describe, expect, test } from 'vitest'
import type { CharactersResponse, CustomizationOption, ItemSearchResult } from './api/types'
import { characterLook, createCommands, replacedSetSlots, setPieceSlots, transitions } from './commands'
import { canonicalLook, decodeLook, emptyLook } from './look/look'
import { createStore, initialState } from './store'

const characters: CharactersResponse = {
  build: 'b1',
  races: [
    { race: 2, name: 'Orc', classes: [], sexes: [{ sex: 0, hd: true, sd: true }, { sex: 1, hd: true, sd: false }] },
    { race: 5, name: 'Undead', classes: [], sexes: [{ sex: 1, hd: true, sd: true }] },
  ],
}

describe('transitions', () => {
  const bare = emptyLook(2, 0)

  test('equip and unequip by slot name; unequip also clears a hidden flag', () => {
    const a = transitions.equipItem(bare, 'head', 12).look!
    expect(a.items).toEqual({ head: 12 })
    const hidden = transitions.setVisibility(a, 'head', false).look!
    expect(hidden.hide).toEqual(['head'])
    const b = transitions.unequip(hidden, 'head').look!
    expect(b.items).toEqual({})
    expect(b.hide).toEqual([])
    expect(bare.items, 'input is not mutated').toEqual({})
  })

  test('unequip_slots empties several slots and their hidden flags; unknown slots are refused', () => {
    const worn = { ...bare, items: { head: 1, chest: 2, mainhand: 3, offhand: 4 }, hide: ['head' as const, 'mainhand' as const] }
    const r = transitions.unequipSlots(worn, ['mainhand', 'offhand']).look!
    expect(r.items).toEqual({ head: 1, chest: 2 })
    expect(r.hide).toEqual(['head'])
    expect(transitions.unequipSlots(worn, ['wings']).error).toMatch(/unknown slot "wings"/)
  })

  test('clear_all takes everything off, stops the animation and removes the side-by-side characters, keeping the character', () => {
    const dressed = { ...bare, items: { head: 1, mainhand: 3 }, hide: ['head' as const], anim: 'Run', custom: { '7': 70 }, compare: [{ race: 5, sex: 1 as const, models: 'hd' as const }] }
    const r = transitions.clearAll(dressed).look!
    expect(r.items).toEqual({})
    expect(r.hide).toEqual([])
    expect(r.anim).toBeUndefined()
    expect(r.compare).toEqual([])
    expect([r.race, r.sex, r.custom]).toEqual([2, 0, { '7': 70 }])
  })

  test('set_identity merges fields, clears empty ones, and refuses bad values', () => {
    const a = transitions.setIdentity(bare, { firstName: 'Asher', lastName: 'Meier', level: 29 }).look!
    expect(a.identity).toEqual({ firstName: 'Asher', lastName: 'Meier', level: 29 })
    const b = transitions.setIdentity(a, { guild: 'Slain', lastName: '' }).look!
    expect(b.identity).toEqual({ firstName: 'Asher', level: 29, guild: 'Slain' })
    expect(transitions.setIdentity(b, { level: 70 }).error).toMatch(/level 70/)
    expect(transitions.setIdentity(b, { firstName: '', level: null, guild: '' }).look!.identity).toBeUndefined()
  })

  test('a character holds one kind of weapon: a ranged weapon takes off both hands, a hand weapon takes off the ranged one', () => {
    const melee = transitions.equipItems(bare, [{ slot: 'mainhand', itemId: 1 }, { slot: 'offhand', itemId: 2 }]).look!
    const ranged = transitions.equipItem(melee, 'ranged', 3).look!
    expect(ranged.items).toEqual({ ranged: 3 })
    expect(transitions.equipItem(ranged, 'offhand', 4).look!.items).toEqual({ offhand: 4 })
  })

  test('set_sheathe_on_back chooses the back or the hip for hip weapons', () => {
    expect(transitions.setSheatheOnBack(bare, true).look!.sheatheOnBack).toBe(true)
    expect(transitions.setSheatheOnBack({ ...bare, sheatheOnBack: true }, false).look!.sheatheOnBack).toBeUndefined()
  })

  test('set_sheathed puts weapons away and takes them out', () => {
    expect(transitions.setSheathed(bare, true).look!.sheathed).toBe(true)
    expect(transitions.setSheathed({ ...bare, sheathed: true }, false).look!.sheathed).toBeUndefined()
  })

  test('equip_items can clear slots first, so a smaller set replaces a bigger one', () => {
    const worn = transitions.equipItems(bare, [{ slot: 'head', itemId: 10 }, { slot: 'hands', itemId: 11 }, { slot: 'back', itemId: 12 }]).look!
    const r = transitions.equipItems(worn, [{ slot: 'head', itemId: 20 }], ['hands']).look!
    expect(r.items).toEqual({ head: 20, back: 12 })
    expect(transitions.equipItems(worn, [{ slot: 'head', itemId: 20 }], ['ring']).error).toMatch(/unknown slot "ring"/)
  })

  test('replacedSetSlots picks worn set pieces the new set does not cover', () => {
    // 10 and 11 are pieces of some set, 12 (a cloak) is not; the new set fills head only.
    const items = { head: 10, hands: 11, back: 12 }
    expect(replacedSetSlots(items, [{ slot: 'head', itemId: 20 }], new Set([10, 11, 20]))).toEqual(['hands'])
    expect(replacedSetSlots(items, [{ slot: 'head', itemId: 20 }], new Set())).toEqual([])
  })

  test('equip_items puts several items on in one change and keeps other slots', () => {
    const start = transitions.equipItem(bare, 'feet', 7).look!
    const r = transitions.equipItems(start, [{ slot: 'chest', itemId: 1 }, { slot: 'mainhand', itemId: 2 }]).look!
    expect(r.items).toEqual({ feet: 7, chest: 1, mainhand: 2 })
    expect(transitions.equipItems(bare, [{ slot: 'ring', itemId: 1 }]).error).toMatch(/unknown slot "ring"/)
    expect(transitions.equipItems(bare, []).error).toMatch(/no items/)
  })

  test('equip rejects unknown slots and bad IDs', () => {
    expect(transitions.equipItem(bare, 'ring', 1).error).toMatch(/unknown slot/)
    expect(transitions.equipItem(bare, 'head', -1).error).toMatch(/not an item ID/)
    expect(transitions.equipItem(bare, 'head', 1.5).error).toMatch(/not an item ID/)
  })

  test('compare characters can carry their own outfit and label', () => {
    const r = transitions.compare(bare, [{ race: 2, sex: 0, label: 'Level 30', items: { chest: 4071 }, custom: { 20: 390 } }], characters).look!
    expect(r.compare).toEqual([{ race: 2, sex: 0, models: 'hd', label: 'Level 30', items: { chest: 4071 }, custom: { 20: 390 } }])
    expect(transitions.compare(bare, [{ race: 2, sex: 0, items: { ring: 1 } }]).error).toMatch(/unknown slot "ring"/)
    expect(transitions.compare(bare, [{ race: 2, sex: 0, items: { chest: -1 } }]).error).toMatch(/not an item ID/)
    const main = transitions.wearMainOutfit(r, 0).look!
    expect(main.compare).toEqual([{ race: 2, sex: 0, models: 'hd', label: 'Level 30', custom: { 20: 390 } }])
    expect(transitions.wearMainOutfit(r, 3).error).toMatch(/no side-by-side character 4/)
  })

  test('characterLook shows a side-by-side character as a look of its own, in the main outfit when it has none', () => {
    const main = { ...bare, items: { head: 1 }, hide: ['head' as const], custom: { '7': 70 }, identity: { firstName: 'Zorak' },
      compare: [{ race: 5, sex: 1 as const, models: 'hd' as const, custom: { '9': 90 } }, { race: 2, sex: 1 as const, models: 'hd' as const, items: { chest: 2 } }] }
    expect(characterLook(main, 0)).toBe(main)
    expect(characterLook(main, 1)).toMatchObject({ race: 5, sex: 1, items: { head: 1 }, hide: ['head'], custom: { '9': 90 }, compare: [] })
    expect(characterLook(main, 1).identity).toBeUndefined()
    expect(characterLook(main, 2)).toMatchObject({ race: 2, sex: 1, items: { chest: 2 }, hide: [], custom: {} })
  })

  test('editCharacter changes the main character, or one side-by-side character and no other', () => {
    const main = { ...bare, items: { head: 1 }, compare: [{ race: 5, sex: 1 as const, models: 'hd' as const }, { race: 2, sex: 1 as const, models: 'hd' as const }] }
    expect(transitions.editCharacter(main, 0, (l) => transitions.equipItem(l, 'chest', 2)).look!.items).toEqual({ head: 1, chest: 2 })
    // Gear on a character in the main outfit gives it its own: the main outfit with the change.
    const own = transitions.editCharacter(main, 1, (l) => transitions.equipItem(l, 'chest', 2)).look!
    expect(own.items).toEqual({ head: 1 })
    expect(own.compare).toEqual([{ race: 5, sex: 1, models: 'hd', items: { head: 1, chest: 2 } }, main.compare[1]])
    // Customization alone keeps it in the main outfit.
    const custom = transitions.editCharacter(main, 1, (l) => transitions.setCustomization(l, 9, 90)).look!
    expect(custom.compare[0]).toEqual({ race: 5, sex: 1, models: 'hd', custom: { '9': 90 } })
    // Another race drops the customization, which belongs to one body model.
    const race = transitions.editCharacter(custom, 1, (l) => transitions.setCharacter(l, 2, 0, 'hd', characters)).look!
    expect(race.compare[0]).toEqual({ race: 2, sex: 0, models: 'hd' })
    expect(transitions.editCharacter(main, 3, (l) => ({ look: l })).error).toMatch(/no side-by-side character 3/)
    expect(transitions.editCharacter(main, 1, (l) => transitions.equipItem(l, 'ring', 2)).error).toMatch(/unknown slot/)
  })

  test('a side-by-side character has its own name, and plays the main animation until it gets its own', () => {
    const main = { ...bare, anim: 'Run', identity: { firstName: 'Zorak' }, compare: [{ race: 5, sex: 1 as const, models: 'hd' as const, identity: { firstName: 'Velka' } }] }
    expect(characterLook(main, 1)).toMatchObject({ identity: { firstName: 'Velka' }, anim: 'Run' })
    const named = transitions.editCharacter(main, 1, (l) => transitions.setIdentity(l, { guild: 'Ashen Vanguard' })).look!
    expect(named.identity).toEqual({ firstName: 'Zorak' })
    expect(named.compare[0]).toEqual({ race: 5, sex: 1, models: 'hd', identity: { firstName: 'Velka', guild: 'Ashen Vanguard' } })
    // Another animation on a character playing the main one gives it its own; Stand is one too.
    const own = transitions.editCharacter(main, 1, (l) => transitions.setAnimation(l, 'Stand', [])).look!
    expect([own.anim, own.compare[0].anim]).toEqual(['Run', 'Stand'])
    expect(characterLook(own, 1).anim).toBeUndefined()
    expect(transitions.mainAnimation(own, 0).look!.compare[0].anim).toBeUndefined()
    expect(transitions.ownAnimation(main, 0).look!.compare[0].anim).toBe('Run')
    expect(transitions.ownAnimation(bare, 0).error).toMatch(/no side-by-side character 1/)
    // compare keeps each character's name and animation, so adding one leaves the others as they were.
    expect(transitions.compare(own, [...own.compare, { race: 2, sex: 0 }], characters).look!.compare[0]).toEqual(own.compare[0])
  })

  test('a character in its own outfit sheathes on its own; one in the main outfit sheathes with the main one', () => {
    const main = { ...bare, compare: [{ race: 5, sex: 1 as const, models: 'hd' as const }, { race: 2, sex: 1 as const, models: 'hd' as const, items: { mainhand: 3 } }] }
    const shared = transitions.editCharacter(main, 1, (l) => transitions.setSheathed(l, true)).look!
    expect([shared.sheathed, shared.compare[0].sheathed, shared.compare[0].items]).toEqual([true, undefined, undefined])
    const own = transitions.editCharacter(main, 2, (l) => transitions.setSheatheOnBack(transitions.setSheathed(l, true).look!, true)).look!
    expect([own.sheathed, own.compare[1].sheathed, own.compare[1].sheatheOnBack]).toEqual([undefined, true, true])
    expect(characterLook(own, 2)).toMatchObject({ sheathed: true, sheatheOnBack: true })
    expect(characterLook(shared, 1).sheathed).toBe(true)
    // An own outfit starts with its weapons drawn, whatever the main one does; back in the main outfit, it
    // sheathes with it again.
    expect(transitions.ownOutfit(shared, 0).look!.compare[0].sheathed).toBeUndefined()
    expect(transitions.wearMainOutfit(own, 1).look!.compare[1]).toEqual({ race: 2, sex: 1, models: 'hd' })
    // Its own animation unbinds it too; back on the main animation and outfit, it sheathes with the main one.
    const dancing = { ...main, compare: [{ ...main.compare[0], anim: 'Dance' }, main.compare[1]] }
    const alone = transitions.editCharacter(dancing, 1, (l) => transitions.setSheathed(l, true)).look!
    expect([alone.sheathed, alone.compare[0].sheathed, alone.compare[0].items]).toEqual([undefined, true, undefined])
    expect(transitions.mainAnimation(alone, 0).look!.compare[0].sheathed).toBeUndefined()
  })

  test('auto-rotate follows sheathing: its own once the outfit or animation is, else the main one; never in links', () => {
    const main = { ...bare, compare: [{ race: 5, sex: 1 as const, models: 'hd' as const }, { race: 2, sex: 1 as const, models: 'hd' as const, anim: 'Run' }] }
    const shared = transitions.editCharacter(main, 1, (l) => transitions.setAutoRotate(l, true)).look!
    expect([shared.autoRotate, shared.compare[0].autoRotate]).toEqual([true, undefined])
    expect(characterLook(shared, 1).autoRotate).toBe(true)
    const own = transitions.editCharacter(main, 2, (l) => transitions.setAutoRotate(l, true)).look!
    expect([own.autoRotate, own.compare[1].autoRotate, characterLook(own, 2).autoRotate]).toEqual([undefined, true, true])
    // Back on the main outfit and animation, it turns with the main character again.
    expect(transitions.mainAnimation(own, 1).look!.compare[1].autoRotate).toBeUndefined()
    // Adding a character keeps the others' setting; a share link carries none of it.
    expect(transitions.compare(own, [...own.compare, { race: 2, sex: 0 }], characters).look!.compare[1].autoRotate).toBe(true)
    expect(canonicalLook({ ...own, autoRotate: true })).not.toHaveProperty('autoRotate')
    expect(JSON.stringify(canonicalLook(own))).not.toContain('autoRotate')
  })

  test('the clear buttons reach every character: set pieces and weapons off every outfit, and everyone stands', () => {
    const main = { ...bare, items: { head: 1, mainhand: 3 }, anim: 'Run', compare: [
      { race: 5, sex: 1 as const, models: 'hd' as const, items: { head: 2, chest: 4, offhand: 5 }, anim: 'Stand' },
      { race: 2, sex: 1 as const, models: 'hd' as const, anim: 'Dance' },
    ] }
    const off = transitions.unequipEveryone(main, ['head', 'mainhand', 'offhand']).look!
    expect([off.items, off.compare[0].items, off.compare[1].items]).toEqual([{}, { chest: 4 }, undefined])
    const still = transitions.standEveryone(main).look!
    expect([still.anim, still.compare[0].anim, still.compare[1].anim]).toEqual([undefined, undefined, undefined])
    // Back on the main animation and outfit, a character's own sheathing goes with its animation.
    const sheathed = { ...main, compare: [main.compare[0], { ...main.compare[1], sheathed: true }] }
    expect(transitions.standEveryone(sheathed).look!.compare[1].sheathed).toBeUndefined()
  })

  test('ownOutfit gives a side-by-side character a copy of the main outfit to change', () => {
    const main = { ...bare, items: { head: 1, chest: 2 }, hide: ['head' as const], compare: [{ race: 5, sex: 1 as const, models: 'hd' as const }] }
    expect(transitions.ownOutfit(main, 0).look!.compare[0]).toEqual({ race: 5, sex: 1, models: 'hd', items: { head: 1, chest: 2 }, hide: ['head'] })
    expect(transitions.ownOutfit(main, 1).error).toMatch(/no side-by-side character 2/)
  })

  test('set_animation takes a name from the list, any case; Stand clears it', () => {
    const anims = [{ id: 0, name: 'Stand' }, { id: 5, name: 'Run' }]
    expect(transitions.setAnimation(bare, 'run', anims).look!.anim).toBe('Run')
    expect(transitions.setAnimation(bare, 'Fly', anims).error).toMatch(/no animation "Fly"/)
    expect(transitions.setAnimation({ ...bare, anim: 'Run' }, 'stand', anims).look!.anim).toBeUndefined()
    // Without the list only the shape is checked.
    expect(transitions.setAnimation(bare, 'Dance', []).look!.anim).toBe('Dance')
  })

  test('set_visibility toggles without duplicates', () => {
    let l = transitions.setVisibility(bare, 'back', false).look!
    l = transitions.setVisibility(l, 'back', false).look!
    expect(l.hide).toEqual(['back'])
    expect(transitions.setVisibility(l, 'back', true).look!.hide).toEqual([])
  })

  test('set_character keeps items, and clears customizations only when the body changes', () => {
    const custom = { ...transitions.equipItem(bare, 'chest', 5).look!, custom: { 20: 390 } }
    expect(transitions.setCharacter(custom, 2, 0, 'hd', characters).look!.custom).toEqual({ 20: 390 })
    const undead = transitions.setCharacter(custom, 5, 1, 'hd', characters).look!
    expect([undead.race, undead.sex, undead.models]).toEqual([5, 1, 'hd'])
    expect(undead.items).toEqual({ chest: 5 })
    expect(undead.custom).toEqual({})
    expect(transitions.setCharacter(custom, 2, 0, 'sd', characters).look!.custom).toEqual({})
  })

  test('set_character refuses characters and model sets the server does not have', () => {
    expect(transitions.setCharacter(bare, 7, 0, 'hd', characters).error).toMatch(/no character data/)
    expect(transitions.setCharacter(bare, 2, 1, 'sd', characters).error).toBe('Orc female has no SD model')
    expect(transitions.setCharacter(bare, 2, 2).error).toMatch(/not a character/)
    // Without the list it only checks the shape.
    expect(transitions.setCharacter(bare, 7, 0).look!.race).toBe(7)
  })

  test('set_character with a form shows the form; its color stays only while race and form do', () => {
    const custom = { ...transitions.equipItem(bare, 'chest', 5).look!, custom: { 20: 390 } }
    const cat = transitions.setCharacter(custom, 2, 0, 'hd', characters, 'cat').look!
    expect([cat.form, cat.items, cat.custom]).toEqual(['cat', { chest: 5 }, {}])
    const purple = transitions.setFormColor(cat, 79119).look!
    expect(purple.formChoice).toBe(79119)
    expect(transitions.setCharacter(purple, 2, 0, 'hd', characters, 'cat').look!.formChoice).toBe(79119)
    expect(transitions.setCharacter(purple, 2, 0, 'hd', characters, 'bear').look!.formChoice).toBeUndefined()
    const body = transitions.setCharacter(purple, 2, 0, 'hd', characters).look!
    expect([body.form, body.formChoice]).toEqual([undefined, undefined])
    expect(transitions.setCharacter(bare, 2, 0, 'hd', characters, 'flight' as never).error).toBe('unknown form "flight"')
    expect(transitions.setFormColor(bare, 79119).error).toBe('this character is not in a druid form')
  })

  test('a side-by-side character keeps its own form and color', () => {
    const two = transitions.compare(bare, [{ race: 2, sex: 0 }], characters).look!
    const cat = transitions.editCharacter(two, 1, (l) => transitions.setCharacter(l, 2, 0, 'hd', characters, 'cat')).look!
    const purple = transitions.editCharacter(cat, 1, (l) => transitions.setFormColor(l, 79119)).look!
    expect([purple.compare[0].form, purple.compare[0].formChoice, purple.form]).toEqual(['cat', 79119, undefined])
    expect(characterLook(purple, 1)).toMatchObject({ form: 'cat', formChoice: 79119 })
    const back = transitions.editCharacter(purple, 1, (l) => transitions.setCharacter(l, 2, 0, 'hd', characters)).look!
    expect('form' in back.compare[0] || 'formChoice' in back.compare[0]).toBe(false)
  })

  test('set_customization stores choice IDs by option ID', () => {
    expect(transitions.setCustomization(bare, 20, 390).look!.custom).toEqual({ 20: 390 })
    expect(transitions.setCustomization(bare, 0, 390).error).toBeDefined()
  })

  const options: CustomizationOption[] = [
    { optionId: 19, name: 'Skin Color', defaultChoiceId: 353, choices: [{ choiceId: 353, name: '' }, { choiceId: 354, name: '' }] },
    { optionId: 20, name: 'Face', defaultChoiceId: 384, choices: [{ choiceId: 384, name: '' }, { choiceId: 390, name: '' }] },
  ]

  test('set_customization checks the choice against the options when they are known', () => {
    expect(transitions.setCustomization(bare, 20, 390, options).look!.custom).toEqual({ 20: 390 })
    expect(transitions.setCustomization(bare, 20, 999, options).error).toMatch(/Face has no choice 999/)
    expect(transitions.setCustomization(bare, 7, 1, options).error).toMatch(/no customization option 7/)
  })

  test('randomize picks a choice for every option; reset clears them', () => {
    const r = transitions.randomizeCustomization(bare, options, () => 0.99).look!
    expect(r.custom).toEqual({ 19: 354, 20: 390 })
    expect(transitions.randomizeCustomization(bare, []).error).toMatch(/no customization options/)
    expect(transitions.resetCustomization(r).look!.custom).toEqual({})
  })

  test('compare sets up to five extra characters, in order', () => {
    const r = transitions.compare(bare, [{ race: 5, sex: 1, models: 'sd' }, { race: 2, sex: 1 }], characters).look!
    expect(r.compare).toEqual([{ race: 5, sex: 1, models: 'sd' }, { race: 2, sex: 1, models: 'hd' }])
    const six = Array.from({ length: 6 }, () => ({ race: 2, sex: 0 }))
    expect(transitions.compare(bare, six).error).toMatch(/at most 6/)
    expect(transitions.compare(bare, [{ race: 2, sex: 1, models: 'sd' }], characters).error).toMatch(/no SD model/)
    expect(transitions.compare(r, []).look!.compare).toEqual([])
  })

  test('set_view accepts only the camera presets', () => {
    expect(transitions.setView(bare, 'head').look!.cam).toEqual({ view: 'head' })
    expect(transitions.setView(bare, 'top').error).toBeDefined()
  })
})

describe('createCommands', () => {
  function setup() {
    const store = createStore(initialState())
    store.set({ characters, status: { version: '0', installs: [], cacheFolder: '', active: { path: '/x', product: 'p', build: 'b2' } } })
    const searched: unknown[] = []
    const results: ItemSearchResult[] = [{ itemId: 12640, name: 'Lionheart Helm', slot: 'head', quality: 4, iconFileDataId: 1 }]
    const cmd = createCommands({ store, appUrl: () => 'http://app.test/?q=1', searchItems: async (q) => { searched.push(q); return results } })
    return { store, cmd, searched }
  }

  test('commands update the store look and stamp the current build', () => {
    const { store, cmd } = setup()
    cmd.equip_item('head', 12640)
    cmd.set_character(5, 1, 'sd')
    cmd.set_visibility('head', false)
    const look = store.get().look
    expect(look.build).toBe('b2')
    expect([look.race, look.sex, look.models]).toEqual([5, 1, 'sd'])
    expect(look.items).toEqual({ head: 12640 })
    expect(look.hide).toEqual(['head'])
  })

  test('edit commands change the selected character; the others always change the main one', () => {
    // The prompt box and MCP commands dress the main character whatever the panels have selected.
    const { store, cmd } = setup()
    cmd.compare([{ race: 5, sex: 1, models: 'hd' }])
    store.set({ selected: 1 })
    cmd.edit.equip_item('head', 12640)
    cmd.edit.set_character(2, 1, 'hd')
    expect(store.get().look.items).toEqual({})
    expect(store.get().look.compare).toEqual([{ race: 2, sex: 1, models: 'hd', items: { head: 12640 } }])
    cmd.equip_item('chest', 4)
    expect(store.get().look.items).toEqual({ chest: 4 })
    // A selection that no longer exists goes back to the main character.
    cmd.compare([])
    expect(store.get().selected).toBe(0)
    cmd.edit.unequip('chest')
    expect(store.get().look.items).toEqual({})
  })

  test('a rejected command leaves the look alone and raises a notice', () => {
    const { store, cmd } = setup()
    const before = store.get().look
    expect(cmd.equip_item('ring', 1).error).toMatch(/unknown slot/)
    expect(store.get().look).toBe(before)
    expect(store.get().notices.commands).toEqual(['unknown slot "ring"'])
    cmd.unequip('head')
    expect(store.get().notices.commands).toEqual([])
  })

  test('get_look is canonical and share_link round-trips', () => {
    const { store, cmd } = setup()
    store.set({ defaults: { 20: 384 } })
    cmd.equip_item('chest', 220794)
    cmd.set_customization(20, 384) // the default: left out of the canonical form
    cmd.compare([{ race: 5, sex: 1, models: 'hd' }])
    expect(cmd.get_look()).toEqual({ build: 'b2', compare: [{ race: 5, sex: 1 }], game: 'forever', items: { chest: 220794 }, models: 'hd', race: 2, sex: 0, v: 1 })
    const link = cmd.share_link()
    expect(link.startsWith('http://app.test/#look=')).toBe(true)
    const back = decodeLook(link.split('#look=')[1]).look!
    expect(back.items).toEqual({ chest: 220794 })
    expect(back.compare).toEqual([{ race: 5, sex: 1, models: 'hd' }])
  })

  test('describe_look writes the look as text, finding a worn set by one piece name', async () => {
    const store = createStore(initialState())
    store.set({
      characters: { build: 'b1', races: [{ race: 5, name: 'Undead', faction: 'horde', classes: [{ classId: 2, name: 'Paladin' }], sexes: [] }] },
      itemInfo: { 1: { name: 'Judgement Crown' }, 2: { name: 'Judgement Breastplate' } },
      look: { ...emptyLook(5, 0), items: { head: 1, chest: 2 }, identity: { firstName: 'Asher', titleId: 3, guild: 'Slain', level: 60, classId: 2 } },
    })
    const searched: string[] = []
    const cmd = createCommands({
      store, searchItems: async () => [], appUrl: () => 'http://app.test/',
      titles: async () => [{ titleId: 3, male: 'Lord %s', female: 'Lady %s' }],
      searchSets: async (q) => { searched.push(q); return [{ setId: 217, name: 'Judgement Armor', pieces: [{ slot: 'head', itemId: 1 }, { slot: 'chest', itemId: 2 }] }] },
      setPieces: async () => [1, 2],
    })
    expect(await cmd.describe_look()).toBe(`Lord Asher <Slain>\nLevel 60 Undead Paladin (male, Horde)\nWearing Judgement Armor.\n${cmd.share_link()}`)
    expect(searched).toEqual(['Judgement Crown'])
  })

  test('describe_look without titles or sets still describes, item by item', async () => {
    const { store, cmd } = setup()
    store.set({ itemInfo: { 12640: { name: 'Lionheart Helm' } }, look: { ...emptyLook(2, 0), items: { head: 12640 }, identity: { firstName: 'Asher', titleId: 3 } } })
    expect((await cmd.describe_look()).split('\n').slice(0, 3)).toEqual(['Asher', 'Orc (male)', 'Wearing Lionheart Helm.'])
  })

  test('open_look replaces the look and reports what it dropped', () => {
    const { store, cmd } = setup()
    const r = cmd.open_look({ v: 1, game: 'forever', build: 'b1', race: 5, sex: 1, items: { head: 1, ring: 2 } })
    expect(r.look!.items).toEqual({ head: 1 })
    expect(store.get().look.race).toBe(5)
    expect(store.get().notices.link).toEqual(['dropped item in unknown slot "ring"'])
    expect(cmd.open_look('nope').look).toBeNull()
    expect(store.get().look.race, 'a bad look does not replace the current one').toBe(5)
  })

  test('search_items passes the query to the server', async () => {
    const { cmd, searched } = setup()
    const r = await cmd.search_items({ q: 'helm', slot: 'head' })
    expect(r[0].itemId).toBe(12640)
    expect(searched).toEqual([{ q: 'helm', slot: 'head' }])
  })
})

describe('setPieceSlots', () => {
  test('lists the slots wearing a piece of any set, so loose items and weapons stay', () => {
    expect(setPieceSlots({ head: 1, chest: 2, back: 9, mainhand: 3 }, new Set([1, 2]))).toEqual(['head', 'chest'])
    expect(setPieceSlots({}, new Set([1]))).toEqual([])
  })
})
