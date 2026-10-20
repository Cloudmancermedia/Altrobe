// The cases follow OutfitBuilder (importer/src/Altrobe.Core/Catalog/OutfitBuilder.cs), so the hosted
// prompt box builds the same outfit as the local app's build_outfit tool.
import { describe, expect, test } from 'vitest'
import type { BundleItem } from '../api/search'
import { buildOutfit } from './outfit'

let next = 1
const item = (slot: string, requiredLevel: number | null, extra: Partial<BundleItem> = {}): BundleItem =>
  ({ itemId: next++, name: `${slot} ${requiredLevel}`, slot, quality: 2, iconFileDataId: 0, internal: false, unnamed: false, requiredLevel, itemLevel: requiredLevel, allowableClass: -1, ...extra })

describe('buildOutfit', () => {
  test('picks the highest required level within 7 below the target, then the highest item level, then the lowest ID', () => {
    const tooHigh = item('head', 21)
    const tooLow = item('head', 13)
    const low = item('head', 14)
    const best = item('head', 20, { itemLevel: 26 })
    const sameLevelLowerIlvl = item('head', 20, { itemLevel: 25 })
    const tieLaterId = item('chest', 18, { itemLevel: 22 })
    const tieFirst = { ...tieLaterId, itemId: 0 }
    const r = buildOutfit([tooHigh, tooLow, low, sameLevelLowerIlvl, best, tieLaterId, tieFirst], { level: 20 })
    expect(r.items.head.itemId).toBe(best.itemId)
    expect(r.items.chest.itemId).toBe(0)
    expect(r.missing).toEqual(['shoulder', 'waist', 'legs', 'feet', 'wrist', 'hands', 'back', 'mainhand'])
  })

  test('keeps quality 2 to 5 by default and skips developer and unnamed items', () => {
    const grey = item('legs', 20, { quality: 1 })
    const dev = item('legs', 20, { internal: true })
    const unnamed = item('legs', 20, { unnamed: true })
    expect(buildOutfit([grey, dev, unnamed], { level: 20 }).items.legs).toBeUndefined()
    expect(buildOutfit([grey], { level: 20, minQuality: 1 }).items.legs.itemId).toBe(grey.itemId)
  })

  test('filters armor slots by armor type; the back takes any cloak', () => {
    const mail = item('feet', 30, { armor: 'mail' })
    const cloth = item('feet', 30, { armor: 'cloth', itemLevel: 40 })
    const cloak = item('back', 30, { armor: 'cloth' })
    const r = buildOutfit([mail, cloth, cloak], { level: 30, armor: 'mail' })
    expect(r.items.feet.itemId).toBe(mail.itemId)
    expect(r.items.back.itemId).toBe(cloak.itemId)
  })

  test('leaves out items only other classes can use', () => {
    const paladinOnly = item('wrist', 30, { allowableClass: 1 << 1 })
    expect(buildOutfit([paladinOnly], { level: 30, classId: 1 }).items.wrist).toBeUndefined()
    expect(buildOutfit([paladinOnly], { level: 30, classId: 2 }).items.wrist.itemId).toBe(paladinOnly.itemId)
  })

  test('fills the main hand only when weapon types are given', () => {
    const axe = item('mainhand', 30, { weapon: 'axe', hands: 'two-hand' })
    const bow = item('ranged', 30, { weapon: 'bow', hands: 'ranged', itemLevel: 50 })
    expect(buildOutfit([axe], { level: 30 }).missing).toContain('mainhand')
    expect(buildOutfit([axe], { level: 30, weapons: ['axe'] }).items.mainhand.itemId).toBe(axe.itemId)
    // A bow goes in the ranged slot.
    expect(buildOutfit([axe, bow], { level: 30, weapons: ['axe', 'bow'] }).items.ranged.itemId).toBe(bow.itemId)
    expect(buildOutfit([axe, bow], { level: 30, weapons: ['axe', 'bow'], hands: 'two-hand' }).items.mainhand.itemId).toBe(axe.itemId)
  })

  test('adds an off hand unless the weapon takes both hands', () => {
    const sword = item('mainhand', 30, { weapon: 'sword', hands: 'one-hand' })
    const greatsword = item('mainhand', 30, { weapon: 'sword', hands: 'two-hand', itemLevel: 60 })
    const shield = item('offhand', 30, { hands: 'shield' })
    const oneHand = buildOutfit([sword, shield], { level: 30, weapons: ['sword'], offHand: 'shield' })
    expect(oneHand.items.offhand.itemId).toBe(shield.itemId)
    expect(buildOutfit([sword, greatsword, shield], { level: 30, weapons: ['sword'], offHand: 'shield' }).items.offhand).toBeUndefined()
  })

  test('at the same required level, an item new in Forever wins; it never beats a higher level', () => {
    const old = item('chest', 20, { itemLevel: 30 })
    const added = item('chest', 20, { itemLevel: 25, newInForever: true, itemId: 246100 })
    const oldBoots = item('feet', 20)
    const addedLower = item('feet', 19, { itemLevel: 30, newInForever: true, itemId: 246101 })
    const r = buildOutfit([old, added, oldBoots, addedLower], { level: 20 })
    expect(r.items.chest.itemId).toBe(246100)
    expect(r.items.feet.itemId).toBe(oldBoots.itemId)
  })

  test('fills only the slots asked for', () => {
    const r = buildOutfit([item('head', 10), item('chest', 10)], { level: 10, slots: ['chest'] })
    expect(Object.keys(r.items)).toEqual(['chest'])
    expect(r.missing).toEqual(['mainhand'])
  })
})
