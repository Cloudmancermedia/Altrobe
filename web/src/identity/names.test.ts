import { describe, expect, test } from 'vitest'
import { fallbackIdeas, generateName, knownNames, offlineIdeas, styleExamples } from './names'

const human = { male: ['Aldren', 'Barric', 'Nielas'], female: ['Aegwynn', 'Calia'], last: ['Belgarden', 'Dawnstone', 'Cuthbridge'] }

describe('generateName', () => {
  test('the same seed always gives the same name, and seeds spread over the lists', () => {
    const a = generateName(human, 0, 42)
    expect(generateName(human, 0, 42)).toEqual(a)
    expect(human.male).toContain(a.firstName)
    expect(human.last).toContain(a.lastName)
    const seen = new Set(Array.from({ length: 50 }, (_, s) => generateName(human, 0, s).firstName))
    expect(seen.size).toBe(human.male.length)
  })

  test('first names follow the sex; last names are shared', () => {
    expect(human.female).toContain(generateName(human, 1, 7).firstName)
  })

  test('a locked part is kept while the other changes', () => {
    const names = Array.from({ length: 20 }, (_, s) => generateName(human, 0, s, { firstName: 'Asher' }))
    expect(new Set(names.map((n) => n.firstName))).toEqual(new Set(['Asher']))
    expect(new Set(names.map((n) => n.lastName)).size).toBeGreaterThan(1)
  })

  test("only names that pass the name check come up, though the game's lists hold some that don't", () => {
    const orc = { male: ['Gor-Ka', 'KaelThas', 'Grukk'], female: ['Aggra'], last: ['Bladesplitter', "O'Brinnsy", 'Ironhide'] }
    const names = Array.from({ length: 40 }, (_, s) => generateName(orc, 0, s))
    expect(new Set(names.map((n) => n.firstName))).toEqual(new Set(['Grukk']))
    expect(new Set(names.map((n) => n.lastName))).toEqual(new Set(['Ironhide']))
  })

  test("skips famous Warcraft names, which Blizzard's own lists hold (Orgrim, Durotan)", () => {
    const orc = { male: ['Orgrim', 'Durotan', 'Grukk'], female: [], last: ['Doomhammer', 'Ironhide'] }
    const names = Array.from({ length: 40 }, (_, s) => generateName(orc, 0, s))
    expect(new Set(names.map((n) => n.firstName))).toEqual(new Set(['Grukk']))
    expect(new Set(names.map((n) => n.lastName))).toEqual(new Set(['Ironhide']))
  })

  test('a race without a list gives nothing to pick, rather than a made-up name', () => {
    expect(generateName({ male: [], female: [], last: [] }, 0, 1)).toEqual({})
  })

  test("leans toward Altrobe's own names, and still gives Blizzard's some of the time", () => {
    const ours = { male: ['Varok', 'Durgan'], female: ['Shala'], last: ['Ironjaw', 'Ashfang'] }
    const names = Array.from({ length: 400 }, (_, s) => generateName(human, 0, s, {}, ours))
    const oursFirst = names.filter((n) => ours.male.includes(n.firstName!)).length
    expect(oursFirst).toBeGreaterThan(240)
    expect(oursFirst).toBeLessThan(360)
    expect(names.some((n) => human.male.includes(n.firstName!))).toBe(true)
    expect(names.filter((n) => ours.last.includes(n.lastName!)).length).toBeGreaterThan(240)
    expect(generateName(human, 0, 9, {}, ours)).toEqual(generateName(human, 0, 9, {}, ours))
  })
})

