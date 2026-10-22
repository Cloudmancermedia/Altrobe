import { describe, expect, test } from 'vitest'
import instructions from '../../../infra/lambda/prompt/instructions.ts?raw'
import { tierSetName, TIER_SETS } from './tiers'

describe('tier sets', () => {
  test('match the tier list the prompt API gives the model', () => {
    const block = instructions.slice(instructions.indexOf('export const TIERS'), instructions.indexOf(']\nconst TIER_LABELS'))
    const rows = [...block.matchAll(/\['(\w+)', \[(.*)\]\]/g)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"|'([^']+)'/g)].map((n) => n[1] ?? n[2])])
    expect(rows.length).toBe(9)
    expect(Object.fromEntries(rows)).toEqual(TIER_SETS)
  })

  test('a class and a tier, however the model writes it, name one set', () => {
    for (const tier of ['T2', '2', 'tier 2', 'Tier 2', 't2']) expect(tierSetName('mage', tier)).toBe('Netherwind Regalia')
    expect(tierSetName('Priest', 'T2.5')).toBe('Garments of the Oracle')
    expect(tierSetName('Warrior', '0.5')).toBe('Battlegear of Heroism')
    expect(tierSetName('Warlock', 3)).toBe('Plagueheart Raiment')
    expect(tierSetName('Mage', 'T9')).toBeUndefined()
    expect(tierSetName('Bard', 'T2')).toBeUndefined()
  })
})
