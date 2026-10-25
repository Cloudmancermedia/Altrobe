import { expect, test } from 'vitest'
import { frameDistance } from './framing'

const tanH = 0.5

test('a character fits its height, or in a narrow cell its width, from the box\'s center', () => {
  expect(frameDistance({ x: 0.5, y: 2, z: 0.8 }, 'front', tanH, false)).toBeCloseTo(2 * 2.5)
  expect(frameDistance({ x: 0.5, y: 2, z: 6 }, 'front', tanH, false)).toBeCloseTo(6 * 1.25 / 2 / tanH)
})

test('a form is measured from the side facing the camera, so a long cat is not cut off', () => {
  const cat = { x: 3.5, y: 1.5, z: 1.2 }
  expect(frameDistance(cat, 'front', tanH, true) - frameDistance(cat, 'front', tanH, false)).toBeCloseTo(1.75)
  expect(frameDistance(cat, 'back', tanH, true) - frameDistance(cat, 'back', tanH, false)).toBeCloseTo(1.75)
  expect(frameDistance(cat, 'side', tanH, true) - frameDistance(cat, 'side', tanH, false)).toBeCloseTo(0.6)
})