describe('offlineIdeas', () => {
  const ours = { male: ['Varok', 'Durgan', 'Morth'], female: ['Shala'], last: ['Ironjaw', 'Ashfang', 'Grimtusk'] }

  test('gives five different pairs for a seed, the same five every time', () => {
    const ideas = offlineIdeas(human, ours, 0, 3)
    expect(ideas).toHaveLength(5)
    expect(new Set(ideas.map((p) => `${p.firstName} ${p.lastName}`)).size).toBe(5)
    expect(offlineIdeas(human, ours, 0, 3)).toEqual(ideas)
    expect(offlineIdeas(human, ours, 0, 4)).not.toEqual(ideas)
  })

  test('leaves out pairs already shown, to top up a short answer', () => {
    const two = { male: ['Varok', 'Brokk'], female: [], last: ['Ironjaw'] }
    expect(offlineIdeas(two, undefined, 0, 3, 5, [{ firstName: 'Varok', lastName: 'Ironjaw' }])).toEqual([{ firstName: 'Brokk', lastName: 'Ironjaw' }])
  })

  test('gives what it can when the lists are short, and nothing without lists', () => {
    expect(offlineIdeas({ male: ['Al'], female: [], last: ['Vale'] }, undefined, 0, 1)).toEqual([{ firstName: 'Al', lastName: 'Vale' }])
    expect(offlineIdeas({ male: [], female: [], last: [] }, undefined, 0, 1)).toEqual([])
  })
})

describe('the AI guardrails', () => {
  test("knownNames holds every list's names, in lowercase", () => {
    const known = knownNames([{ 1: human }, { 2: { male: ['Varok'], female: [], last: ['Ironjaw'] } }])
    expect(known.has('aldren')).toBe(true)
    expect(known.has('ironjaw')).toBe(true)
    expect(known.has('aldric')).toBe(false)
  })

  test('styleExamples never sends two names with the same ending, so the model has no one sound to copy', () => {
    const orcF = { male: [], female: ['Gara', 'Agata', 'Gruta', 'Zela', 'Thurga', 'Mogra', 'Kesh', 'Dagrin'], last: ['Bladefury', 'Gorefury', 'Deathscream', 'Ironhide'] }
    for (let seed = 0; seed < 20; seed++) {
      const ex = styleExamples(orcF, 1, seed, 6)
      expect(new Set(ex.map((n) => n.slice(-2))).size, ex.join(', ')).toBe(ex.length)
    }
  })

  test('styleExamples still gives last names when the sex has no first-name list', () => {
    expect(styleExamples({ male: [], female: [], last: ['Ironhide', 'Bladefury'] }, 0, 1, 4).sort()).toEqual(['Bladefury', 'Ironhide'])
  })

  test("styleExamples picks a few of Blizzard's names for the sex, and last names", () => {
    const ex = styleExamples(human, 1, 5, 4)
    expect(ex).toHaveLength(4)
    for (const n of ex) expect([...human.female, ...human.last]).toContain(n)
  })
})

describe('fallbackIdeas', () => {
  const lists = { male: ['Varok', 'Brokk', 'Durgan', 'Morth', 'Grell', 'Hask'], female: [], last: ['Ironjaw', 'Ashfang', 'Grimtusk'] }
  const ai = [{ firstName: 'Zorran', lastName: 'Frostdrum' }, { firstName: 'Velkesh', lastName: 'Mirebloom' }]

  test("keeps the AI's names when it stopped partway, for any reason, and fills the rest", () => {
    for (const reason of ['short', 'busy', 'failed', 'closed', 'disabled'] as const) {
      const r = fallbackIdeas(lists, undefined, 0, 7, ai, reason, false)
      expect(r.ideas.slice(0, 2), reason).toEqual(ai)
      expect(r.ideas, reason).toHaveLength(5)
      expect(r.note, reason).toBe("The AI found fewer than five new names, so the rest come from Altrobe's name lists.")
    }
  })

  test('with no AI names, gives five from the lists and says why', () => {
    const r = fallbackIdeas(lists, undefined, 0, 7, [], 'closed', true)
    expect(r.ideas).toHaveLength(5)
    expect(r.note).toBe("AI suggestions are used up for today, so these come from Altrobe's name lists. The lists don't follow a style.")
    expect(fallbackIdeas(undefined, undefined, 0, 7, [], 'none', false)).toEqual({ ideas: [], note: 'No name lists for this race.' })
  })
})
