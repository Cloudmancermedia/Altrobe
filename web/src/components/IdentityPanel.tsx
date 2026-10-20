import { useEffect, useState } from 'react'
import { getNames, hostedPrompt } from '../api/client'
import type { CharactersResponse, RaceNames, TitleInfo } from '../api/types'
import { commands, store } from '../app-state'
import { setAnyClass, setShortlist, useStore } from '../store'
import { useTitles } from '../hooks'
import { classChoices, titlesFor } from '../identity/identity'
import { fallbackIdeas, generateName, styleExamples } from '../identity/names'
import { getMoreNames } from '../identity/more-names'
import { addToShortlist, MAX_LETTERS, MAX_STYLE, nameProblems, removeFromShortlist, suggestPrompt, type FallbackReason, type NamePair } from '../identity/name-rules'
import { TOOLTIP_MODES, type TooltipMode } from '../viewer/tooltip'
import { MAX_GUILD, MAX_LEVEL, type Look } from '../look/look'
import { aiCommandNote } from '../assistant/hosted'

/**
 * A text box over a look field. The look keeps the text trimmed (share links drop end spaces), so the box
 * keeps its own copy of what was typed: a space typed at the end stays until the next letter arrives.
 * A change from elsewhere (Generate name, opening a look) replaces the copy.
 */
function TextField({ id, maxLength, value, onChange, describedBy }: { id: string; maxLength: number; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (value !== draft.trim()) setDraft(value)
  }
  return <input id={id} maxLength={maxLength} value={draft} aria-describedby={describedBy} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value) }} />
}

/** What a name breaks, under its field. A hint only: Forever's rules are assumed, so typing is never blocked. */
function NameHint({ id, name }: { id: string; name: string }) {
  const problems = nameProblems(name)
  return problems.length ? <p id={id} className="small name-hint">{problems.join('. ')}.</p> : null
}

/** A list of name pairs, each with its own actions. */
function NameList({ label, pairs, actions }: { label: string; pairs: NamePair[]; actions: (p: NamePair) => React.ReactNode }) {
  return (
    <ul className="name-list small" aria-label={label}>
      {pairs.map((p) => <li key={`${p.firstName} ${p.lastName}`}><span>{p.firstName} {p.lastName}</span> {actions(p)}</li>)}
    </ul>
  )
}

/** Under Suggest names: it spends the Ask box's daily commands, with the count once the box has one. */
function AiNote() {
  const quota = useStore(store, (s) => s.aiQuota)
  const busy = useStore(store, (s) => s.aiBusy)
  return <p className="muted small ai-note">{busy ? 'The AI is working on a request in Ask; this waits until it finishes.' : aiCommandNote(quota)}</p>
}

