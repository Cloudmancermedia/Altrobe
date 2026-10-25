// Places the nameplate: an HTML label that follows a point above the character's head on screen.
import * as THREE from 'three'

/** Where `world` appears in a `width` x `height` view, in pixels from its top left; null when behind the camera. */
export function screenPoint(world: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number } | null {
  const v = world.clone().project(camera)
  if (v.z < -1 || v.z > 1) return null
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height }
}

/**
 * How tall a `worldHeight` character at `at` looks in a `viewPx`-tall view, from the camera's distance
 * alone. Unlike its height on screen, it doesn't shrink when the camera looks down or up at the character.
 */
export function apparentHeight(worldHeight: number, at: THREE.Vector3, camera: THREE.PerspectiveCamera, viewPx: number): number {
  const depth = -at.clone().applyMatrix4(camera.matrixWorldInverse).z
  if (depth <= 0) return 0
  return worldHeight * viewPx / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
}

// The name's size as a share of the character's height on screen (its box, which frame() fits): 32px for
// the 487px-tall character a 1440x900 window shows at the default framing (measured). Tied to the
// character, it follows the zoom and the view's size alike, so a phone's smaller view gets a smaller name.
export const NAME_SHARE = 32 / 487

/** The name's size in pixels, from the character's height and the view's height on screen. */
export function nameSize(characterPx: number, viewPx: number): number {
  return Math.min(viewPx * 0.13, Math.max(10, characterPx * NAME_SHARE))
}

/** The top of the skull, over the head bone, and the head's own height, both in world units. */
export interface Skull {
  top: THREE.Vector3
  height: number
}

/** The geosets the skull is measured on: the skin (0) and the face (32xx), not hair, ears, horns or helmets. */
export function skullGeoset(geosetId: number): boolean {
  return geosetId === 0 || Math.floor(geosetId / 100) === 32
}

/**
 * The skull in the pose the meshes are in: the highest and lowest of the vertices whose biggest skin
 * weight is `head`, over the head bone. Only the vertices each mesh draws count, since every submesh
 * shares one vertex buffer. Null when no vertex rides on `head`.
 */
export function measureSkull(meshes: THREE.SkinnedMesh[], head: THREE.Object3D): Skull | null {
  let top = -Infinity, bottom = Infinity
  const v = new THREE.Vector3()
  for (const mesh of meshes) {
    const joint = mesh.skeleton.bones.indexOf(head as THREE.Bone)
    const index = mesh.geometry.index
    if (joint < 0 || !index) continue
    const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    for (let k = 0; k < index.count; k++) {
      const i = index.getX(k)
      let best = 0
      for (let c = 1; c < 4; c++) if (weights.getComponent(i, c) > weights.getComponent(i, best)) best = c
      if (joints.getComponent(i, best) !== joint) continue
      const y = mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).y
      top = Math.max(top, y)
      bottom = Math.min(bottom, y)
    }
  }
  if (top === -Infinity) return null
  const at = head.getWorldPosition(new THREE.Vector3())
  return { top: new THREE.Vector3(at.x, top, at.z), height: top - bottom }
}

/** Without a head bone: the box top, and a head a tenth of the box's height, about what the models measure. */
export function boxSkull(box: THREE.Box3): Skull {
  const center = box.getCenter(new THREE.Vector3())
  return { top: new THREE.Vector3(center.x, box.max.y, center.z), height: (box.max.y - box.min.y) * 0.1 }
}

// The bottom of the guild line sits this many head heights above the skull. Measured on every model in the
// bundle, 1.4 puts it where the per-race shares tuned by eye did, on average; a Gnome's big head now
// gets more room, an Orc's less.
export const CLEARANCE = 1.4

// Models whose hair, horns or ears stand well above the skull, which the skull leaves out, so the shared
// clearance left them the least room: by race and sex ("race-sex"). Tuned on 2026-10-21 by measuring the
// gap between the guild line and the head on every model, to bring these near the others. On 2026-10-24
// the maintainer found Orcs, Undead, Trolls, Tauren and Dwarves still too close, so each of those got 1.5
// times its room.
const MODEL_CLEARANCE: Record<string, number> = {
  '2-0': 2.1, // Orc male
  '2-1': 3.0, // Orc female
  '5-0': 2.1, // Undead male
  '5-1': 2.55, // Undead female
  '8-0': 3.45, // Troll male
  '8-1': 2.1, // Troll female
  '6-0': 2.7, // Tauren male
  '6-1': 2.1, // Tauren female
  '3-0': 2.1, // Dwarf male
  '3-1': 2.1, // Dwarf female
  '95-0': 1.7, // High Order Skyborne male
  '96-0': 1.7, // Windshaper Skyborne male
}

/** The clearance for a model, in head heights above its skull. */
export function clearanceFor(race: number, sex: number): number {
  return MODEL_CLEARANCE[`${race}-${sex}`] ?? CLEARANCE
}

/** Where the nameplate's bottom edge goes in the world: over the head, a clearance above the skull. */
export function plateAnchor(skull: Skull, clearance = CLEARANCE): THREE.Vector3 {
  return skull.top.clone().add(new THREE.Vector3(0, skull.height * clearance, 0))
}
