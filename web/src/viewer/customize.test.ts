// customize() over a tiny hand-written base look (made-up IDs, not game data).
import { describe, expect, test } from 'vitest'
import type { BaseLook, CustomizationOption, TextureLayer } from '../api/types'
import { companionChoices, customize, labelChoices, panelOptions, randomCustomization } from './customize'

const section = { sectionType: -1, x: 0, y: 0, width: 512, height: 512 }
const layer = (optionId: number, choiceId: number, fileDataId: number, extra: Partial<TextureLayer> = {}): TextureLayer =>
  ({ textureType: 1, layer: 0, blendMode: 0, section, fileDataId, optionId, choiceId, ...extra })

// Skin (two choices), face (its texture depends on the skin), hair style (geosets).
const options: CustomizationOption[] = [
  { optionId: 1, name: 'Skin', defaultChoiceId: 11, geosets: [], choices: [
    { choiceId: 11, name: 'Pale', geosets: [], layers: [layer(1, 11, 1011)] },
    { choiceId: 12, name: 'Dark', geosets: [], layers: [layer(1, 12, 1012)] },
  ] },
  { optionId: 2, name: 'Face', defaultChoiceId: 21, geosets: [], choices: [
    { choiceId: 21, name: 'A', geosets: [], layers: [
      layer(2, 21, 2111, { layer: 3, relatedChoiceId: 11 }),
      layer(2, 21, 2112, { layer: 3, relatedChoiceId: 12 }),
    ] },
  ] },
  { optionId: 3, name: 'Hair', defaultChoiceId: 31, geosets: [0, 2, 3], choices: [
    { choiceId: 31, name: 'Bald', geosets: [0], layers: [] },
    { choiceId: 32, name: 'Long', geosets: [3], layers: [layer(3, 32, 3200, { textureType: 6 })] },
  ] },
]

const base: Pick<BaseLook, 'geosets' | 'layers' | 'options'> = {
  geosets: [0, 401, 702],
  layers: [layer(1, 11, 1011), layer(2, 21, 2111, { layer: 3 })],
  options,
}
const fileIds = (layers: TextureLayer[]) => layers.map((l) => l.fileDataId)

describe('customize', () => {
  test('no choices gives the base look back', () => {
    const r = customize(base, {})
    expect(r.geosets).toEqual(base.geosets)
    expect(fileIds(r.layers)).toEqual([1011, 2111])
    expect(r.notes).toEqual([])
  })

  test('a skin change swaps the skin layer and the face layer that depends on it', () => {
    const r = customize(base, { 1: 12 })
    expect(fileIds(r.layers)).toEqual([1012, 2112])
    expect(r.layers.every((l) => l.relatedChoiceId === undefined)).toBe(true)
  })

  test('a hair change turns off the option geosets, shows the choice, and adds its layers', () => {
    const r = customize(base, { 3: 32 })
    expect(r.geosets).toEqual([0, 3, 401, 702]) // geoset 0 is the body and is never turned off
    expect(fileIds(r.layers)).toEqual([1011, 2111, 3200])
  })

  // Like the Undead male's jaw: the base look shows 101 (the reset rule's default) with 102, and no
  // choice names 101. A choice sets its geoset group, so every other variant in it goes.
  const jaw: CustomizationOption = { optionId: 4, name: 'Jaw', defaultChoiceId: 41, geosets: [100, 102, 103], choices: [
    { choiceId: 41, name: 'Intact', geosets: [102], layers: [] },
    { choiceId: 42, name: 'Slack', geosets: [103], layers: [] },
    { choiceId: 43, name: 'None', geosets: [100], layers: [] },
  ] }
  const jawBase = { ...base, geosets: [0, 101, 102, 401], meshGeosets: [0, 101, 102, 103, 401], options: [...options, jaw] }

  test('a choice replaces every other variant of the geoset groups it sets', () => {
    expect(customize(jawBase, { 4: 42 }).geosets).toEqual([0, 103, 401])
  })

  test('a variant-0 geoset hides its group and keeps the body', () => {
    expect(customize(jawBase, { 4: 43 }).geosets).toEqual([0, 401])
  })

  test('choice geosets missing from the body mesh are left out', () => {
    const r = customize({ ...base, meshGeosets: [0, 2, 401, 702] }, { 3: 32 })
    expect(r.geosets).toEqual([0, 401, 702])
  })

  test('unknown options and choices fall back to the default, with a note', () => {
    const r = customize(base, { 3: 99, 7: 1 })
    expect(r.geosets).toEqual(base.geosets)
    expect(r.notes).toEqual(['option 3 has no choice 99; using the default', 'no option 7 for this character'])
  })

  test('a base look without options is left alone', () => {
    const r = customize({ ...base, options: undefined }, { 1: 12 })
    expect(fileIds(r.layers)).toEqual([1011, 2111])
    expect(r.notes).toEqual(['this character has no customization data; showing defaults'])
  })
})

