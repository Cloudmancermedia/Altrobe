import type { CharacterRace, CharactersResponse, FormChoice, FormLook, ModelSet } from './api/types'
import { FORMS, type Form } from './look/look'
import type { SlotName } from './viewer/dress'

export const SLOT_LABELS: Record<SlotName, string> = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulders', shirt: 'Shirt', chest: 'Chest', waist: 'Waist', legs: 'Legs',
  feet: 'Feet', wrist: 'Wrists', hands: 'Hands', back: 'Back', mainhand: 'Main hand', offhand: 'Off hand', ranged: 'Ranged', tabard: 'Tabard',
}

export const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom']

export const sexLabel = (sex: number) => (sex === 0 ? 'male' : 'female')

export function characterLabel(characters: CharactersResponse | null, race: number, sex: number, models: string, form?: Form) {
  const name = characters?.races.find((r) => r.race === race)?.name ?? `Race ${race}`
  return form ? `${name} ${FORM_LABELS[form]} Form` : `${name} ${sexLabel(sex)} ${models.toUpperCase()}`
}

export const FORM_LABELS: Record<Form, string> = { cat: 'Cat', bear: 'Bear', travel: 'Travel', moonkin: 'Moonkin' }

/** The race picker's druid form groups, after the factions: the races with each form, in the race list's order. */
export function formGroups(races: CharacterRace[], forms: FormLook[]): { form: Form; label: string; races: CharacterRace[] }[] {
  return FORMS
    .map((form) => ({ form, label: `Druid ${FORM_LABELS[form]}`, races: races.filter((r) => forms.some((f) => f.form === form && f.race === r.race)) }))
    .filter((g) => g.races.length > 0)
}

export function formChoiceLabel(choice: FormChoice, defaultChoiceId: number) {
  const notes = [...(choice.classic ? ['Classic'] : []), ...(choice.choiceId === defaultChoiceId ? ['default'] : [])]
  return notes.length ? `${choice.name} (${notes.join(', ')})` : choice.name
}

/** Picks the nearest available sex and model set when the race changes. */
export function pickCharacter(race: CharacterRace, sex: number, models: ModelSet): { sex: 0 | 1; models: ModelSet } | null {
  const usable = race.sexes.filter((s) => s.hd || s.sd)
  const s = usable.find((x) => x.sex === sex) ?? usable[0]
  if (!s) return null
  return { sex: s.sex, models: s[models] ? models : s.hd ? 'hd' : 'sd' }
}

export type Faction = NonNullable<CharacterRace['faction']>

/** Races grouped Alliance, then Horde, then anything else, each in the server's order. */
export function racesByFaction(races: CharacterRace[]): { faction: Faction; races: CharacterRace[] }[] {
  const order: Faction[] = ['alliance', 'horde', 'neutral']
  return order
    .map((faction) => ({ faction, races: races.filter((r) => (r.faction ?? 'neutral') === faction) }))
    .filter((g) => g.races.length > 0)
}

// Plain words for the game's animation names, by group, in the order the Animation list shows them. The
// look keeps the game's name (share links, the AI tools); only the list shows these.
const ANIMATIONS: [group: string, labels: Record<string, string>][] = [
  ['Movement', {
    Stand: 'Stand', Walk: 'Walk', Run: 'Run', Walkbackwards: 'Walk backwards', ShuffleLeft: 'Strafe left', ShuffleRight: 'Strafe right',
    Sprint: 'Sprint', JumpStart: 'Jump (take off)', Jump: 'Jump (in the air)', JumpEnd: 'Jump (land)', JumpLandRun: 'Jump (land into a run)',
  }],
  ['Casting', {
    ReadySpellDirected: 'Ready to cast (aimed)', ReadySpellOmni: 'Ready to cast (around)', SpellCastDirected: 'Cast (aimed)',
    SpellCastOmni: 'Cast (around)', ChannelCastDirected: 'Channel (aimed)', ChannelCastOmni: 'Channel (around)', Spell: 'Cast (quick)',
    SpellPrecast: 'Cast (wind-up)', SpellCast: 'Cast', SpellCastArea: 'Cast (area)',
  }],
  ['Melee', {
    Attack1H: 'Attack (one-hand)', Attack2H: 'Attack (two-hand)', Attack2HL: 'Attack (polearm or staff)', AttackOff: 'Attack (off hand)',
    Attack1HPierce: 'Stab (one-hand)', Attack2HLoosePierce: 'Thrust (polearm)', AttackUnarmed: 'Attack (unarmed)',
    AttackUnarmedOff: 'Attack (unarmed, off hand)', Special1H: 'Special attack (one-hand)', Special2H: 'Special attack (two-hand)',
    SpecialUnarmed: 'Special attack (unarmed)', ShieldBash: 'Shield bash', Kick: 'Kick', Whirlwind: 'Whirlwind', BattleRoar: 'Battle roar',
    Ready1H: 'Ready (one-hand)', Ready2H: 'Ready (two-hand)', Ready2HL: 'Ready (polearm or staff)', ReadyUnarmed: 'Ready (unarmed)',
    Parry1H: 'Parry (one-hand)', Parry2H: 'Parry (two-hand)', Parry2HL: 'Parry (polearm or staff)', ParryUnarmed: 'Parry (unarmed)',
    ShieldBlock: 'Block (shield)', Dodge: 'Dodge',
  }],
  ['Ranged', {
    ReadyBow: 'Ready (bow)', AttackBow: 'Shoot (bow)', ReadyRifle: 'Ready (gun or crossbow)', AttackRifle: 'Shoot (gun or crossbow)',
    ReadyThrown: 'Ready (thrown)', AttackThrown: 'Throw or shoot a wand',
  }],
  ['Druid forms', {
    DruidCatClaw: 'Claw', DruidCatRake: 'Rake', DruidCatRip: 'Rip', DruidCatPounce: 'Pounce', DruidCatRavage: 'Ravage',
    DruidBearMaul: 'Maul', DruidBearSwipe: 'Swipe', DruidBearBite: 'Bite', DruidBearBash: 'Bash',
  }],
  ['Stealth', { StealthStand: 'Stealth', StealthWalk: 'Stealth (walk)' }],
  ['Mounted and emotes', {
    Mount: 'Mounted', MountSpecial: 'Mounted (special)', EmoteWave: 'Wave', EmoteCheer: 'Cheer', EmoteDance: 'Dance', EmoteLaugh: 'Laugh', EmoteRoar: 'Roar',
  }],
]

/** The Animation list's groups, in order. Animations with no group of their own go under "Other". */
export const ANIMATION_GROUPS = [...ANIMATIONS.map(([g]) => g), 'Other']

/** Plain words for an animation: "SpellCastDirected" reads "Cast (aimed)"; a name with no label is split into words. */
export function animationLabel(name: string): string {
  for (const [, labels] of ANIMATIONS) if (labels[name]) return labels[name]
  return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
}

/** The group an animation is listed under. */
export function animationGroup(name: string): string {
  return ANIMATIONS.find(([, labels]) => name in labels)?.[0] ?? 'Other'
}

/** The order within a group: the order the labels are written in, then by label. */
export function animationOrder(name: string): number {
  for (const [, labels] of ANIMATIONS) { const i = Object.keys(labels).indexOf(name); if (i >= 0) return i }
  return Number.MAX_SAFE_INTEGER
}
