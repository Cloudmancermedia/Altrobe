import { useEffect, useRef, useState } from 'react'
import { animUrl, modelUrl, textureUrl } from '../api/client'
import type { ResolvedItem } from '../api/types'
import type { Look, View } from '../look/look'
import { buildCharacter, type AssetUrls } from './character'
import { prepareCharacter, type CharacterSpec } from './prepare'
import { tooltipClass, type TooltipMode } from './tooltip'
import { Stage, type StageView } from './stage'

export interface ViewerCell {
  key: string
  label: string
  spec: CharacterSpec
  main: boolean
  /** The character's own outfit; without it, the cell wears the look's main outfit. */
  outfit?: Pick<Look, 'items' | 'hide'>
  /** Its weapons put away, and one-handers on the back rather than the hip. */
  sheathed?: boolean
  sheatheOnBack?: boolean
  /** Customization choices for this cell's body model. The main cell uses the look's own. */
  custom?: Record<string, number>
  /** The animation this character plays; none stands. */
  anim?: string
  /** The nameplate over the head and the tooltip lines (the first is the name). */
  identity?: { plate: { name: string; guild?: string; pvp: boolean } | null; tooltip: string[]; pvp: boolean; tooltipMode: TooltipMode }
}

interface ViewerProps {
  cells: ViewerCell[]
  look: Look
  itemSpeed?: number
  onNotices: (cellKey: string, notices: string[]) => void
  onResolved?: (items: ResolvedItem[]) => void
  onStage?: (stage: Stage | null) => void
  /** The character the panels edit, by position (0 the main one); clicking a view picks it. */
  selected?: number
  /** Turn every character slowly. */
  autoRotate?: boolean
  onSelect?: (index: number) => void
}