describe('randomCustomization', () => {
  test('picks one listed choice per option, by the random number given', () => {
    expect(randomCustomization(options, () => 0)).toEqual({ 1: 11, 2: 21, 3: 31 })
    expect(randomCustomization(options, () => 0.99)).toEqual({ 1: 12, 2: 21, 3: 32 })
  })

  test('skips options with no choices', () => {
    expect(randomCustomization([{ optionId: 5, name: 'x', defaultChoiceId: null, choices: [] }], () => 0)).toEqual({})
  })
})

describe('panelOptions', () => {
  const choice = (optionId: number, option: string, choiceId: number) =>
    ({ optionId, option, choiceId, choice: `c${choiceId}`, orderIndex: 0, eligibleChoices: 1, totalChoices: 1 })

  test('lists only the options the server offers, though every option keeps a default', () => {
    // Option 9 is like Eye Style: the server leaves it out of options but still names its default.
    const r = panelOptions({ choices: [choice(1, 'Skin', 11), choice(9, 'Eye Style', 91)], options: [options[0]] })
    expect(r.map((o) => o.name)).toEqual(['Skin'])
    expect(r[0].choices.map((c) => c.choiceId)).toEqual([11, 12])
  })

  test('without options, each default stands alone', () => {
    expect(panelOptions({ choices: [choice(1, 'Skin', 11)] }).map((o) => o.choices.length)).toEqual([1])
  })
})

// A pattern and its color, as Skyborne tattoos are: the color paints the pattern chosen, and its
// default paints nothing.
const tattoo: CustomizationOption[] = [
  { optionId: 20, name: 'Body Tattoo', defaultChoiceId: 200, choices: [{ choiceId: 200, name: 'None' }, { choiceId: 201, name: 'Zephyr' }] },
  { optionId: 21, name: 'Body Tattoo Color', defaultChoiceId: 210, choices: [
    { choiceId: 210, name: '' },
    { choiceId: 211, name: '', swatch: '#f2fff3', layers: [layer(21, 211, 900, { relatedChoiceId: 201 })] },
    { choiceId: 212, name: '', swatch: '#4589af', layers: [layer(21, 212, 901, { relatedChoiceId: 201 })] },
  ] },
  { optionId: 22, name: 'Hair Color', defaultChoiceId: 220, choices: [{ choiceId: 220, name: '', swatch: '#111111' }, { choiceId: 221, name: 'New 28', swatch: '#222222' }, { choiceId: 222, name: 'Ember', swatch: '#333333' }] },
]

describe('labelChoices', () => {
  test("numbers the game's placeholder names and calls a color's empty default None", () => {
    // Skyborne Hair Color has "New 28" to "New 31"; the male Body Tattoo Color default has no name.
    const [pattern, color, hair] = labelChoices(tattoo)
    expect(pattern.choices.map((c) => c.name)).toEqual(['None', 'Zephyr'])
    expect(color.choices.map((c) => c.name)).toEqual(['None', '', ''])
    expect(hair.choices.map((c) => c.name)).toEqual(['', '', 'Ember'])
    expect(tattoo[2].choices[1].name, 'input is not changed').toBe('New 28')
  })
})

describe('companionChoices', () => {
  test('a pattern picked while its color paints nothing also picks the first color that shows it', () => {
    expect(companionChoices(tattoo, {}, 20, 201)).toEqual({ 21: 211 })
    // A color that already shows the pattern stays.
    expect(companionChoices(tattoo, { 21: 212 }, 20, 201)).toEqual({})
    // None, and options with no pattern of their own, pick nothing.
    expect(companionChoices(tattoo, {}, 20, 200)).toEqual({})
    expect(companionChoices(tattoo, {}, 22, 222)).toEqual({})
  })
})
