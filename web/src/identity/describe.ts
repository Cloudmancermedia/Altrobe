// A look as plain text a player can copy: who the character is, what it wears, and the link to open
// it. No AI: everything comes from the look and the game data. Colors and customization choices stay
// out, since most have no name. The local app's describe_look MCP tool returns this same text.
import type { CharactersResponse, TitleInfo } from '../api/types'
import type { Identity, Look } from '../look/look'
import { SLOT_LABELS, sexLabel } from '../labels'
import { SLOT_ORDER, type SlotName } from '../viewer/dress'
import { displayName, factionName, fullName } from './identity'

/** A set as describeCharacter needs it: the pieces that can be shown, each in its look slot. */
export interface DescribeSet {
  setId: number
  name: string
  unnamed?: boolean
  internal?: boolean
  pieces: { slot: string; itemId: number }[]
}

export interface DescribeData {
  characters: CharactersResponse | null | undefined
  titles: TitleInfo[]
  itemInfo: Record<number, { name: string }>
  /** Sets the worn items belong to (wornSets). A set is named only when every piece is worn. */
  sets: DescribeSet[]
  /** The share link, as the last line. */
  link?: string
}

const WEAPON_SLOTS: SlotName[] = ['mainhand', 'offhand', 'ranged']

/** "A", "A and B", "A, B and C". */
function listOf(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const raceOf = (characters: DescribeData['characters'], race: number) => characters?.races.find((r) => r.race === race)

/** A class by ID from any race, so a class picked with Any class (an Undead Paladin) is named too. */
const className = (characters: DescribeData['characters'], classId: number | undefined) =>
  classId ? characters?.races.flatMap((r) => r.classes).find((c) => c.classId === classId)?.name : undefined

/**
 * One outfit's parts in words. A set is named when all its pieces are worn, the largest set first;
 * other items go by name, weapons apart. Hidden slots are named too.
 */
function outfit(items: Look['items'], hide: SlotName[], data: DescribeData): { armor: string[]; weapons: string[]; hidden: string } {
  const claimed = new Set<SlotName>()
  const named: string[] = []
  const sets = data.sets.filter((s) => s.pieces.length > 1)
    .sort((a, b) => b.pieces.length - a.pieces.length || Number(!!a.unnamed || !!a.internal) - Number(!!b.unnamed || !!b.internal))
  for (const set of sets) {
    const fits = set.pieces.every((p) => items[p.slot as SlotName] === p.itemId && !claimed.has(p.slot as SlotName))
    if (!fits) continue
    named.push(set.name)
    for (const p of set.pieces) claimed.add(p.slot as SlotName)
  }
  const itemName = (slot: SlotName) => data.itemInfo[items[slot]!]?.name ?? `item ${items[slot]}`
  const loose = SLOT_ORDER.filter((slot) => items[slot] !== undefined && !claimed.has(slot))
  const hidden = SLOT_ORDER.filter((slot) => hide.includes(slot) && items[slot] !== undefined).map((slot) => SLOT_LABELS[slot].toLowerCase())
  return {
    armor: [...named, ...loose.filter((slot) => !WEAPON_SLOTS.includes(slot)).map(itemName)],
    weapons: loose.filter((slot) => WEAPON_SLOTS.includes(slot)).map(itemName),
    hidden: hidden.length ? `${capital(listOf(hidden))} hidden.` : '',
  }
}

const capital = (s: string) => s.replace(/^./, (c) => c.toUpperCase())
const weaponsLine = (weapons: string[]) => (weapons.length ? `Weapons: ${listOf(weapons)}.` : '')

/**
 * The description, line by line: the titled name and guild, "Level 60 Undead Paladin (male, Horde)",
 * the outfit, the weapons, one line per side-by-side character, then the share link. Parts the look
 * does not set are left out. Pure.
 */
export function describeCharacter(look: Look, data: DescribeData): string {
  const id = look.identity
  const race = raceOf(data.characters, look.race)
  const lines: string[] = []

  const name = displayName(id, data.titles, look.sex)
  const guild = id?.guild ? `<${id.guild}>` : ''
  if (name || guild) lines.push([name, guild].filter(Boolean).join(' '))

  const who = [id?.level ? `Level ${id.level}` : '', race?.name ?? `Race ${look.race}`, className(data.characters, id?.classId) ?? ''].filter(Boolean).join(' ')
  const tags = [sexLabel(look.sex), factionName(race?.faction), id?.pvp ? 'PvP' : ''].filter(Boolean)
  lines.push(`${who} (${tags.join(', ')})`)

  const main = outfit(look.items, look.hide, data)
  const wearing = [main.armor.length ? `Wearing ${listOf(main.armor)}.` : '', main.hidden].filter(Boolean).join(' ')
  if (wearing) lines.push(wearing)
  if (main.weapons.length) lines.push(weaponsLine(main.weapons))

  for (const c of look.compare) {
    const label = c.label ? ` (${c.label})` : ''
    const head = `Side by side: ${raceOf(data.characters, c.race)?.name ?? `Race ${c.race}`} ${sexLabel(c.sex)}${label}`
    if (!c.items) { lines.push(`${head}, in the same outfit.`); continue }
    const own = outfit(c.items, c.hide ?? [], data)
    const worn = own.armor.length ? `, wearing ${listOf(own.armor)}.` : own.weapons.length ? '.' : ', wearing nothing.'
    lines.push([`${head}${worn}`, own.hidden, weaponsLine(own.weapons)].filter(Boolean).join(' '))
  }

  if (data.link) lines.push(data.link)
  return lines.join('\n')
}

/**
 * The identity as the AI tools give it: the stored fields plus the title and class in words. A title
 * shows its wording even without a name ("Lady <name>"), so a model can see which one is set.
 */
export function identitySummary(look: Pick<Look, 'identity' | 'sex'>, titles: TitleInfo[], characters: DescribeData['characters']):
  (Identity & { title?: string; class?: string }) | undefined {
  const id = look.identity
  if (!id) return undefined
  const t = titles.find((x) => x.titleId === id.titleId)
  const title = t ? (look.sex === 1 ? t.female : t.male).replace('%s', fullName(id) || '<name>') : undefined
  const cls = className(characters, id.classId)
  return { ...id, ...(title ? { title } : {}), ...(cls ? { class: cls } : {}) }
}

/**
 * The sets that hold the worn items, found by searching sets by a worn piece's name. One search per
 * set: the pieces of a set already found are not searched again. With `setPieces` (every set piece's
 * item ID), items in no set are not searched at all. A failed search gives no sets, so the outfit is
 * described item by item.
 */
export async function wornSets(outfits: Look['items'][], itemInfo: DescribeData['itemInfo'], search: (q: string) => Promise<DescribeSet[]>,
  setPieces?: ReadonlySet<number>): Promise<DescribeSet[]> {
  const found = new Map<number, DescribeSet>()
  const covered = new Set<number>()
  try {
    for (const items of outfits) for (const id of Object.values(items) as number[]) {
      if (covered.has(id) || (setPieces && !setPieces.has(id)) || !itemInfo[id]?.name) continue
      covered.add(id)
      for (const set of await search(itemInfo[id].name)) {
        if (!set.pieces.some((p) => p.itemId === id)) continue
        found.set(set.setId, set)
        for (const p of set.pieces) covered.add(p.itemId)
      }
    }
  } catch {
    return []
  }
  return [...found.values()]
}
