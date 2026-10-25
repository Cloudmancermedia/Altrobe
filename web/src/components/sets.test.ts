import { describe, expect, test } from 'vitest'
import type { ItemSetResult } from '../api/types'
import { DEFAULT_SET_PREFS, readSetPrefs, setDetails, setQuality, withoutNotable, writeSetPrefs , weaponView } from './sets'

const set = (setId: number): ItemSetResult => ({ setId, name: `Set ${setId}`, internal: false, unnamed: false, pieces: [], skipped: [] })

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, v) },
  }
}

describe('set panel preferences', () => {
  test('default to notable sets first and replacing the previous set', () => {
    expect(readSetPrefs(memoryStorage())).toEqual({ notableFirst: true, replace: true })
    expect(DEFAULT_SET_PREFS).toEqual({ notableFirst: true, replace: true })
  })

  test('are remembered', () => {
    const s = memoryStorage()
    writeSetPrefs(s, { notableFirst: false, replace: true })
    expect(readSetPrefs(s)).toEqual({ notableFirst: false, replace: true })
  })

  test('fall back to the defaults when storage is missing, throws or holds junk', () => {
    expect(readSetPrefs(null)).toEqual(DEFAULT_SET_PREFS)
    const broken = { ...memoryStorage(), getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readSetPrefs(broken)).toEqual(DEFAULT_SET_PREFS)
    expect(() => writeSetPrefs(broken, DEFAULT_SET_PREFS)).not.toThrow()
    const junk = memoryStorage()
    junk.setItem('altrobe.sets', '{not json')
    expect(readSetPrefs(junk)).toEqual(DEFAULT_SET_PREFS)
  })
})

describe('withoutNotable', () => {
  test('leaves the notable sets out of the full list below them', () => {
    const groups = [{ group: 'Tier 1', sets: [set(2)] }, { group: 'Tier 2', sets: [set(4)] }]
    expect(withoutNotable([set(1), set(2), set(3), set(4)], groups).map((s) => s.setId)).toEqual([1, 3])
  })
})

describe('setQuality', () => {
  const piece = (quality: number) => ({ slot: 'chest', itemId: 1, name: 'x', quality, iconFileDataId: 0 })
  test("uses the server's set quality, which covers unnamed tier sets", () => {
    expect(setQuality({ ...set(1), unnamed: true, quality: 4, pieces: [piece(-1), piece(-1)] })).toBe(4)
  })
  test('falls back to the best piece without one', () => {
    expect(setQuality({ ...set(1), pieces: [piece(2), piece(3)] })).toBe(3)
  })
})

describe('new-in-Forever sets', () => {
  test('show the set ID, armor type, and a note when the class came from armor type', () => {
    const base = { ...set(1600), pieces: [{ slot: 'chest', itemId: 1, name: 'x', quality: -1, iconFileDataId: 0 }], unnamed: true }
    expect(setDetails({ ...base, newInForever: true, armor: 'cloth', classSource: 'armor' })).toBe('1 pieces · set 1600 · cloth · Class by armor type')
    expect(setDetails({ ...base, newInForever: true, armor: 'leather', classSource: 'name' })).toBe('1 pieces · set 1600 · leather')
    expect(setDetails({ ...base, newInForever: true, armor: null, classSource: 'armor' })).toBe('1 pieces · set 1600 · no armor')
  })

  test('other sets keep their details', () => {
    expect(setDetails({ ...set(218), unnamed: true })).toBe('0 pieces · set 218 · pieces unnamed in this build')
    expect(setDetails({ ...set(102), internal: true })).toBe('0 pieces · set 102 · dev set')
  })
})

describe('weaponView', () => {
  // The Weapons tab's switch: Classic keeps every group but Forever's, New in Forever shows only it.
  const g = (group: string) => ({ group, items: [] })
  const groups = [g('Two-hand'), g('One-hand'), g('Off hand'), g('Ranged'), g('New in Forever')]
  test('Classic shows the class groups and Popular; New in Forever shows only its group', () => {
    expect(weaponView(groups, 'classic').map((x) => x.group)).toEqual(['Two-hand', 'One-hand', 'Off hand', 'Ranged'])
    expect(weaponView(groups, 'forever').map((x) => x.group)).toEqual(['New in Forever'])
    expect(weaponView([g('Popular'), g('New in Forever')], 'classic').map((x) => x.group)).toEqual(['Popular'])
  })
})
