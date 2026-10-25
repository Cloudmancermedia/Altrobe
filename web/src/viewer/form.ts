// A druid form as the viewer draws it: the chosen color's creature model, with no body layout or gear.
import type { BaseLook, FormChoice, FormLook, FormsResponse } from '../api/types'
import type { Dressed } from './dress'
import type { CharacterSpec } from './prepare'

// The creature skin slots a form's textures fill, in order (M2 texture types 11 to 13).
const SKIN_SLOTS = [11, 12, 13]

/** The race's form and the color shown: the chosen one, else the default. Null when the race has no such form. */
export function formChoiceFor(forms: FormsResponse, spec: Pick<CharacterSpec, 'race' | 'form' | 'formChoice'>): { look: FormLook; choice: FormChoice } | null {
  const look = forms.forms.find((f) => f.form === spec.form && f.race === spec.race)
  if (!look) return null
  const choice = look.choices.find((c) => c.choiceId === spec.formChoice) ?? look.choices.find((c) => c.choiceId === look.defaultChoiceId) ?? look.choices[0]
  return { look, choice }
}

/** The form's base look and dressing, or null when the race has no such form. */
export function formCharacter(forms: FormsResponse, spec: CharacterSpec): { baseLook: BaseLook; dressed: Dressed } | null {
  const found = formChoiceFor(forms, spec)
  if (!found) return null
  const { look, choice } = found
  const replaceableTextures: Record<number, number> = {}
  choice.textures.forEach((t, i) => { if (t > 0 && SKIN_SLOTS[i]) replaceableTextures[SKIN_SLOTS[i]] = t })
  return {
    baseLook: {
      form: look.form, build: forms.build, models: spec.models, race: spec.race, sex: spec.sex,
      chrModelId: 0, modelFileDataId: choice.modelFileDataId, textureLayoutId: 0,
      choices: [], geosets: [], textures: [], layers: [], sections: [], sectionLayers: [],
      animations: forms.animations[choice.modelFileDataId] ?? [],
    },
    dressed: { layers: [], geosets: [], geosetChanges: [], replaceableTextures, attachments: [], notes: [] },
  }
}
