// Places the nameplate: an HTML label that follows a point above the character's head on screen.
import * as THREE from 'three'

/** Where `world` appears in a `width` x `height` view, in pixels from its top left; null when behind the camera. */
export function screenPoint(world: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number } | null {
  const v = world.clone().project(camera)
  if (v.z < -1 || v.z > 1) return null
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height }
}

// The name's size at the default framing, the same for every race: the camera starts at a fixed multiple
// of the character's height (Stage.frame), so each race fills the view alike.
export const NAME_PX = 32

/** The name's size for a zoom (1 at the default framing, 2 twice as close): it keeps its size relative to the character. */
export function nameSize(zoom: number): number {
  return Math.min(96, Math.max(14, NAME_PX * zoom))
}

// Measured from an in-game screenshot (a High Warlord nameplate): the bottom of the guild line sits about
// a quarter of the character's height on screen above the head, so the gap follows the zoom as in game.
const GAP_SHARE = 0.26
// Orcs (2) and Tauren (6) are so broad and stooped that the same gap looks cramped on them.
const BIG_RACES = new Set([2, 6])
const BIG_RACE_EXTRA = 0.08
/**
 * Where the nameplate goes, from the top of the head and the feet on screen: centred on x, its bottom edge
 * at `bottom`, a fixed share of the character's height above the head. Nothing moves it to fit: when that
 * is past the view's edge, the view clips it (.stage-cell), as the game's camera would.
 */
export function plateLayout(head: { x: number; y: number }, feet: { x: number; y: number }, race?: number): { x: number; bottom: number } {
  const height = Math.max(0, feet.y - head.y)
  const gap = GAP_SHARE + (race !== undefined && BIG_RACES.has(race) ? BIG_RACE_EXTRA : 0)
  return { x: head.x, bottom: head.y - height * gap }
}
