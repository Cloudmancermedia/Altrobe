import { describe, expect, test } from 'vitest'
import { animationPresets, POLEARM, STAFF } from './presets'

const all = ['Stand', 'Run', 'SpellCastDirected', 'SpellCastOmni', 'Attack1H', 'Attack2H', 'Attack2HL'].map((name, id) => ({ id, name }))

describe('animation presets', () => {
  test('cast, run and the attacks, labelled as the Animation list labels them', () => {
    expect(animationPresets(all)).toEqual([
      { label: 'Cast (aimed)', animation: 'SpellCastDirected' },
      { label: 'Cast (around)', animation: 'SpellCastOmni' },
      { label: 'Run', animation: 'Run' },
      { label: 'Attack (one-hand)', animation: 'Attack1H' },
      { label: 'Attack (two-hand)', animation: 'Attack2H' },
    ])
  })

  test('the two-hand attack swings a staff or polearm with Attack2HL', () => {
    for (const subclass of [STAFF, POLEARM])
      expect(animationPresets(all, subclass).at(-1)).toEqual({ label: 'Attack (polearm or staff)', animation: 'Attack2HL' })
    // A two-hand sword (8) or axe (1) keeps Attack2H.
    for (const subclass of [8, 1])
      expect(animationPresets(all, subclass).at(-1)?.animation).toBe('Attack2H')
  })

  test('leaves out what the model has no animation for', () => {
    const some = all.filter((a) => a.name !== 'SpellCastOmni' && a.name !== 'Attack2HL')
    expect(animationPresets(some).map((p) => p.animation)).toEqual(['SpellCastDirected', 'Run', 'Attack1H', 'Attack2H'])
    expect(animationPresets(some, STAFF).map((p) => p.animation)).not.toContain('Attack2HL')
    expect(animationPresets([])).toEqual([])
  })
})
