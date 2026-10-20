import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { CLEARANCE, NAME_SHARE, apparentHeight, boxSkull, measureSkull, nameSize, plateAnchor, screenPoint, skullGeoset } from './nameplate'

describe('screenPoint', () => {
  const camera = new THREE.PerspectiveCamera(35, 2, 0.01, 100)
  camera.position.set(5, 1, 0)
  camera.lookAt(0, 1, 0)
  camera.updateMatrixWorld()

  test('a point the camera looks at lands in the middle of the cell', () => {
    const p = screenPoint(new THREE.Vector3(0, 1, 0), camera, 400, 200)!
    expect(p.x).toBeCloseTo(200)
    expect(p.y).toBeCloseTo(100)
  })

  test('a point above the target lands higher on screen', () => {
    expect(screenPoint(new THREE.Vector3(0, 1.5, 0), camera, 400, 200)!.y).toBeLessThan(100)
  })

  test('a point past the view\'s edge keeps its place off the view: the view clips it, nothing moves it', () => {
    expect(screenPoint(new THREE.Vector3(0, 3, 0), camera, 400, 200)!.y).toBeLessThan(0)
  })

  test('a point behind the camera has no place on screen', () => {
    expect(screenPoint(new THREE.Vector3(10, 1, 0), camera, 400, 200)).toBeNull()
  })
})

describe('skullGeoset', () => {
  test('is the skin and the face, not hair, ears, horns or other extras', () => {
    for (const g of [0, 3201, 3202]) expect(skullGeoset(g)).toBe(true)
    for (const g of [1, 2, 106, 202, 702, 2401, 3301, 3701, 3901]) expect(skullGeoset(g)).toBe(false)
  })
})

describe('measureSkull', () => {
  // Two bones, a root at the origin and a head 1.5 up, and one vertex buffer shared by every submesh,
  // as the converter writes it: this mesh draws vertices 0-3 only.
  const rig = () => {
    const root = new THREE.Bone(), head = new THREE.Bone()
    head.position.set(0.1, 1.5, 0.2)
    root.add(head)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 1.4, 0, // head, the chin
      0, 1.8, 0, // head, the crown
      0, 1.0, 0, // root: the chest
      0, 1.9, 0, // mostly root (0.6): a hat brim, say
      0, 2.5, 0, // head, but in another submesh
    ], 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 0.9, 0.1, 0, 0, 1, 0, 0, 0, 0.4, 0.6, 0, 0, 1, 0, 0, 0], 4))
    geometry.setIndex([0, 1, 2, 1, 2, 3])
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
    mesh.add(root)
    mesh.updateMatrixWorld(true)
    mesh.bind(new THREE.Skeleton([root, head]))
    return { mesh, head }
  }

  test('is the highest and lowest of the vertices the head bone carries most, over the head bone', () => {
    const { mesh, head } = rig()
    const skull = measureSkull([mesh], head)!
    expect(skull.top.y).toBeCloseTo(1.8)
    expect(skull.height).toBeCloseTo(0.4)
    expect(skull.top.x).toBeCloseTo(0.1)
    expect(skull.top.z).toBeCloseTo(0.2)
  })

  test('follows the pose, so a stooped head gives a lower skull', () => {
    const { mesh, head } = rig()
    head.position.y -= 0.3
    mesh.updateMatrixWorld(true)
    expect(measureSkull([mesh], head)!.top.y).toBeCloseTo(1.8 - 0.3 * 0.9) // the crown is 0.9 head
  })

  test('is null without vertices on the head bone', () => {
    const { mesh } = rig()
    expect(measureSkull([mesh], new THREE.Bone())).toBeNull()
  })
})

describe('plateAnchor', () => {
  test('puts the plate\'s bottom a share of the head\'s height above the skull, over the head', () => {
    const at = plateAnchor({ top: new THREE.Vector3(0.1, 2, 0.2), height: 0.25 })
    expect(at.x).toBeCloseTo(0.1)
    expect(at.y).toBeCloseTo(2 + 0.25 * CLEARANCE)
    expect(at.z).toBeCloseTo(0.2)
  })

  test('gives a big head more room: a Gnome\'s plate sits higher over its skull than a Human\'s', () => {
    // Measured from the bundle's HD male models (skull top, head height).
    const room = (top: number, height: number) => plateAnchor({ top: new THREE.Vector3(0, top, 0), height }).y - top
    expect(room(1.134, 0.363)).toBeGreaterThan(room(2.024, 0.262)) // Gnome, Human
  })

  test('without a skull, sits over the box top, with a head a tenth of the box\'s height', () => {
    const box = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.3), new THREE.Vector3(0.5, 2, 0.3))
    const at = plateAnchor(boxSkull(box))
    expect(at.x).toBeCloseTo(0)
    expect(at.y).toBeCloseTo(2 + 0.2 * CLEARANCE)
  })
})

describe('nameSize', () => {
  test('is a fixed share of the character\'s height on screen, so it follows the zoom and the view\'s size', () => {
    expect(nameSize(487, 725)).toBeCloseTo(487 * NAME_SHARE)
    expect(nameSize(974, 725)).toBeCloseTo(nameSize(487, 725) * 2)
  })

  test('a phone\'s smaller view gets a smaller name, not the desktop\'s', () => {
    // The default framing on a 1440x900 window and on a 390x844 phone (measured on altrobe.com).
    expect(nameSize(487, 725)).toBeCloseTo(32, 0)
    expect(nameSize(255, 379)).toBeLessThan(18)
  })

  test('stays readable zoomed far out and never swamps a close-up', () => {
    expect(nameSize(20, 725)).toBe(10)
    expect(nameSize(5000, 725)).toBeCloseTo(725 * 0.13)
  })
})

describe('apparentHeight', () => {
  const look = (from: THREE.Vector3) => {
    const camera = new THREE.PerspectiveCamera(35, 2, 0.01, 100)
    camera.position.copy(from)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    return camera
  }
  const head = new THREE.Vector3(0, 1, 0)

  test('matches the height on screen when the camera faces the character', () => {
    // A 2-yard character 5 yards away, seen head-on in a 900px-tall view.
    const camera = look(new THREE.Vector3(5, 1, 0))
    const top = screenPoint(new THREE.Vector3(0, 2, 0), camera, 1800, 900)!, bottom = screenPoint(new THREE.Vector3(0, 0, 0), camera, 1800, 900)!
    expect(apparentHeight(2, head, camera, 900)).toBeCloseTo(bottom.y - top.y, 0)
  })

  test('stays the same from above or below at the same distance, where the height on screen shrinks', () => {
    const side = apparentHeight(2, head, look(new THREE.Vector3(5, 1, 0)), 900)
    expect(apparentHeight(2, head, look(new THREE.Vector3(0.01, 6, 0)), 900)).toBeCloseTo(side, 2)
    expect(apparentHeight(2, head, look(new THREE.Vector3(0.01, -4, 0)), 900)).toBeCloseTo(side, 2)
  })

  test('halves when the camera is twice as far', () => {
    expect(apparentHeight(2, head, look(new THREE.Vector3(10, 1, 0)), 900)).toBeCloseTo(apparentHeight(2, head, look(new THREE.Vector3(5, 1, 0)), 900) / 2, 5)
  })
})
