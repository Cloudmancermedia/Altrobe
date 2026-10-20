import { describe, expect, test } from 'vitest'
import more from './more-names.json'
import { nameProblems } from './name-rules'
import { FAMOUS_NAMES } from './famous-names'

describe("Altrobe's name lists", () => {
  test('cover every playable race, and every name passes the name check once per list', () => {
    expect(Object.keys(more).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '95', '96'])
    for (const [race, lists] of Object.entries(more)) {
      for (const [part, names] of Object.entries(lists)) {
        expect(names.length, `${race} ${part}`).toBeGreaterThanOrEqual(190)
        expect(names.filter((n) => nameProblems(n).length || !/^[A-Za-z]+$/.test(n)), `${race} ${part}`).toEqual([])
        expect(new Set(names.map((n) => n.toLowerCase())).size, `${race} ${part} repeats`).toBe(names.length)
        expect(names.filter((n) => FAMOUS_NAMES.has(n.toLowerCase())), `${race} ${part} famous`).toEqual([])
      }
    }
  })
})
