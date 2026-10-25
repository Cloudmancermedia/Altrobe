import type { ItemSetResult, SetGroup } from '../api/types'

/** The Sets tab's two checkboxes, remembered in this browser only. */
export interface SetPrefs {
  /** List the race's notable sets (PvP and tiers) before every other set. */
  notableFirst: boolean
  /** Equipping a set takes off the pieces of the set worn before (see replacedSetSlots). */
  replace: boolean
}

export const DEFAULT_SET_PREFS: SetPrefs = { notableFirst: true, replace: true }
const KEY = 'altrobe.sets'

// Storage can be missing or throw (private windows, blocked site data), so both fall back quietly.
export function readSetPrefs(storage: Storage | null | undefined): SetPrefs {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<SetPrefs> | null
    return {
      notableFirst: typeof saved?.notableFirst === 'boolean' ? saved.notableFirst : DEFAULT_SET_PREFS.notableFirst,
      replace: typeof saved?.replace === 'boolean' ? saved.replace : DEFAULT_SET_PREFS.replace,
    }
  } catch {
    return DEFAULT_SET_PREFS
  }
}

export function writeSetPrefs(storage: Storage | null | undefined, prefs: SetPrefs) {
  try { storage?.setItem(KEY, JSON.stringify(prefs)) } catch { /* not remembered, still applied */ }
}

/** The full list without the sets already shown in the notable groups above it. */
export function withoutNotable(sets: ItemSetResult[], groups: SetGroup[]): ItemSetResult[] {
  const shown = new Set(groups.flatMap((g) => g.sets.map((s) => s.setId)))
  return sets.filter((s) => !shown.has(s.setId))
}

/** The quality to colour a set by: the server's, else the best piece's (unnamed pieces have none). */
export function setQuality(s: ItemSetResult): number {
  return s.quality ?? Math.max(...s.pieces.map((p) => p.quality))
}

/** The line under a set's name. A new-in-Forever set shows its armor type, and says when its class was guessed from it. */
export function setDetails(s: ItemSetResult): string {
  const parts = [`${s.pieces.length} pieces`, `set ${s.setId}`]
  if (s.newInForever) {
    parts.push(s.armor ?? 'no armor')
    if (s.classSource === 'armor' && s.armor) parts.push('Class by armor type')
  } else if (s.unnamed) parts.push('pieces unnamed in this build')
  if (s.internal) parts.push('dev set')
  return parts.join(' · ')
}

export type WeaponView = 'classic' | 'forever'
const FOREVER_GROUP = 'New in Forever'

/** The Weapons tab's switch: Classic shows every group but Forever's, New in Forever only that one. */
export function weaponView<T extends { group: string }>(groups: T[], view: WeaponView): T[] {
  return groups.filter((g) => (g.group === FOREVER_GROUP) === (view === 'forever'))
}
