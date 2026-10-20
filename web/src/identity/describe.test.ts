import { describe, expect, test } from 'vitest'
import type { CharactersResponse } from '../api/types'
import { emptyLook, type Look } from '../look/look'
import { describeCharacter, identitySummary, wornSets, type DescribeSet } from './describe'

const characters: CharactersResponse = {
  build: 'b1',
  races: [
    { race: 5, name: 'Undead', faction: 'horde', classes: [{ classId: 1, name: 'Warrior' }, { classId: 5, name: 'Priest' }], sexes: [] },
    { race: 1, name: 'Human', faction: 'alliance', classes: [{ classId: 2, name: 'Paladin' }], sexes: [] },
    { race: 6, name: 'Tauren', faction: 'horde', classes: [{ classId: 11, name: 'Druid' }], sexes: [] },
  ],
}
const titles = [{ titleId: 3, male: 'Lord %s', female: 'Lady %s' }]

const judgement: DescribeSet = {
  setId: 217, name: 'Judgement Armor',
  pieces: [
    { slot: 'head', itemId: 16955 }, { slot: 'shoulder', itemId: 16953 }, { slot: 'chest', itemId: 16958 }, { slot: 'waist', itemId: 16952 },
    { slot: 'legs', itemId: 16954 }, { slot: 'feet', itemId: 16957 }, { slot: 'wrist', itemId: 16951 }, { slot: 'hands', itemId: 16956 },
  ],
}
const judgementItems = Object.fromEntries(judgement.pieces.map((p) => [p.slot, p.itemId])) as Look['items']
const itemInfo: Record<number, { name: string }> = {
  16955: { name: 'Judgement Crown' }, 16953: { name: 'Judgement Spaulders' }, 16958: { name: 'Judgement Breastplate' },
  16952: { name: 'Judgement Belt' }, 16954: { name: 'Judgement Legplates' }, 16957: { name: 'Judgement Sabatons' },
  16951: { name: 'Judgement Bindings' }, 16956: { name: 'Judgement Gauntlets' },
  17102: { name: 'Cloak of the Shrouded Mists' }, 17182: { name: 'Sulfuras, Hand of Ragnaros' },
  19019: { name: 'Thunderfury, Blessed Blade of the Windseeker' }, 19349: { name: 'Elementium Reinforced Bulwark' },
}
const data = { characters, titles, itemInfo, sets: [judgement], link: 'https://altrobe.com/#look=abc' }

function paladin(): Look {
  return {
    ...emptyLook(5, 0),
    items: { ...judgementItems, back: 17102, mainhand: 17182 },
    identity: { firstName: 'Asher', lastName: 'Meier', titleId: 3, guild: 'Slain', level: 60, classId: 2 },
  }
}

