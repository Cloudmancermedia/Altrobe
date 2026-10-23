import { describe, expect, test } from 'vitest'
import { addToShortlist, MAX_SHORTLIST, nameProblems, pairProblems, removeFromShortlist, launchBanner, suggestPrompt, fallbackNote } from './name-rules'

describe('the name check', () => {
  test('passes names that keep the rules, accents included', () => {
    for (const n of ['Al', 'Aldric', 'Ashborne', 'Zoë', 'Élodie', 'Abcdefghijkl']) expect(nameProblems(n), n).toEqual([])
    expect(nameProblems('')).toEqual([])
  })

  test('says what a name breaks', () => {
    expect(nameProblems('A')).toEqual(['2 to 12 letters'])
    expect(nameProblems('Abcdefghijklm')).toEqual(['2 to 12 letters'])
    expect(nameProblems('aldric')).toEqual(['Start with a capital'])
    expect(nameProblems('AlDric')).toEqual(['The game lowercases every letter after the first'])
    expect(nameProblems('Al1')).toEqual(['Letters only'])
    expect(nameProblems('Al dric')).toEqual(['Letters only'])
    expect(nameProblems('Aaaron')).toEqual(['No letter 3 times in a row'])
    expect(nameProblems('xx1')).toEqual(['Start with a capital', 'Letters only'])
  })

  test('checks a pair part by part', () => {
    expect(pairProblems({ firstName: 'Aldric', lastName: 'ash' })).toEqual({ lastName: ['Start with a capital'] })
    expect(pairProblems({ firstName: 'Aldric', lastName: '' })).toEqual({ lastName: ['Both names are needed'] })
    expect(pairProblems({ firstName: 'Aldric', lastName: 'Ashborne' })).toEqual({})
  })
})

describe('the shortlist', () => {
  test('adds a pair to the top once, whatever its case, and keeps at most 10', () => {
    let list = addToShortlist([], { firstName: 'Aldric', lastName: 'Ashborne' })
    list = addToShortlist(list, { firstName: 'Mira', lastName: 'Vale' })
    list = addToShortlist(list, { firstName: 'aldric', lastName: 'ashborne' })
    expect(list).toEqual([{ firstName: 'aldric', lastName: 'ashborne' }, { firstName: 'Mira', lastName: 'Vale' }])
    for (let i = 0; i < 12; i++) list = addToShortlist(list, { firstName: `Name${'abcdefghijkl'[i]}`, lastName: 'Vale' })
    expect(list).toHaveLength(MAX_SHORTLIST)
    expect(list[0].firstName).toBe('Namel')
  })

  test('removes a pair whatever its case', () => {
    expect(removeFromShortlist([{ firstName: 'Mira', lastName: 'Vale' }, { firstName: 'Kael', lastName: 'Dusk' }], { firstName: 'mira', lastName: 'VALE' })).toEqual([{ firstName: 'Kael', lastName: 'Dusk' }])
  })
})

describe('the suggest command', () => {
  test('names the race, sex and class it is for', () => {
    expect(suggestPrompt('Undead', 1, 'Priest')).toBe('Suggest five first and last names for a female Undead Priest')
    expect(suggestPrompt('Orc', 0)).toBe('Suggest five first and last names for a male Orc')
  })

  test('carries the style and the example names, and stays under the box limit', () => {
    expect(suggestPrompt('Orc', 0, 'Warrior', { style: '  short and brutal ', examples: ['Grok', 'Bloodfist'] }))
      .toBe('Suggest five first and last names for a male Orc Warrior. Style: short and brutal. Make up new names that sound like these, without using them: Grok, Bloodfist')
    expect(suggestPrompt('Night Elf', 1, 'Druid', { style: 'x'.repeat(400), examples: Array(20).fill('Shandaral') }).length).toBeLessThanOrEqual(500)
  })
})

describe('the launch banner', () => {
  test('gives the reservation and launch times, as Blizzard announced them, until launch day ends in Pacific time (08:00 UTC on November 5)', () => {
    const launch = 'WoW Forever launches worldwide November 4 at 3 p.m. PST.'
    expect(launchBanner(new Date('2026-10-19T12:00:00Z'))).toBe(`Name reservation opens October 27 at 1 p.m. PDT in North America and 18:00 CET in Europe, and October 28 at 07:00 KST in Korea and 07:00 CST in Taiwan. ${launch}`)
    // North America's reservation opens at 20:00 UTC (1 p.m. PDT), Europe's three hours earlier, Korea's and Taiwan's two and three hours later.
    expect(launchBanner(new Date('2026-10-27T19:59:59Z'))).toMatch(/^Name reservation opens/)
    expect(launchBanner(new Date('2026-10-27T20:00:00Z'))).toBe(`Name reservation is open through November 3. ${launch}`)
    expect(launchBanner(new Date('2026-11-04T22:59:59Z'))).toBe(`Name reservation is open through November 3. ${launch}`)
    // Launch is 23:00 UTC (3 p.m. PST).
    expect(launchBanner(new Date('2026-11-04T23:00:00Z'))).toBe('WoW Forever is live.')
    expect(launchBanner(new Date('2026-11-05T07:59:59Z'))).toBe('WoW Forever is live.')
    expect(launchBanner(new Date('2026-11-05T08:00:00Z'))).toBeNull()
  })
})

describe('the fallback note', () => {
  test("says why the names come from the lists, and that the lists don't follow a style", () => {
    expect(fallbackNote('closed')).toBe("AI suggestions are used up for today, so these come from Altrobe's name lists.")
    expect(fallbackNote('disabled')).toBe("The AI is off for now, so these come from Altrobe's name lists.")
    expect(fallbackNote('busy')).toBe("The AI didn't answer, so these come from Altrobe's name lists.")
    expect(fallbackNote('failed')).toBe("The AI didn't answer, so these come from Altrobe's name lists.")
    expect(fallbackNote('empty')).toBe("The AI's names didn't pass the checks, so these come from Altrobe's name lists.")
    expect(fallbackNote('none')).toBe("From Altrobe's name lists.")
    expect(fallbackNote('short')).toBe("The AI found fewer than five new names, so the rest come from Altrobe's name lists.")
    expect(fallbackNote('closed', true)).toMatch(/The lists don't follow a style\.$/)
  })
})
