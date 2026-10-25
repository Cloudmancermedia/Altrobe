import { useEffect, useState } from 'react'
import { getBaseLook, getForms, getResolvedItem, getTitles } from './api/client'
import type { AnimationInfo, BaseLook, FormsResponse, ModelSet, TitleInfo } from './api/types'
import type { Look } from './look/look'
import { formChoiceFor } from './viewer/form'

/** The base look for a character, or null while it loads or when it cannot be loaded. */
export function useBaseLook(race: number, sex: number, models: ModelSet, enabled = true): BaseLook | null {
  const [state, setState] = useState<{ key: string; look: BaseLook | null }>({ key: '', look: null })
  const key = `${race}:${sex}:${models}`
  useEffect(() => {
    if (!enabled) return
    let live = true
    getBaseLook(race, sex, models).then((look) => { if (live) setState({ key, look }) }, () => { if (live) setState({ key, look: null }) })
    return () => { live = false }
  }, [key, race, sex, models, enabled])
  return state.key === key ? state.look : null
}

/**
 * An item's Item.SubclassID (staff, polearm, ...), from its resolved data, or undefined with no item or
 * while it loads. The viewer loads the same data for the character, so this is usually a cache hit.
 */
export function useItemSubclass(itemId: number | undefined, race: number, sex: number, models: ModelSet): number | undefined {
  const [state, setState] = useState<{ key: string; subclass?: number }>({ key: '' })
  const key = `${itemId}:${race}:${sex}:${models}`
  useEffect(() => {
    if (!itemId) return
    let live = true
    getResolvedItem(itemId, race, sex, models).then((item) => { if (live) setState({ key, subclass: item?.itemSubclass }) }, () => { if (live) setState({ key }) })
    return () => { live = false }
  }, [key, itemId, race, sex, models])
  return state.key === key ? state.subclass : undefined
}

/** The game's titles, loaded once; empty until they arrive or when the build has none. */
export function useTitles(): TitleInfo[] {
  const [titles, setTitles] = useState<TitleInfo[]>([])
  useEffect(() => { getTitles().then(setTitles, () => setTitles([])) }, [])
  return titles
}

/** The build's druid forms, loaded once; null until they arrive or when they cannot be loaded. */
export function useForms(): FormsResponse | null {
  const [forms, setForms] = useState<FormsResponse | null>(null)
  useEffect(() => { getForms().then(setForms, () => setForms(null)) }, [])
  return forms
}

/** A character's animations: its body model's, or in a druid form the form model's. */
export function useAnimations(look: Pick<Look, 'race' | 'sex' | 'models' | 'form' | 'formChoice'>, enabled = true): AnimationInfo[] | null {
  const base = useBaseLook(look.race, look.sex, look.models, enabled && !look.form)
  const forms = useForms()
  if (!look.form) return base?.animations ?? null
  const found = forms && formChoiceFor(forms, look)
  return found ? forms.animations[found.choice.modelFileDataId] ?? NO_ANIMATIONS : null
}

// One empty list, so a form model without animations doesn't hand effects a new array every render.
const NO_ANIMATIONS: AnimationInfo[] = []
