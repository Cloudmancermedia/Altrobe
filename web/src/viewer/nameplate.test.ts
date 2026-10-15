import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { NAME_PX, plateLayout, screenPoint } from './nameplate'

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

  test('a point behind the camera has no place on screen', () => {
    expect(screenPoint(new THREE.Vector3(10, 1, 0), camera, 400, 200)).toBeNull()
  })
})

describe('plateLayout', () => {
  // A 1000 x 1200 view and a 120 x 40 px nameplate.
  const view = { width: 1000, height: 1200 }
  const plate = { width: 120, height: 40 }

  test('sits above the head by the game\'s share of the character height', () => {
    const p = plateLayout({ x: 400, y: 600 }, { x: 400, y: 1000 }, view, plate)
    expect(p.x).toBe(400)
    expect(p.bottom).toBeCloseTo(600 - 400 * 0.26)
  })

  test('big races (Orc, Tauren) get extra room above the head; others do not', () => {
    const at = (race: number) => plateLayout({ x: 500, y: 400 }, { x: 500, y: 1000 }, view, plate, race).bottom
    expect(at(2)).toBeLessThan(at(1))
    expect(at(6)).toBeLessThan(at(5))
    expect(at(5)).toBeCloseTo(400 - 600 * 0.26)
  })

  test('stays inside the view: never past the left, right or top edge', () => {
    expect(plateLayout({ x: 10, y: 600 }, { x: 10, y: 1000 }, view, plate).x).toBe(60 + 4)
    expect(plateLayout({ x: 990, y: 600 }, { x: 990, y: 1000 }, view, plate).x).toBe(1000 - 60 - 4)
    // A close-up whose head is near the top would put the plate above the view.
    expect(plateLayout({ x: 500, y: 30 }, { x: 500, y: 2000 }, view, plate).bottom).toBe(40 + 4)
  })

  test('a plate wider than the view is centred on it', () => {
    expect(plateLayout({ x: 10, y: 600 }, { x: 10, y: 1000 }, { width: 100, height: 600 }, plate).x).toBe(50)
  })
})

describe('the name\'s size', () => {
  test('is one size for every race and zoom, as in the game', () => {
    expect(NAME_PX).toBeGreaterThanOrEqual(14)
    expect(plateLayout({ x: 500, y: 500 }, { x: 500, y: 540 }, { width: 1000, height: 1200 }, { width: 80, height: 30 })).not.toHaveProperty('fontSize')
  })
})

