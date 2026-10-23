import type { AnimationInfo, CharactersResponse, ModelSet } from '../api/types'
import { commands, useEditing } from '../app-state'
import { useBaseLook, useItemSubclass } from '../hooks'
import { animationPresets } from '../presets'
import { ANIMATION_GROUPS, animationGroup, animationLabel, animationOrder, pickCharacter, racesByFaction, sexLabel, type Faction } from '../labels'
import { VIEWS, type Look } from '../look/look'
import { panelOptions } from '../viewer/customize'
import { EditingNote } from './Items'

const FACTION_LABELS: Record<Faction, string> = { alliance: 'Alliance', horde: 'Horde', neutral: 'Other' }

export function CharacterPicker({ characters, race, sex, models, onChange, idPrefix }: {
  characters: CharactersResponse; race: number; sex: number; models: ModelSet
  onChange: (race: number, sex: 0 | 1, models: ModelSet) => void; idPrefix: string
}) {
  const r = characters.races.find((x) => x.race === race)
  const s = r?.sexes.find((x) => x.sex === sex)
  return (
    <div className="picker">
      <label htmlFor={`${idPrefix}-race`}>Race</label>
      <select
        id={`${idPrefix}-race`}
        value={race}
        onChange={(e) => {
          const next = characters.races.find((x) => x.race === Number(e.target.value))!
          const p = pickCharacter(next, sex, models)
          if (p) onChange(next.race, p.sex, p.models)
        }}
      >
        {racesByFaction(characters.races).map((g) => (
          <optgroup key={g.faction} label={FACTION_LABELS[g.faction]}>
            {g.races.map((x) => {
              const any = x.sexes.some((s) => s.hd || s.sd)
              return <option key={x.race} value={x.race} disabled={!any}>{x.name}{any ? '' : ' (no data)'}</option>
            })}
          </optgroup>
        ))}
      </select>

      <span className="label">Sex</span>
      <div className="segmented" role="radiogroup" aria-label="Sex">
        {([0, 1] as const).map((v) => {
          const entry = r?.sexes.find((x) => x.sex === v)
          const ok = !!entry && (entry.hd || entry.sd)
          return (
            <button key={v} type="button" role="radio" aria-checked={sex === v} disabled={!ok}
              onClick={() => entry && onChange(race, v, entry[models] ? models : entry.hd ? 'hd' : 'sd')}>
              {sexLabel(v)}
            </button>
          )
        })}
      </div>

      <span className="label">Models</span>
      <div className="segmented" role="radiogroup" aria-label="Models">
        {(['hd', 'sd'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={models === m} disabled={!s?.[m]}
            title={s?.[m] ? undefined : `No ${m.toUpperCase()} model for this character`}
            onClick={() => onChange(race, sex as 0 | 1, m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}

export function CharacterPanel({ characters, look }: { characters: CharactersResponse; look: Look }) {
  // Race, sex, models and animation are the edited character's; the camera view is for everyone.
  const editing = useEditing().look
  const race = characters.races.find((r) => r.race === editing.race)
  const animations = useBaseLook(editing.race, editing.sex, editing.models)?.animations ?? []
  return (
    <section className="panel" aria-labelledby="character-heading">
      <h2 id="character-heading">Character</h2>
      <EditingNote verb="Editing" />
      <CharacterPicker characters={characters} race={editing.race} sex={editing.sex} models={editing.models} idPrefix="main"
        onChange={(r, s, m) => commands.edit.set_character(r, s, m)} />
      {race && race.classes.length > 0 && (
        <p className="muted small">Classes: {race.classes.map((c) => c.name).join(', ')}</p>
      )}
      <div className="picker">
        <label htmlFor="cam-view">View</label>
        <select id="cam-view" value={look.cam.view} onChange={(e) => commands.set_view(e.target.value)}>
          {VIEWS.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
        </select>
      </div>
      {animations.length > 0 && (
        <div className="picker">
          <label htmlFor="anim">Animation</label>
          <select id="anim" value={editing.anim ?? 'Stand'} onChange={(e) => commands.edit.set_animation(e.target.value, animations)}>
            {ANIMATION_GROUPS.map((group) => {
              const inGroup = animations.filter((a) => animationGroup(a.name) === group)
                .sort((x, y) => animationOrder(x.name) - animationOrder(y.name) || animationLabel(x.name).localeCompare(animationLabel(y.name)))
              return inGroup.length > 0 && (
                <optgroup key={group} label={group}>
                  {inGroup.map((a) => <option key={a.id} value={a.name}>{animationLabel(a.name)}</option>)}
                </optgroup>
              )
            })}
          </select>
        </div>
      )}
      <AnimationPresets look={editing} animations={animations} />
    </section>
  )
}

/** One-click animations for the edited character. The playing one shows pressed; pressing it again stands. */
function AnimationPresets({ look, animations }: { look: Look; animations: AnimationInfo[] }) {
  const subclass = useItemSubclass(look.items.mainhand, look.race, look.sex, look.models)
  const rangedSubclass = useItemSubclass(look.items.ranged, look.race, look.sex, look.models)
  const presets = animationPresets(animations, subclass, rangedSubclass)
  if (!presets.length) return null
  return (
    <div className="actions presets" role="group" aria-label="Quick animations">
      {presets.map((p) => {
        // Stand is on when nothing else plays; pressing any pressed button stands.
        const on = p.animation === 'Stand' ? !look.anim || look.anim === 'Stand' : look.anim === p.animation
        return (
          <button key={p.animation} type="button" aria-pressed={on} onClick={() => commands.edit.set_animation(on ? 'Stand' : p.animation, animations)}>
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

export function CustomizationPanel() {
  const look = useEditing().look
  const changed = Object.keys(look.custom).length > 0
  const baseLook = useBaseLook(look.race, look.sex, look.models)
  if (!baseLook) return null
  // Checked against the edited character's own options, which differ by race and sex.
  const choices = baseLook.options ?? null
  const options = panelOptions(baseLook)

  return (
    <section className="panel" aria-labelledby="custom-heading">
      <h2 id="custom-heading">Customization</h2>
      <div className="actions">
        <button type="button" onClick={() => commands.edit.randomize_customization(choices)} title="Pick a random choice for every option">
          <span aria-hidden="true">🎲</span> Randomize
        </button>
        <button type="button" onClick={() => commands.edit.reset_customization()} disabled={!changed}>Reset to defaults</button>
      </div>
      {options.map((o) => {
        const value = look.custom[String(o.optionId)] ?? o.defaultChoiceId ?? o.choices[0].choiceId
        const current = o.choices.find((c) => c.choiceId === value)
        const id = `opt-${o.optionId}`
        return (
          <div className="picker" key={o.optionId}>
            <label htmlFor={id}>{o.name}</label>
            <div className="choice">
              {current?.swatch && <span className="swatch" style={{ background: current.swatch }} aria-hidden="true" />}
              <select id={id} value={value} onChange={(e) => commands.edit.set_customization(o.optionId, Number(e.target.value), choices)}>
                {o.choices.map((c, i) => (
                  <option key={c.choiceId} value={c.choiceId}>
                    {c.name || `#${i + 1}`}{c.choiceId === o.defaultChoiceId ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )
      })}
    </section>
  )
}
