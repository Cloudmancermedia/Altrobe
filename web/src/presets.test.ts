import { describe, expect, test } from 'vitest'
import { animationPresets, BOW, CROSSBOW, GUN, POLEARM, STAFF } from './presets'

const all = ['Stand', 'Run', 'SpellCastDirected', 'SpellCastOmni', 'Attack1H', 'Attack2H', 'Attack2HL', 'AttackBow', 'AttackRifle'].map((name, id) => ({ id, name }))

describe('animation presets', () => {
  test('stand, cast, run, the attacks and a shot, labelled as the Animation list labels them', () => {
    expect(animationPresets(all)).toEqual([
      { label: 'Stand', animation: 'Stand' },
      { label: 'Cast (aimed)', animation: 'SpellCastDirected' },
      { label: 'Cast (around)', animation: 'SpellCastOmni' },
      { label: 'Run', animation: 'Run' },
      { label: 'Attack (one-hand)', animation: 'Attack1H' },
      { label: 'Attack (two-hand)', animation: 'Attack2H' },
      { label: 'Shoot (bow)', animation: 'AttackBow' },
    ])
  })

  test('the shot follows the ranged weapon: a gun or crossbow fires with AttackRifle, a bow or nothing draws a bow', () => {
    const shot = (ranged?: number) => animationPresets(all, undefined, ranged).at(-1)
    for (const ranged of [GUN, CROSSBOW]) expect(shot(ranged)).toEqual({ label: 'Shoot (gun or crossbow)', animation: 'AttackRifle' })
    for (const ranged of [BOW, undefined]) expect(shot(ranged)?.animation).toBe('AttackBow')
  })

  test('the two-hand attack swings a staff or polearm with Attack2HL', () => {
    const twoHand = (subclass: number) => animationPresets(all, subclass).find((p) => p.animation.startsWith('Attack2H'))
    for (const subclass of [STAFF, POLEARM])
      expect(twoHand(subclass)).toEqual({ label: 'Attack (polearm or staff)', animation: 'Attack2HL' })
    // A two-hand sword (8) or axe (1) keeps Attack2H.
    for (const subclass of [8, 1])
      expect(twoHand(subclass)?.animation).toBe('Attack2H')
  })

  test('leaves out what the model has no animation for', () => {
    const some = all.filter((a) => !['SpellCastOmni', 'Attack2HL', 'AttackBow', 'AttackRifle'].includes(a.name))
    expect(animationPresets(some).map((p) => p.animation)).toEqual(['Stand', 'SpellCastDirected', 'Run', 'Attack1H', 'Attack2H'])
    expect(animationPresets(some, STAFF).map((p) => p.animation)).not.toContain('Attack2HL')
    expect(animationPresets([])).toEqual([])
  })
})
