// Name checks and the shortlist for name reservation (the maintainer's Phase 4 Name Reservation Spec).
// Checked in the Forever client by the maintainer (2026-10-19): 2 to 12 letters (the name boxes stop at 12),
// accents allowed, no hyphens, no letter three times in a row, and capitals after the first letter turn
// lowercase when the character is made.
// Pure.

export interface NamePair { firstName: string; lastName: string }

export const MIN_LETTERS = 2
export const MAX_LETTERS = 12
export const MAX_SHORTLIST = 10

/** What a name breaks, in order; empty when it passes or is empty. */
export function nameProblems(name: string): string[] {
  const n = name.normalize('NFC')
  if (!n) return []
  const out: string[] = []
  const length = [...n].length
  if (length < MIN_LETTERS || length > MAX_LETTERS) out.push(`${MIN_LETTERS} to ${MAX_LETTERS} letters`)
  if (n[0] !== n[0].toUpperCase()) out.push('Start with a capital')
  if (n.slice(1) !== n.slice(1).toLowerCase()) out.push('The game lowercases every letter after the first')
  if (!/^\p{L}+$/u.test(n)) out.push('Letters only')
  else if (/(\p{L})\1\1/iu.test(n)) out.push('No letter 3 times in a row')
  return out
}

/** Problems per part of a pair. Reservation takes both names, so a missing one is a problem too. */
export function pairProblems(pair: Partial<NamePair>): Partial<Record<keyof NamePair, string[]>> {
  const out: Partial<Record<keyof NamePair, string[]>> = {}
  for (const k of ['firstName', 'lastName'] as const) {
    const p = pair[k] ? nameProblems(pair[k]) : ['Both names are needed']
    if (p.length) out[k] = p
  }
  return out
}

const same = (a: NamePair, b: NamePair) => a.firstName.toLowerCase() === b.firstName.toLowerCase() && a.lastName.toLowerCase() === b.lastName.toLowerCase()

/** The pair goes to the top; an earlier copy of it (in any case) goes, and the list keeps MAX_SHORTLIST. */
export function addToShortlist(list: NamePair[], pair: NamePair): NamePair[] {
  return [{ firstName: pair.firstName, lastName: pair.lastName }, ...list.filter((p) => !same(p, pair))].slice(0, MAX_SHORTLIST)
}

export function removeFromShortlist(list: NamePair[], pair: NamePair): NamePair[] {
  return list.filter((p) => !same(p, pair))
}

// Launch day, November 4, ends at midnight Pacific: UTC-8, since daylight saving time ended on November 1.
const LAUNCH_DAY_ENDS = Date.parse('2026-11-05T08:00:00Z')

// Blizzard's times (news.blizzard.com, read 2026-10-21): North America's name reservation opens October 27
// at 1 p.m. PDT, Europe's at 18:00 CET; the game launches worldwide November 4 at 3 p.m. PST. The regions
// open reservation at different moments, so the banner states the times rather than converting them.
const RESERVATION_OPENS = Date.parse('2026-10-27T20:00:00Z')
const LAUNCH = Date.parse('2026-11-04T23:00:00Z')

/** The banner over the app with the reservation and launch times, until launch day ends; then null. */
export function launchBanner(now: Date): string | null {
  const t = now.getTime()
  if (t >= LAUNCH_DAY_ENDS) return null
  if (t >= LAUNCH) return 'WoW Forever is live.'
  const launch = 'WoW Forever launches worldwide November 4 at 3 p.m. PST.'
  return t >= RESERVATION_OPENS
    ? `Name reservation is open through November 3. ${launch}`
    : `Name reservation opens October 27 at 1 p.m. PDT in North America and 18:00 CET in Europe. ${launch}`
}

export const MAX_STYLE = 120

/**
 * The prompt box command the Identity panel's Suggest names button sends: the character, the style the
 * user typed, and a few of the game's names for the model to match without copying.
 */
export function suggestPrompt(raceName: string, sex: number, className?: string, o: { style?: string; examples?: string[] } = {}): string {
  let text = `Suggest five first and last names for a ${sex === 1 ? 'female' : 'male'} ${raceName}${className ? ` ${className}` : ''}`
  const style = o.style?.trim().slice(0, MAX_STYLE)
  if (style) text += `. Style: ${style}`
  const examples = (o.examples ?? []).slice(0, 8)
  if (examples.length) text += `. Make up new names that sound like these, without using them: ${examples.join(', ')}`
  return text
}

/** Why Suggest names fell back to the lists: no AI here, the prompt box's outcome, or AI names that all failed. */
export type FallbackReason = 'none' | 'closed' | 'disabled' | 'busy' | 'failed' | 'empty' | 'short'

export function fallbackNote(reason: FallbackReason, styled = false): string {
  const from = "these come from Altrobe's name lists."
  const text = {
    none: "From Altrobe's name lists.",
    closed: `AI suggestions are used up for today, so ${from}`,
    disabled: `The AI is off for now, so ${from}`,
    busy: `The AI didn't answer, so ${from}`,
    failed: `The AI didn't answer, so ${from}`,
    empty: `The AI's names didn't pass the checks, so ${from}`,
    short: "The AI found fewer than five new names, so the rest come from Altrobe's name lists.",
  }[reason]
  return styled ? `${text} The lists don't follow a style.` : text
}

/**
 * A name part the batch already holds ("Zara" twice) is refused. Similar sounds ("Zara", "Kara") are not:
 * refusing them cost Nova 17 to 30% more tokens and left more batches short of five (benchmarked 2026-10-19).
 */
export function batchProblems(pair: NamePair, accepted: NamePair[]): Partial<Record<keyof NamePair, string[]>> {
  const out: Partial<Record<keyof NamePair, string[]>> = {}
  const used = new Set(accepted.flatMap((p) => [p.firstName.toLowerCase(), p.lastName.toLowerCase()]))
  for (const k of ['firstName', 'lastName'] as const) if (used.has(pair[k].toLowerCase())) out[k] = [`${pair[k]} is already suggested`]
  return out
}
