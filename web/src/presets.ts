// One-click animations under the Animation list, for what people pick most. Each button reads as the
// list labels its animation (labels.ts), so the two match.

import type { AnimationInfo } from './api/types'
import { animationLabel } from './labels'
import type { Form } from './look/look'

/** Item.SubclassID of a polearm and a staff (ItemCatalog.WeaponTypes). These swing with Attack2HL. */
export const POLEARM = 6
export const STAFF = 10
/** Item.SubclassID of the ranged weapons the shot follows: a gun or crossbow fires with AttackRifle. */
export const BOW = 2
export const GUN = 3
export const CROSSBOW = 18

export interface AnimationPreset {
  label: string
  /** The game's animation name, as `commands.set_animation` takes it. */
  animation: string
}

/**
 * The presets the model has animations for, Stand first to get back to the start. The two-hand attack
 * follows the main hand: Attack2HL for a staff or polearm (`mainHandSubclass`), Attack2H for anything
 * else. The shot follows the ranged slot: AttackRifle for a gun or crossbow, AttackBow otherwise.
 */
export function animationPresets(animations: AnimationInfo[], mainHandSubclass?: number, rangedSubclass?: number, form?: Form): AnimationPreset[] {
  const twoHand = mainHandSubclass === STAFF || mainHandSubclass === POLEARM ? 'Attack2HL' : 'Attack2H'
  const shot = rangedSubclass === GUN || rangedSubclass === CROSSBOW ? 'AttackRifle' : 'AttackBow'
  return (form ? FORM_PRESETS[form] : ['Stand', 'SpellCastDirected', 'SpellCastOmni', 'Run', 'Attack1H', twoHand, shot])
    .filter((name) => animations.some((a) => a.name === name))
    .map((animation) => ({ label: animationLabel(animation), animation }))
}

// A druid form's buttons: its named attacks, and for the cat, prowling.
const FORM_PRESETS: Record<Form, string[]> = {
  cat: ['Stand', 'Run', 'StealthWalk', 'DruidCatClaw', 'DruidCatRake', 'DruidCatRip', 'DruidCatPounce', 'DruidCatRavage'],
  bear: ['Stand', 'Run', 'DruidBearMaul', 'DruidBearSwipe', 'DruidBearBite', 'DruidBearBash', 'BattleRoar'],
  travel: ['Stand', 'Walk', 'Run', 'Sprint', 'Jump'],
  moonkin: ['Stand', 'Run', 'SpellCastDirected', 'SpellCastOmni', 'EmoteRoar', 'EmoteDance'],
}
