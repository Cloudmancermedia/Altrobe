// Places the nameplate: an HTML label that follows a point above the character's head on screen.
import * as THREE from 'three'

/** Where `world` appears in a `width` x `height` view, in pixels from its top left; null when behind the camera. */
export function screenPoint(world: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number } | null {
  const v = world.clone().project(camera)
  if (v.z < -1 || v.z > 1) return null
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height }
}

// The game draws names at one size on screen, whatever the race or the camera distance. Set in App.css
// (.nameplate); kept here for the tests.
export const NAME_PX = 16

// Measured from an in-game screenshot (a High Warlord nameplate): the bottom of the guild line sits about
// a quarter of the character's height on screen above the head, so the gap follows the zoom as in game.
const GAP_SHARE = 0.26
// Orcs (2) and Tauren (6) are so broad and stooped that the same gap looks cramped on them.
const BIG_RACES = new Set([2, 6])
const BIG_RACE_EXTRA = 0.08
// Space kept between the nameplate and the view's edges.
const MARGIN = 4

/**
 * Where the nameplate goes, from the top of the head and the feet on screen: centred on x, its bottom edge
 * at `bottom`, kept inside the `view` for a nameplate of `plate` size (centred when wider than the view).
 */
export function plateLayout(
  head: { x: number; y: number }, feet: { x: number; y: number },
  view: { width: number; height: number }, plate: { width: number; height: number }, race?: number,
): { x: number; bottom: number } {
  const height = Math.max(0, feet.y - head.y)
  const gap = GAP_SHARE + (race !== undefined && BIG_RACES.has(race) ? BIG_RACE_EXTRA : 0)
  const half = plate.width / 2 + MARGIN
  const x = plate.width + 2 * MARGIN >= view.width ? view.width / 2 : Math.min(view.width - half, Math.max(half, head.x))
  return { x, bottom: Math.max(plate.height + MARGIN, head.y - height * gap) }
}
