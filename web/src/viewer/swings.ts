import * as THREE from 'three'

/**
 * Plays an animation's clips in turn: each once, then the next, round and round. An auto-attack's file
 * holds every swing the model has (two or three), and the game alternates them; any other file has one
 * clip, which simply loops.
 */
export function playInTurn(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): void {
  const actions = clips.map((c) => mixer.clipAction(c))
  actions[0]?.play()
  if (actions.length < 2) return
  let at = 0
  mixer.addEventListener('loop', (e) => {
    if (e.action !== actions[at]) return
    actions[at].stop()
    at = (at + 1) % actions.length
    actions[at].reset().play()
  })
}
