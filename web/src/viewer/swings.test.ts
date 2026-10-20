import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { playInTurn } from './swings'

const clip = (name: string, seconds: number) =>
  new THREE.AnimationClip(name, seconds, [new THREE.VectorKeyframeTrack('.position', [0, seconds], [0, 0, 0, 1, 0, 0])])

describe('playInTurn', () => {
  test('plays each swing once, then the next, and back to the first', () => {
    const mixer = new THREE.AnimationMixer(new THREE.Object3D())
    const [a, b] = [clip('anim_17_0', 1), clip('anim_17_1', 1.2)]
    playInTurn(mixer, [a, b])
    const running = () => [a, b].filter((c) => mixer.existingAction(c)?.isRunning()).map((c) => c.name)
    mixer.update(0.5)
    expect(running()).toEqual(['anim_17_0'])
    mixer.update(0.6)
    expect(running()).toEqual(['anim_17_1'])
    mixer.update(1.3)
    expect(running()).toEqual(['anim_17_0'])
  })

  test('a single clip simply loops', () => {
    const mixer = new THREE.AnimationMixer(new THREE.Object3D())
    const run = clip('anim_5_0', 1)
    playInTurn(mixer, [run])
    mixer.update(2.5)
    expect(mixer.existingAction(run)?.isRunning()).toBe(true)
  })

  test('another clip looping on the same mixer does not move the swings on', () => {
    const mixer = new THREE.AnimationMixer(new THREE.Object3D())
    const [a, b] = [clip('anim_17_0', 1), clip('anim_17_1', 1)]
    playInTurn(mixer, [a, b])
    mixer.clipAction(clip('Global_0', 0.1)).play()
    mixer.update(0.5)
    expect(mixer.existingAction(a)?.isRunning()).toBe(true)
  })
})
