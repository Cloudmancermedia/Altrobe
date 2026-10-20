// Altrobe's own name lists (more-names.json): names in each race's style that Blizzard's lists don't hold,
// written for this app and checked against the name rules. Loaded on first use, as their own file.
import type { RaceNames } from '../api/types'
import { getNames } from '../api/client'
import { knownNames } from './names'

// A failed load is dropped, so the next call tries again rather than keeping the failure for the visit.
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined
  return () => (p ??= load().catch((e) => { p = undefined; throw e }))
}

export const getMoreNames = once(() => import('./more-names.json').then((m) => m.default as Record<string, RaceNames>))

/** Every name in the game's and Altrobe's lists, for suggest_names to refuse. */
export const getKnownNames = once(() => Promise.all([getNames(), getMoreNames()]).then(knownNames))
