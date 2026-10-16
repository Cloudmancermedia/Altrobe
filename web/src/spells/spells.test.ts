import { describe, expect, test } from 'vitest'
import type { SpellInfo, SpellKit } from '../api/types'
import { castPose } from './spells'

const model = (fileDataId: number, attachment: number) => ({ fileDataId, attachment, scale: 1, offset: [0, 0, 0], rotation: [0, 0, 0] })
const kit = (start: number, target: number, anim: number | null, ...models: ReturnType<typeof model>[]): SpellKit => ({ kit: start * 100 + target, start, end: start + 1, target, anim, models })
const spell = (kits: SpellKit[]): SpellInfo => ({ spellId: 1, name: 'x', classId: 8, ranks: [1], castMs: 1500, durationMs: 0, kits, missile: null })

describe('castPose', () => {
  test('a cast-time spell shows its precast: the charging pose and hand glows (Fireball)', () => {
    const fireball = spell([kit(1, 1, 51, model(166120, 21), model(166120, 22)), kit(3, 1, 53, model(166110, 21)), kit(6, 2, 9, model(166583, 34))])
    expect(castPose(fireball)).toEqual({ animId: 51, models: [model(166120, 21), model(166120, 22)] })
  })

  test('a channel shows its channel kit (Mind Flay); an instant its cast kit (Battle Shout)', () => {
    expect(castPose(spell([kit(3, 1, 124, model(1, 21)), kit(11, 2, 124, model(2, 21))]))).toEqual({ animId: 124, models: [model(2, 21)] })
    expect(castPose(spell([kit(3, 1, 55, model(165658, 19))]))).toEqual({ animId: 55, models: [model(165658, 19)] })
  })

  test('a hunter shot has no caster kit, so it plays the ranged attack for the weapon', () => {
    const arcaneShot = spell([kit(6, 2, null, model(166525, 34))])
    expect(castPose(arcaneShot)).toEqual({ animName: 'AttackBow', models: [] })
    expect(castPose(arcaneShot, 'AttackRifle')).toEqual({ animName: 'AttackRifle', models: [] })
  })
})
