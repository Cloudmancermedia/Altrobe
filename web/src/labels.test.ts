import { describe, expect, test } from 'vitest'
import type { CharacterRace } from './api/types'
import { animationGroup, animationLabel, racesByFaction } from './labels'

const race = (id: number, name: string, faction?: CharacterRace['faction']): CharacterRace =>
  ({ race: id, name, classes: [], sexes: [], faction })

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

// BundleBaker.AnimationList on 2026-10-15.
const BAKED = ['Stand', 'Walk', 'Run', 'Walkbackwards', 'ShuffleLeft', 'ShuffleRight', 'Sprint', 'JumpStart', 'Jump', 'JumpEnd', 'JumpLandRun',
  'StealthStand', 'StealthWalk', 'Spell', 'SpellPrecast', 'SpellCast', 'SpellCastArea', 'ReadySpellDirected', 'ReadySpellOmni', 'SpellCastDirected',
  'SpellCastOmni', 'ChannelCastDirected', 'ChannelCastOmni', 'AttackUnarmed', 'Attack1H', 'Attack2H', 'Attack2HL', 'AttackOff', 'Attack1HPierce',
  'Attack2HLoosePierce', 'AttackUnarmedOff', 'ReadyUnarmed', 'Ready1H', 'Ready2H', 'Ready2HL', 'ParryUnarmed', 'Parry1H', 'Parry2H', 'Parry2HL',
  'ShieldBlock', 'Dodge', 'Special1H', 'Special2H', 'SpecialUnarmed', 'ShieldBash', 'Kick', 'Whirlwind', 'BattleRoar', 'ReadyBow', 'AttackBow',
  'ReadyRifle', 'AttackRifle', 'ReadyThrown', 'AttackThrown', 'Mount', 'MountSpecial', 'EmoteWave', 'EmoteCheer', 'EmoteDance', 'EmoteLaugh']