describe('describeCharacter', () => {
  test('an Undead Paladin in Judgement: titled name and guild, level, race, class and faction, the set by name, weapons, the link', () => {
    expect(describeCharacter(paladin(), data)).toBe([
      'Lord Asher Meier <Slain>',
      'Level 60 Undead Paladin (male, Horde)',
      'Wearing Judgement Armor and Cloak of the Shrouded Mists.',
      'Weapons: Sulfuras, Hand of Ragnaros.',
      'https://altrobe.com/#look=abc',
    ].join('\n'))
  })

  test('a set missing a piece is worn item by item', () => {
    const look = paladin()
    delete look.items.wrist
    look.items.mainhand = 19019
    look.items.offhand = 19349
    expect(describeCharacter(look, data).split('\n').slice(2, 4)).toEqual([
      'Wearing Judgement Crown, Judgement Spaulders, Judgement Breastplate, Judgement Belt, Judgement Legplates, Judgement Sabatons, Judgement Gauntlets and Cloak of the Shrouded Mists.',
      'Weapons: Thunderfury, Blessed Blade of the Windseeker and Elementium Reinforced Bulwark.',
    ])
  })

  test('hidden slots are named; a hidden piece still counts toward its set', () => {
    const look = { ...paladin(), hide: ['head', 'back'] as Look['hide'] }
    expect(describeCharacter(look, data).split('\n')[2]).toBe('Wearing Judgement Armor and Cloak of the Shrouded Mists. Head and back hidden.')
  })

  test('two side-by-side characters get a line each, before the link', () => {
    const look: Look = {
      ...paladin(),
      compare: [
        { race: 6, sex: 1, models: 'hd' },
        { race: 1, sex: 0, models: 'hd', label: 'Level 30', items: { head: 16955, mainhand: 19019 } },
      ],
    }
    expect(describeCharacter(look, data).split('\n').slice(4)).toEqual([
      'Side by side: Tauren female, in the same outfit.',
      'Side by side: Human male (Level 30), wearing Judgement Crown. Weapons: Thunderfury, Blessed Blade of the Windseeker.',
      'https://altrobe.com/#look=abc',
    ])
  })

  test('a side-by-side character with an empty outfit of its own wears nothing', () => {
    const look: Look = { ...paladin(), compare: [{ race: 6, sex: 0, models: 'hd', items: {} }] }
    expect(describeCharacter(look, data)).toContain('Side by side: Tauren male, wearing nothing.')
  })

  test('without identity, items or link only the character line is left; colors and customizations never show', () => {
    const look: Look = { ...emptyLook(5, 1), custom: { 20: 390 } }
    expect(describeCharacter(look, { characters, titles, itemInfo: {}, sets: [] })).toBe('Undead (female, Horde)')
  })

  test('PvP joins the faction; a guild with no name stands alone; a class any race can be is named', () => {
    const look: Look = { ...emptyLook(1, 1), identity: { guild: 'Slain', classId: 5, pvp: true } }
    expect(describeCharacter(look, { characters, titles, itemInfo: {}, sets: [] })).toBe('<Slain>\nHuman Priest (female, Alliance, PvP)')
  })

  test('an item with no known name is named by its ID', () => {
    const look: Look = { ...emptyLook(5, 0), items: { chest: 4242 } }
    expect(describeCharacter(look, { characters, titles, itemInfo: {}, sets: [] })).toBe('Undead (male, Horde)\nWearing item 4242.')
  })
})

describe('identitySummary', () => {
  test('the identity with its title and class in words', () => {
    expect(identitySummary(paladin(), titles, characters)).toEqual({
      firstName: 'Asher', lastName: 'Meier', titleId: 3, title: 'Lord Asher Meier', guild: 'Slain', level: 60, classId: 2, class: 'Paladin',
    })
  })
  test('a title shows its wording without a name; no identity means none', () => {
    expect(identitySummary({ ...emptyLook(5, 1), identity: { titleId: 3 } }, titles, characters)).toEqual({ titleId: 3, title: 'Lady <name>' })
    expect(identitySummary(emptyLook(5, 0), titles, characters)).toBeUndefined()
  })
})

describe('wornSets', () => {
  test('searches by the name of a worn set piece, once per set, and keeps the sets holding that item', async () => {
    const other: DescribeSet = { setId: 9, name: 'Judgement Copy', pieces: [{ slot: 'head', itemId: 1 }] }
    const searched: string[] = []
    const search = async (q: string) => { searched.push(q); return [judgement, other] }
    const look = paladin()
    const sets = await wornSets([look.items], itemInfo, search, new Set(judgement.pieces.map((p) => p.itemId)))
    expect(sets).toEqual([judgement])
    expect(searched).toEqual(['Judgement Crown'])
  })

  test('items in no set, and a failed search, give no sets', async () => {
    expect(await wornSets([{ back: 17102 }], itemInfo, async () => [judgement], new Set([16955]))).toEqual([])
    expect(await wornSets([{ head: 16955 }], itemInfo, async () => { throw new Error('offline') })).toEqual([])
  })
})
