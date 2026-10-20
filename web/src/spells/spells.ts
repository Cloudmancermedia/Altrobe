import type { SpellInfo, SpellModel } from '../api/types'

// Visual events (SpellVisualEvent.StartEvent): 1 precast, 3 cast, 11 channel (Phase 3 — Spell Casts Spec).
const PRECAST = 1, CAST = 3, CHANNEL = 11
const CASTER = 1

export interface CastPose {
  /** The animation to loop, by AnimationData ID; or, for a hunter shot, by name. */
  animId?: number
  animName?: string
  /** Models hung on the caster's body while it plays. */
  models: SpellModel[]
}

/**
 * What a character casting `spell` looks like, held on a loop (Step 1): the precast while the cast bar
 * fills (Fireball's charging pose and hand flames), else the channel (Mind Flay), else the cast itself
 * (Battle Shout). A hunter shot's visual has no caster kit, so the character plays the ranged attack for
 * its weapon, `rangedAttack` (AttackBow when unknown).
 */
export function castPose(spell: SpellInfo, rangedAttack: 'AttackBow' | 'AttackRifle' = 'AttackBow'): CastPose {
  const shows = (k: SpellInfo['kits'][number]) => k.anim !== null || k.models.length > 0
  const pose = spell.kits.find((k) => k.start === PRECAST && k.target === CASTER && shows(k))
    ?? spell.kits.find((k) => k.start === CHANNEL && shows(k))
    ?? spell.kits.find((k) => k.start === CAST && k.target === CASTER && shows(k))
  if (!pose) return { animName: rangedAttack, models: [] }
  return { ...(pose.anim !== null ? { animId: pose.anim } : {}), models: pose.models }
}
