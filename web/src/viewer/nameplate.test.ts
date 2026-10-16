import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { NAME_SHARE, nameSize, plateLayout, screenPoint } from './nameplate'

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

  test('each race has its own gap, tuned by eye: Gnomes higher, the tall races lower', () => {
    const gap = (race?: number) => (400 - plateLayout({ x: 0, y: 400 }, { x: 0, y: 1000 }, race).bottom) / 600
    expect(gap()).toBeCloseTo(0.208)
    expect(gap(7)).toBeCloseTo(0.208 * 1.5) // Gnome
    for (const race of [1, 4, 8]) expect(gap(race)).toBeCloseTo(0.208 * 0.8) // Human, Night Elf, Troll
    expect(gap(2)).toBeCloseTo(0.272 * 0.8 * 1.452) // Orc: lowered 20%, then raised by eye in the preview (x1.2, x1.1, x1.1)
    expect(gap(6)).toBeCloseTo(0.272) // Tauren
    for (const race of [3, 5, 95, 96]) expect(gap(race)).toBeCloseTo(0.208) // Dwarf, Undead, Skyborne
  })

  test('stays above the head even when that is off the view: the view clips it, nothing moves it', () => {
    // A close-up: the head near the top edge puts the plate above the view, and a character at the
    // left edge puts it partly past that edge.
    expect(plateLayout({ x: 500, y: 30 }, { x: 500, y: 2000 }).bottom).toBeCloseTo(30 - 1970 * 0.208)
    expect(plateLayout({ x: 5, y: 600 }, { x: 5, y: 1000 }).x).toBe(5)
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
