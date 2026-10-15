import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { NAME_PX, nameSize, plateLayout, screenPoint } from './nameplate'

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
  test('sits a fixed share of the character\'s height above the head', () => {
    const p = plateLayout({ x: 400, y: 600 }, { x: 400, y: 1000 })
    expect(p.x).toBe(400)
    expect(p.bottom).toBeCloseTo(600 - 400 * 0.208)
  })

  test('big races (Orc, Tauren) get extra room above the head; others do not', () => {
    expect(plateLayout({ x: 0, y: 400 }, { x: 0, y: 1000 }, 2).bottom).toBeCloseTo(400 - 600 * (0.208 + 0.064))
    const at = (race: number) => plateLayout({ x: 500, y: 400 }, { x: 500, y: 1000 }, race).bottom
    expect(at(2)).toBeLessThan(at(1))
    expect(at(6)).toBeLessThan(at(5))
    expect(at(5)).toBeCloseTo(400 - 600 * 0.208)
  })

  test('stays above the head even when that is off the view: the view clips it, nothing moves it', () => {
    // A close-up: the head near the top edge puts the plate above the view, and a character at the
    // left edge puts it partly past that edge.
    expect(plateLayout({ x: 500, y: 30 }, { x: 500, y: 2000 }).bottom).toBeCloseTo(30 - 1970 * 0.208)
    expect(plateLayout({ x: 5, y: 600 }, { x: 5, y: 1000 }).x).toBe(5)
  })
})

describe('nameSize', () => {
  test('every race gets the same size at the default framing, and it follows the zoom from there', () => {
    expect(NAME_PX).toBe(32)
    expect(nameSize(1)).toBe(NAME_PX)
    expect(nameSize(2)).toBe(NAME_PX * 2)
    expect(nameSize(0.75)).toBe(NAME_PX * 0.75)
  })

  test('stays readable zoomed far out and never swamps a close-up', () => {
    expect(nameSize(0.1)).toBe(14)
    expect(nameSize(10)).toBe(96)
  })
})
