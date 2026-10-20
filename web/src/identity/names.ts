// The name generator: picks a first and a last name from the game's own random-name lists (NameGen),
// as the in-game random-name button does, and from Altrobe's own lists in the same style
// (more-names.json), which the dice button never gives. Deterministic: the same lists, sex and seed
// always give the same name, so "next" and "back" walk through names predictably. Pure.
import type { RaceNames } from '../api/types'
import { fallbackNote, nameProblems, type FallbackReason, type NamePair } from './name-rules'
import { FAMOUS_NAMES } from './famous-names'

// mulberry32, a small seeded generator (public domain); one draw per name part.
function draw(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
// The lists hold some names the game refuses (Gor-Ka, KaelThas, 13-letter last names past its 12-letter limit)
// and famous ones nobody can count on getting (Orgrim, Durotan), so those never come up.
const usable = (list: string[]) => list.filter((n) => nameProblems(n).length === 0 && !FAMOUS_NAMES.has(n.toLowerCase()))
const pick = (list: string[], seed: number) => {
  const ok = usable(list)
  return ok.length ? ok[Math.floor(draw(seed) * ok.length)] : undefined
}

// How often a part comes from Altrobe's lists: Blizzard's are the dice button's, so they'll be taken first.
const OURS = 0.75
const lean = (blizzard: string[], ours: string[] | undefined, seed: number) =>
  (ours?.length && draw(seed ^ 0x27d4eb2d) < OURS ? pick(ours, seed) : undefined) ?? pick(blizzard, seed)

/**
 * A first name for the sex (0 male, 1 female) and a shared last name for `seed`, from the game's lists
 * and, more often, from `more` (Altrobe's). A part in `keep` stays as it is. Parts the race has no list
 * for are left out, never made up.
 */
export function generateName(names: RaceNames, sex: number, seed: number, keep: { firstName?: string; lastName?: string } = {}, more?: RaceNames) {
  const firstName = keep.firstName ?? lean(sex === 1 ? names.female : names.male, sex === 1 ? more?.female : more?.male, seed)
  const lastName = keep.lastName ?? lean(names.last, more?.last, seed ^ 0x5bd1e995)
  return { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) }
}

/**
 * Up to `count` different full names for `seed`: Suggest names' answer when the AI can't give one, or the
 * rest when it gives fewer than five. Pairs in `skip` (already shown) are left out.
 */
export function offlineIdeas(names: RaceNames, more: RaceNames | undefined, sex: number, seed: number, count = 5, skip: NamePair[] = []): NamePair[] {
  const out: NamePair[] = []
  const seen = new Set(skip.map((p) => `${p.firstName} ${p.lastName}`.toLowerCase()))
  for (let i = 0; i < count * 12 && out.length < count; i++) {
    const n = generateName(names, sex, Math.imul(seed, 1000) + i, {}, more)
    if (!n.firstName || !n.lastName) break
    const key = `${n.firstName} ${n.lastName}`.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push({ firstName: n.firstName, lastName: n.lastName }) }
  }
  return out
}

/** Every name in the lists, lowercased: names the AI should not hand back, since the lists already offer them. */
export function knownNames(lists: Record<string, RaceNames>[]): Set<string> {
  const out = new Set<string>()
  for (const byRace of lists) for (const l of Object.values(byRace)) for (const n of [...l.male, ...l.female, ...l.last]) out.add(n.toLowerCase())
  return out
}

/**
 * A few of the game's names for the sex, then last names, for the AI to match the race's style. No two end
 * alike: given "Gara, Agata, Gruta", the model wrote nothing but -ara names (benchmarked 2026-10-19).
 */
export function styleExamples(names: RaceNames, sex: number, seed: number, count = 6): string[] {
  const first = usable(sex === 1 ? names.female : names.male), last = usable(names.last)
  const out: string[] = []
  const endings = new Set<string>()
  for (let i = 0; out.length < count && i < count * 12; i++) {
    const want = out.length % 2 === 0 ? first : last
    const list = want.length ? want : first.length ? first : last
    const n = list.length ? list[Math.floor(draw(seed + i) * list.length)] : undefined
    if (n && !out.includes(n) && !endings.has(n.slice(-2))) { out.push(n); endings.add(n.slice(-2)) }
  }
  return out
}

/**
 * Suggest names' answer when the AI couldn't give five: the AI names it did show (`have`) stay, whatever
 * stopped it, and the lists fill the rest; with none, five from the lists. The note says why.
 */
export function fallbackIdeas(names: RaceNames | undefined, more: RaceNames | undefined, sex: number, seed: number,
  have: NamePair[], reason: FallbackReason, styled: boolean): { ideas: NamePair[]; note: string } {
  const list = names ? offlineIdeas(names, more, sex, seed, 5 - have.length, have) : []
  if (!have.length && !list.length) return { ideas: [], note: 'No name lists for this race.' }
  return { ideas: [...have, ...list], note: have.length ? fallbackNote('short') : fallbackNote(reason, styled) }
}
