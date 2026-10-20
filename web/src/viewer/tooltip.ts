// The character tooltip at the bottom right of the view: on hover, always, or never.
export type TooltipMode = 'hover' | 'always' | 'off'

export const TOOLTIP_MODES: { mode: TooltipMode; label: string }[] = [
  { mode: 'hover', label: 'On hover' }, { mode: 'always', label: 'Always' }, { mode: 'off', label: 'Off' },
]

/** On hover where the device can hover; off on touch screens, where a tap would leave it stuck open. */
export function defaultTooltipMode(canHover: boolean): TooltipMode {
  return canHover ? 'hover' : 'off'
}

export function tooltipClass(mode: TooltipMode): string {
  return mode === 'hover' ? 'unit-tooltip on-hover' : mode === 'always' ? 'unit-tooltip pinned' : 'unit-tooltip'
}