/** Hosts the shared three.js stage and one view per character. */
export function Viewer({ cells, look, itemSpeed, onNotices, onResolved, onStage, selected = 0, onSelect, autoRotate = false }: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState<Stage | null>(null)

  useEffect(() => {
    const s = new Stage(canvasRef.current!)
    setStage(s)
    onStage?.(s)
    return () => { onStage?.(null); s.dispose() }
    // The stage lives as long as the component; onStage is a notification only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (stage) stage.autoRotate = autoRotate }, [stage, autoRotate])

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />
      <div className={`stage-grid count-${cells.length}`}>
        {stage && cells.map((c, i) => (
          <StageCell key={c.key} stage={stage} cell={c} count={cells.length} look={look} itemSpeed={itemSpeed} onNotices={onNotices} onResolved={onResolved}
            selected={cells.length > 1 && i === selected} onSelect={cells.length > 1 && onSelect ? () => onSelect(i) : undefined} />
        ))}
      </div>
    </div>
  )
}

const assets = (build: string): AssetUrls => ({
  model: (fdid, ext) => modelUrl(build, fdid, ext),
  texture: (fdid) => textureUrl(build, fdid),
  anim: (fdid, animId) => animUrl(build, fdid, animId),
})

type CellState = { key: string; state: 'ready' | 'error' }

function StageCell({ stage, cell, count, look, itemSpeed, onNotices, onResolved, selected, onSelect }: {
  stage: Stage; cell: ViewerCell; count: number; look: Look; itemSpeed?: number
  onNotices: ViewerProps['onNotices']; onResolved: ViewerProps['onResolved']
  selected: boolean; onSelect?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plateRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<StageView | null>(null)
  const [done, setDone] = useState<CellState | null>(null)
  const framedSpec = useRef<string | null>(null)
  const camView = look.cam.view
  const camViewRef = useRef<View>(camView)
  useEffect(() => { camViewRef.current = camView }, [camView])

  useEffect(() => {
    const v = stage.addView(ref.current!)
    setView(v)
    return () => stage.removeView(v)
  }, [stage])

  // The stage moves the nameplate every frame; React only fills in its text.
  const plate = cell.identity?.plate ?? null
  useEffect(() => {
    if (!view) return
    view.nameplate = plate ? plateRef.current : null
    return () => { view.nameplate = null }
  }, [view, plate])

  const specKey = `${cell.spec.race}:${cell.spec.sex}:${cell.spec.models}`
  // Only what changes the dressed result; camera moves do not rebuild the character.
  const worn = cell.outfit ?? look
  const custom = cell.main ? look.custom : cell.custom ?? {}
  const outfitKey = JSON.stringify([worn.items, worn.hide, custom, cell.main ? look.build : null, cell.anim ?? null, cell.sheathed ?? false, cell.sheatheOnBack ?? false])
  const loadKey = `${specKey}|${outfitKey}|${itemSpeed}`
  const state = done?.key === loadKey ? done.state : 'loading'

  useEffect(() => {
    if (!view) return
    let cancelled = false
    ;(async () => {
      const prepared = await prepareCharacter(cell.spec, { ...look, items: worn.items, hide: worn.hide, sheathed: cell.sheathed, sheatheOnBack: cell.sheatheOnBack, custom }, cell.main)
      if (cancelled) return
      onResolved?.(prepared.resolved)
      // The look names an animation; each character plays it if its body model has it, else stands.
      const animNotices: string[] = []
      const anim = cell.anim ? prepared.baseLook.animations?.find((a) => a.name.toLowerCase() === cell.anim!.toLowerCase()) : undefined
      if (cell.anim && !anim) animNotices.push(`${cell.label} has no ${cell.anim} animation; it stands`)
      const character = await buildCharacter({ baseLook: prepared.baseLook, dressed: prepared.dressed, assets: assets(prepared.baseLook.build), itemSpeed, animId: anim?.id })
      if (cancelled) { character.dispose(); return }
      const reframe = framedSpec.current !== specKey
      framedSpec.current = specKey
      view.setCharacter(character, reframe ? camViewRef.current : null)
      onNotices(cell.key, [...prepared.notices, ...animNotices, ...character.notices])
      setDone({ key: loadKey, state: 'ready' })
    })().catch((e: Error) => {
      if (cancelled) return
      onNotices(cell.key, [`could not show ${cell.label}: ${e.message}`])
      setDone({ key: loadKey, state: 'error' })
    })
    return () => { cancelled = true }
    // look is read through outfitKey (part of loadKey); the callbacks are notifications only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loadKey])

  // A new camera view, or a new cell size when characters are added or removed, frames again. The
  // frame after layout has the new size.
  useEffect(() => {
    if (!view || !framedSpec.current) return
    const id = requestAnimationFrame(() => view.frame(camView))
    return () => cancelAnimationFrame(id)
  }, [view, camView, count])

  // A click picks the character; a drag turns the camera, so a press that moves is no click.
  const press = useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      ref={ref}
      className={`stage-cell${selected ? ' selected' : ''}`}
      tabIndex={0}
      role="img"
      aria-label={`${cell.label} in ${cell.outfit ? 'its own' : 'the current'} outfit${selected ? ', selected for editing' : ''}. Drag to turn, scroll to zoom, arrow keys to pan${onSelect ? ', Enter to edit this character' : ''}.`}
      data-cell={cell.key}
      data-state={state}
      onPointerDown={(e) => { press.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={(e) => {
        const p = press.current
        press.current = null
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) onSelect?.()
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.() }}
    >
      <span className="cell-label">{cell.label}</span>
      {plate && (
        <div ref={plateRef} className={`nameplate${plate.pvp ? ' pvp' : ''}`} aria-hidden="true">
          <div>{plate.name}</div>
          {plate.guild && <div>{plate.guild}</div>}
        </div>
      )}
      {cell.identity && cell.identity.tooltip.length > 0 && (
        <div className={tooltipClass(cell.identity.tooltipMode)} role="tooltip">
          {cell.identity.tooltip.map((line, i) => (
            <div key={i} className={i === 0 ? `tooltip-name${cell.identity!.pvp ? ' pvp' : ''}` : undefined}>{line}</div>
          ))}
        </div>
      )}
      {state === 'loading' && <span className="cell-status">Loading…</span>}
      {state === 'error' && <span className="cell-status error">Could not show this character</span>}
    </div>
  )
}
