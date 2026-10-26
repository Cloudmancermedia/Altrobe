// formCharacter() over hand-written forms (made-up IDs, not game data).
import { describe, expect, test } from 'vitest'
import type { FormsResponse } from '../api/types'
import { formCharacter } from './form'

const forms: FormsResponse = {
  build: '1.60.1.70532',
  forms: [
    { form: 'cat', race: 4, defaultChoiceId: 3, choices: [
      { choiceId: 1, name: 'Black', modelFileDataId: 500, textures: [600, 0, 0], classic: false },
      { choiceId: 3, name: 'Purple', modelFileDataId: 509, textures: [609, 0, 0], classic: true },
    ] },
    { form: 'moonkin', race: 4, defaultChoiceId: 7, choices: [{ choiceId: 7, name: 'Purple', modelFileDataId: 520, textures: [620, 621, 0], classic: false }] },
  ],
  animations: { 509: [{ id: 0, name: 'Stand' }, { id: 5, name: 'Run' }], 520: [{ id: 0, name: 'Stand' }] },
}

describe('formCharacter', () => {
  test('the default color is the form model, with its textures in the creature skin slots and no gear', () => {
    const c = formCharacter(forms, { race: 4, sex: 0, models: 'hd', form: 'cat' })!
    expect(c.baseLook).toMatchObject({ form: 'cat', race: 4, modelFileDataId: 509, build: '1.60.1.70532', layers: [], textures: [] })
    expect(c.baseLook.animations).toEqual([{ id: 0, name: 'Stand' }, { id: 5, name: 'Run' }])
    expect(c.dressed).toMatchObject({ layers: [], attachments: [], replaceableTextures: { 11: 609 } })
  })

  test('a chosen color picks its model and fills every slot it has', () => {
    expect(formCharacter(forms, { race: 4, sex: 0, models: 'hd', form: 'cat', formChoice: 1 })!.baseLook.modelFileDataId).toBe(500)
    expect(formCharacter(forms, { race: 4, sex: 0, models: 'hd', form: 'moonkin' })!.dressed.replaceableTextures).toEqual({ 11: 620, 12: 621 })
  })

  test('an unknown color falls back to the default, and a race without the form has none', () => {
    expect(formCharacter(forms, { race: 4, sex: 0, models: 'hd', form: 'cat', formChoice: 99 })!.baseLook.modelFileDataId).toBe(509)
    expect(formCharacter(forms, { race: 6, sex: 0, models: 'hd', form: 'cat' })).toBeNull()
  })
})
