// Places the nameplate: an HTML label that follows a point above the character's head on screen.
import * as THREE from 'three'

/** Where `world` appears in a `width` x `height` view, in pixels from its top left; null when behind the camera. */
export function screenPoint(world: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number } | null {
  const v = world.clone().project(camera)
  if (v.z < -1 || v.z > 1) return null
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height }
}

// The name's size as a share of the character's height on screen (its box, which frame() fits): 32px for
// the 487px-tall character a 1440x900 window shows at the default framing (measured). Tied to the
// character, it follows the zoom and the view's size alike, so a phone's smaller view gets a smaller name.
export const NAME_SHARE = 32 / 487

/** The name's size in pixels, from the character's height and the view's height on screen. */
export function nameSize(characterPx: number, viewPx: number): number {
  return Math.min(viewPx * 0.13, Math.max(10, characterPx * NAME_SHARE))
}

// The bottom of the guild line sits about a fifth of the character's height on screen above the head, so the
// gap follows the zoom as in game. Each race's share is tuned by eye at the default framing: a Gnome's head
// sits low in its box, the tall races' high, and Orcs and Tauren are broad and stooped.
const GAP_SHARE = 0.208
const RACE_GAP: Record<number, number> = {
  1: GAP_SHARE * 0.8, // Human
  2: 0.272 * 0.8 * 1.452, // Orc
  4: GAP_SHARE * 0.8, // Night Elf
  6: 0.272, // Tauren
  7: GAP_SHARE * 1.5, // Gnome
  8: GAP_SHARE * 0.8, // Troll
}

/**
 * Where the nameplate goes, from the top of the head and the feet on screen: centred on x, its bottom edge
 * at `bottom`, a fixed share of the character's height above the head. Nothing moves it to fit: when that
 * is past the view's edge, the view clips it (.stage-cell), as the game's camera would.
 */
export function plateLayout(head: { x: number; y: number }, feet: { x: number; y: number }, race?: number): { x: number; bottom: number } {
  const height = Math.max(0, feet.y - head.y)
  const gap = (race !== undefined ? RACE_GAP[race] : undefined) ?? GAP_SHARE
  return { x: head.x, bottom: head.y - height * gap }
}
