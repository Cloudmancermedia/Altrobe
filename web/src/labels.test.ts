import { describe, expect, test } from 'vitest'
import type { CharacterRace, FormLook } from './api/types'
import { animationGroup, animationLabel, characterLabel, formChoiceLabel, formGroups, racesByFaction } from './labels'

const race = (id: number, name: string, faction?: CharacterRace['faction']): CharacterRace =>
  ({ race: id, name, classes: [], sexes: [], faction })

describe('druid forms', () => {
  const races = [race(4, 'Night Elf', 'alliance'), race(6, 'Tauren', 'horde'), race(8, 'Troll', 'horde'), race(95, 'High Order Skyborne', 'alliance')]
  const form = (f: string, r: number): FormLook => ({ form: f, race: r, defaultChoiceId: 1, choices: [] })

  test('each form is a group of the races that have it, in the race list\'s order', () => {
    const groups = formGroups(races, [form('cat', 95), form('cat', 4), form('bear', 6), form('moonkin', 4)])
    expect(groups.map((g) => [g.form, g.label, g.races.map((r) => r.name)])).toEqual([
      ['cat', 'Druid Cat', ['Night Elf', 'High Order Skyborne']], ['bear', 'Druid Bear', ['Tauren']], ['moonkin', 'Druid Moonkin', ['Night Elf']],
    ])
  })

  test('a form is named by race and form, with no sex or model set', () => {
    const characters = { build: 'b', races }
    expect(characterLabel(characters, 4, 0, 'hd', 'cat')).toBe('Night Elf Cat Form')
    expect(characterLabel(characters, 4, 0, 'hd')).toBe('Night Elf male HD')
  })

  test('a color names the Classic model and the default', () => {
    expect(formChoiceLabel({ choiceId: 3, name: 'Purple', modelFileDataId: 1, textures: [], classic: true }, 3)).toBe('Purple (Classic, default)')
    expect(formChoiceLabel({ choiceId: 1, name: 'Black', modelFileDataId: 1, textures: [], classic: false }, 3)).toBe('Black')
  })
})

describe('racesByFaction', () => {
  test('puts the Alliance first, then the Horde, keeping each side in order', () => {
    const groups = racesByFaction([race(1, 'Human', 'alliance'), race(2, 'Orc', 'horde'), race(3, 'Dwarf', 'alliance'), race(95, 'High Order Skyborne', 'alliance'), race(96, 'Windshaper Skyborne', 'horde')])
    expect(groups.map((g) => [g.faction, g.races.map((r) => r.name)])).toEqual([
      ['alliance', ['Human', 'Dwarf', 'High Order Skyborne']],
      ['horde', ['Orc', 'Windshaper Skyborne']],
    ])
  })

  test('races without a faction (an older server) come last in one group', () => {
    expect(racesByFaction([race(1, 'Human'), race(2, 'Orc', 'horde')]).map((g) => g.faction)).toEqual(['horde', 'neutral'])
  })
})

describe('animation labels', () => {
  test('casting poses read in plain words', () => {
    expect(animationLabel('SpellCastDirected')).toBe('Cast (aimed)')
    expect(animationLabel('ReadySpellOmni')).toBe('Ready to cast (around)')
    expect(animationLabel('ChannelCastDirected')).toBe('Channel (aimed)')
    expect(animationGroup('SpellCastOmni')).toBe('Casting')
  })

  test('the throw names the wand shot too', () => {
    // A wand shot plays AttackThrown in game (Forever beta recordings, 2026-10-17); no animation is the wand's own.
    expect(animationLabel('AttackThrown')).toBe('Throw or shoot a wand')
  })

  test('every baked animation has a label and a group', () => {
    // A plain name such as "Stand" keeps its name as the label; being in a group shows it has one.
    for (const name of BAKED) expect(animationGroup(name), name).not.toBe('Other')
  })

  test('an animation without a label is split into words and grouped as Other', () => {
    expect(animationLabel('EmoteSalute')).toBe('Emote Salute')
    expect(animationGroup('EmoteSalute')).toBe('Other')
  })
})

// BundleBaker.FormAnimations on 2026-10-25: every one has a label and a group.
const BAKED_FORMS = ['Stand', 'Walk', 'Run', 'Walkbackwards', 'ShuffleLeft', 'ShuffleRight', 'Sprint', 'JumpStart', 'Jump', 'JumpEnd', 'JumpLandRun',
  'StealthStand', 'StealthWalk', 'ReadyUnarmed', 'AttackUnarmed', 'DruidCatClaw', 'DruidCatRake', 'DruidCatRip', 'DruidCatPounce', 'DruidCatRavage',
  'DruidBearMaul', 'DruidBearSwipe', 'DruidBearBite', 'DruidBearBash', 'BattleRoar', 'SpellCastDirected', 'SpellCastOmni', 'EmoteRoar', 'EmoteDance']

test('every animation baked for druid forms has plain words and a group', () => {
  for (const name of BAKED_FORMS) expect(animationGroup(name), name).not.toBe('Other')
  expect([animationLabel('DruidCatRake'), animationLabel('DruidBearMaul'), animationLabel('EmoteRoar')]).toEqual(['Rake', 'Maul', 'Roar'])
  expect(animationGroup('DruidCatRake')).toBe('Druid forms')
})

// BundleBaker.AnimationList on 2026-10-15.
const BAKED = ['Stand', 'Walk', 'Run', 'Walkbackwards', 'ShuffleLeft', 'ShuffleRight', 'Sprint', 'JumpStart', 'Jump', 'JumpEnd', 'JumpLandRun',
  'StealthStand', 'StealthWalk', 'Spell', 'SpellPrecast', 'SpellCast', 'SpellCastArea', 'ReadySpellDirected', 'ReadySpellOmni', 'SpellCastDirected',
  'SpellCastOmni', 'ChannelCastDirected', 'ChannelCastOmni', 'AttackUnarmed', 'Attack1H', 'Attack2H', 'Attack2HL', 'AttackOff', 'Attack1HPierce',
  'Attack2HLoosePierce', 'AttackUnarmedOff', 'ReadyUnarmed', 'Ready1H', 'Ready2H', 'Ready2HL', 'ParryUnarmed', 'Parry1H', 'Parry2H', 'Parry2HL',
  'ShieldBlock', 'Dodge', 'Special1H', 'Special2H', 'SpecialUnarmed', 'ShieldBash', 'Kick', 'Whirlwind', 'BattleRoar', 'ReadyBow', 'AttackBow',
  'ReadyRifle', 'AttackRifle', 'ReadyThrown', 'AttackThrown', 'Mount', 'MountSpecial', 'EmoteWave', 'EmoteCheer', 'EmoteDance', 'EmoteLaugh']
