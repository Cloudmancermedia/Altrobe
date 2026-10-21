// Gear for one level, in the browser: a port of OutfitBuilder (importer/src/Altrobe.Core/Catalog/
// OutfitBuilder.cs), the rule behind the local app's build_outfit tool. In each slot, an item whose
// required level is within WINDOW below the target: highest required level first, then an item new in
// Forever, then highest item level, then lowest ID, so the same request always gives the same outfit.
// Developer and unnamed items (no known level) are never picked.
import { allowsClass, type BundleItem } from '../api/search'

export const WINDOW = 7
export const DEFAULT_SLOTS = ['head', 'shoulder', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'back']
// Slots whose items have an armor type; the back (always cloth) does not.
const ARMOR_SLOTS = new Set(['head', 'shoulder', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands'])
export const ARMOR_TYPES = ['cloth', 'leather', 'mail', 'plate']

// The armor each class wears, as Classic trains it: warriors and paladins learn plate at 40, hunters and
// shamans mail. Before that they wear the next type down. Forever's own rules weren't checked (2026-10-21).
const CLASS_ARMOR: Record<string, [string, string?]> = {
  warrior: ['mail', 'plate'], paladin: ['mail', 'plate'], hunter: ['leather', 'mail'], shaman: ['leather', 'mail'],
  rogue: ['leather'], druid: ['leather'], priest: ['cloth'], mage: ['cloth'], warlock: ['cloth'],
}
export const CLASS_NAMES = ['Warrior', 'Paladin', 'Hunter', 'Shaman', 'Rogue', 'Druid', 'Priest', 'Mage', 'Warlock']

/** The armor a class wears at a level, or undefined for a name that isn't a class. */
export function armorFor(className: string, level: number): string | undefined {
  const armor = CLASS_ARMOR[className.trim().toLowerCase()]
  return armor && (level >= 40 && armor[1] ? armor[1] : armor[0])
}

export interface OutfitRequest {
  level: number
  /** cloth, leather, mail or plate, for the armor slots. */
  armor?: string
  classId?: number
  minQuality?: number
  maxQuality?: number
  slots?: string[]
  /** Weapon types for the main hand (or the ranged slot for a bow, gun, crossbow, thrown or wand). */
  weapons?: string[]
  hands?: 'one-hand' | 'two-hand' | 'ranged'
  offHand?: 'shield' | 'held'
}

export interface Outfit {
  items: Record<string, BundleItem>
  missing: string[]
}

export function buildOutfit(catalog: BundleItem[], r: OutfitRequest): Outfit {
  const minQuality = r.minQuality ?? 2
  const maxQuality = r.maxQuality ?? 5
  const pick = (fits: (i: BundleItem) => boolean): BundleItem | undefined => {
    let best: BundleItem | undefined
    for (const i of catalog) {
      const req = i.requiredLevel
      if (!fits(i) || i.internal || i.unnamed || req == null || req > r.level || req <= r.level - WINDOW) continue
      if (i.quality < minQuality || i.quality > maxQuality) continue
      if (r.classId !== undefined && !allowsClass(i, r.classId)) continue
      if (!best || better(i, best)) best = i
    }
    return best
  }

  const items: Record<string, BundleItem> = {}
  const missing: string[] = []
  for (const slot of r.slots ?? DEFAULT_SLOTS) {
    const found = pick((i) => i.slot === slot && (!ARMOR_SLOTS.has(slot) || !r.armor || i.armor === r.armor))
    if (found) items[slot] = found
    else missing.push(slot)
  }

  // Weapons only when asked for by type: the data does not say which weapons a class can use.
  const mainHands = r.hands === 'one-hand' ? ['one-hand', 'main hand'] : r.hands === 'two-hand' ? ['two-hand'] : r.hands === 'ranged' ? ['ranged']
    : ['one-hand', 'main hand', 'two-hand', 'ranged']
  const weapons = r.weapons ?? []
  const main = weapons.length
    ? pick((i) => (i.slot === 'mainhand' || i.slot === 'ranged') && i.weapon != null && weapons.includes(i.weapon) && i.hands != null && mainHands.includes(i.hands))
    : undefined
  if (main) items[main.slot] = main
  else missing.push('mainhand')

  // A character holds one kind of weapon at a time: no off hand with a two-hander or a ranged weapon.
  if (r.offHand && !['two-hand', 'ranged', 'thrown'].includes(main?.hands ?? '')) {
    const hands = r.offHand === 'shield' ? 'shield' : 'held in off hand'
    const off = pick((i) => i.slot === 'offhand' && i.hands === hands)
    if (off) items.offhand = off
    else missing.push('offhand')
  }
  return { items, missing }
}

// Highest required level, then new in Forever, then highest item level, then lowest ID.
function better(a: BundleItem, b: BundleItem): boolean {
  if (a.requiredLevel !== b.requiredLevel) return (a.requiredLevel ?? 0) > (b.requiredLevel ?? 0)
  if (!!a.newInForever !== !!b.newInForever) return !!a.newInForever
  if ((a.itemLevel ?? null) !== (b.itemLevel ?? null)) return cmpNullable(a.itemLevel, b.itemLevel) > 0
  return a.itemId < b.itemId
}

// C#'s OrderBy on int?: null sorts below every number.
function cmpNullable(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null) return b == null ? 0 : -1
  if (b == null) return 1
  return a - b
}
