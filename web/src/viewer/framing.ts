// How far the camera stands from a character to fit it in its view.
import type { View } from '../look/look'

const FRAME_DISTANCE = 2.5

/**
 * Far enough to fit the height, and in a narrow cell (five or six side by side) the width too. Models face
 * +X, so the side-to-side width is the Z extent; the box is the bare body, so allow a little more for
 * shoulder pads. A character is measured from its center; a druid form from the side facing the camera,
 * since a cat or a bear is far longer than it is wide.
 * @param tanH  tan of half the camera's horizontal field of view
 */
export function frameDistance(size: { x: number; y: number; z: number }, view: View, tanH: number, form: boolean): number {
  const fit = Math.max(size.y * FRAME_DISTANCE, (size.z * 1.25 / 2) / tanH)
  return form ? fit + (view === 'side' ? size.z : size.x) / 2 : fit
}