/** Name, title, guild, level, class and PvP flag: who the character is, shown over its head and in its tooltip. */
export function IdentityPanel({ characters, look, tooltipMode, onTooltipMode }: {
  characters: CharactersResponse; look: Look; tooltipMode: TooltipMode; onTooltipMode: (mode: TooltipMode) => void
}) {
  const race = characters.races.find((r) => r.race === look.race)
  const titles = titlesFor(useTitles(), race?.faction)
  // A rank from the other faction (after a race change) can't be held, so it goes.
  const titleOk = !look.identity?.titleId || titles.length === 0 || titles.some((t) => t.titleId === look.identity!.titleId)
  useEffect(() => { if (!titleOk) commands.set_identity({ titleId: null }) }, [titleOk])
  const [names, setNames] = useState<Record<string, RaceNames>>({})
  useEffect(() => { getNames().then(setNames, () => setNames({})) }, [])
  const [more, setMore] = useState<Record<string, RaceNames>>({})
  useEffect(() => { getMoreNames().then(setMore, () => setMore({})) }, [])
  // Where the generator is in its sequence. It starts somewhere random; each press moves one step.
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [keep, setKeep] = useState({ first: false, last: false })
  const raceNames = names[String(look.race)]
  const moreNames = more[String(look.race)]
  const id = look.identity ?? {}
  const anyClass = useStore(store, (s) => s.anyClass)
  const classes = classChoices(characters, look.race, anyClass)
  // A class the race can't be (after a race change) goes, unless any class is allowed.
  const classOk = !look.identity?.classId || classes.some((c) => c.classId === look.identity!.classId)
  useEffect(() => { if (!classOk) commands.set_identity({ classId: null }) }, [classOk])
  const wording = (t: TitleInfo) => (look.sex === 1 ? t.female : t.male).replace('%s', '…')
  const shortlist = useStore(store, (s) => s.shortlist)
  const ideas = useStore(store, (s) => s.nameIdeas)
  const ideasNote = useStore(store, (s) => s.nameIdeasNote)
  const aiBusy = useStore(store, (s) => s.aiBusy)
  const askDone = useStore(store, (s) => s.askDone)
  const [style, setStyle] = useState('')
  // The request this panel sent to the prompt box and is waiting on, with the style it carried.
  const [waiting, setWaiting] = useState<{ n: number; styled: boolean } | null>(null)
  const pair = id.firstName && id.lastName ? { firstName: id.firstName, lastName: id.lastName } : null
  const use = (p: NamePair) => commands.set_identity({ firstName: p.firstName, lastName: p.lastName })
  const save = (p: NamePair) => setShortlist(store, addToShortlist(store.get().shortlist, p))
  // The lists' five, when there's no AI here or the prompt box couldn't answer; or the rest, when the AI
  // gave fewer than five.
  const fromLists = (reason: FallbackReason, styled: boolean) => {
    const next = seed + 1
    setSeed(next)
    // The panel cleared the suggestions when it asked, so any showing now are the AI's from this request.
    const have = reason === 'none' ? [] : store.get().nameIdeas
    const { ideas, note } = fallbackIdeas(raceNames, moreNames, look.sex, next, have, reason, styled)
    store.set({ nameIdeas: ideas, nameIdeasNote: note })
  }
  const suggest = () => {
    if (!hostedPrompt) return fromLists('none', false)
    const cls = id.classId ? classes.find((c) => c.classId === id.classId)?.name : undefined
    const examples = raceNames ? styleExamples(raceNames, look.sex, seed) : []
    const n = (store.get().ask?.n ?? 0) + 1
    setWaiting({ n, styled: !!style.trim() })
    store.set({ nameIdeas: [], nameIdeasNote: null, ask: { text: suggestPrompt(race?.name ?? 'WoW', look.sex, cls, { style, examples }), n, creative: true } })
  }
  // AI names when the model gave some; the lists otherwise. A stopped command just stops.
  useEffect(() => {
    if (!waiting || askDone?.n !== waiting.n) return
    setWaiting(null)
    const got = store.get().nameIdeas.length
    if (askDone.kind === 'stopped' || (askDone.kind === 'done' && got >= 5)) return
    fromLists(askDone.kind !== 'done' ? askDone.kind : got ? 'short' : 'empty', waiting.styled)
    // fromLists reads this render's lists and seed; only the answer should run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askDone, waiting])

  return (
    <section className="panel" aria-labelledby="identity-heading">
      <h2 id="identity-heading">Identity</h2>
      <div className="picker">
        <label htmlFor="id-first">First name</label>
        <TextField id="id-first" maxLength={MAX_LETTERS} value={id.firstName ?? ''} describedBy="id-first-hint" onChange={(v) => commands.set_identity({ firstName: v })} />
      </div>
      <NameHint id="id-first-hint" name={id.firstName ?? ''} />
      <div className="picker">
        <label htmlFor="id-last">Last name</label>
        <TextField id="id-last" maxLength={MAX_LETTERS} value={id.lastName ?? ''} describedBy="id-last-hint" onChange={(v) => commands.set_identity({ lastName: v })} />
      </div>
      <NameHint id="id-last-hint" name={id.lastName ?? ''} />
      {raceNames && (
        <div className="actions">
          <button type="button" onClick={() => {
            const next = seed + 1
            setSeed(next)
            commands.set_identity(generateName(raceNames, look.sex, next, {
              ...(keep.first && id.firstName ? { firstName: id.firstName } : {}),
              ...(keep.last && id.lastName ? { lastName: id.lastName } : {}),
            }, moreNames))
          }}>Generate name</button>
          <label className="small"><input type="checkbox" checked={keep.first} onChange={(e) => setKeep({ ...keep, first: e.target.checked })} /> Keep first</label>
          <label className="small"><input type="checkbox" checked={keep.last} onChange={(e) => setKeep({ ...keep, last: e.target.checked })} /> Keep last</label>
        </div>
      )}
      {hostedPrompt && (
        <div className="picker">
          <label htmlFor="id-style">Name style</label>
          <input id="id-style" maxLength={MAX_STYLE} value={style} placeholder="Optional: dark, short, ends in -ra" onChange={(e) => setStyle(e.target.value)} />
        </div>
      )}
      <div className="actions name-actions">
        <button type="button" disabled={!pair} title={pair ? undefined : 'Type a first and a last name first'} onClick={() => pair && save(pair)}>Add to shortlist</button>
        <button type="button" disabled={!!waiting || (hostedPrompt && aiBusy)} onClick={suggest}>{waiting ? 'Suggesting…' : 'Suggest names'}</button>
      </div>
      {hostedPrompt && <AiNote />}
      {ideas.length > 0 && (
        <NameList label="Suggested names" pairs={ideas} actions={(p) => <>
          <button type="button" onClick={() => use(p)}>Use</button>
          <button type="button" onClick={() => save(p)}>Save</button>
        </>} />
      )}
      {ideasNote && <p className="muted small" role="status">{ideasNote}</p>}
      {shortlist.length > 0 && (
        <>
          <h3 className="small">Shortlist</h3>
          <NameList label="Shortlist" pairs={shortlist} actions={(p) => <>
            <button type="button" onClick={() => use(p)}>Use</button>
            <button type="button" onClick={() => setShortlist(store, removeFromShortlist(store.get().shortlist, p))}>Remove</button>
          </>} />
          <p className="muted small">Kept in this browser only.</p>
        </>
      )}
      <div className="picker">
        <label htmlFor="id-title">Title</label>
        <select id="id-title" value={id.titleId ?? ''} onChange={(e) => commands.set_identity({ titleId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">No title</option>
          {titles.map((t) => <option key={t.titleId} value={t.titleId}>{wording(t)}</option>)}
        </select>
      </div>
      <div className="picker">
        <label htmlFor="id-guild">Guild</label>
        <TextField id="id-guild" maxLength={MAX_GUILD} value={id.guild ?? ''} onChange={(v) => commands.set_identity({ guild: v })} />
      </div>
      <div className="picker">
        <label htmlFor="id-level">Level</label>
        <input id="id-level" type="number" min={1} max={MAX_LEVEL} value={id.level ?? ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (e.target.value === '') commands.set_identity({ level: null })
            else if (Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL) commands.set_identity({ level: n })
          }} />
      </div>
      {classes.length > 0 && (
        <div className="picker">
          <label htmlFor="id-class">Class</label>
          <select id="id-class" value={id.classId ?? ''} onChange={(e) => commands.set_identity({ classId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No class</option>
            {classes.map((c) => <option key={c.classId} value={c.classId}>{c.name}</option>)}
          </select>
        </div>
      )}
      <label className="small" title="Offer every class, not only the ones this race can be">
        <input type="checkbox" checked={anyClass} onChange={(e) => setAnyClass(store, e.target.checked)} /> Any class
      </label>
      <label className="small">
        <input type="checkbox" checked={id.pvp ?? false} onChange={(e) => commands.set_identity({ pvp: e.target.checked || null })} /> PvP
      </label>
      <div className="picker">
        <label htmlFor="id-tooltip">Tooltip</label>
        <select id="id-tooltip" value={tooltipMode} onChange={(e) => onTooltipMode(e.target.value as TooltipMode)}>
          {TOOLTIP_MODES.map((t) => <option key={t.mode} value={t.mode}>{t.label}</option>)}
        </select>
      </div>
    </section>
  )
}
