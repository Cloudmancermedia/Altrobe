// node tools/suggest-data-mined-classes.mjs <bundle>/<product>/<build>
// Suggests classes for new-in-Forever sets the name doesn't place, for a maintainer to check before adding
// them to importer/src/Altrobe.Core/Catalog/forever-sets.json (Phase 4 — Data-Mined Sets Spec,
// Step 2). A suggestion means the set's helm or shoulder model is worn only by one class's own sets.
// Shared models mislead (Blue Dragon Mail came out as Rogue), so never copy the output in unchecked.
// Reads a baked build; writes nothing. Never run during a bake.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node tools/suggest-data-mined-classes.mjs <bundle>/<product>/<build>')
  process.exit(1)
}
const { sets } = JSON.parse(readFileSync(join(dir, 'sets.json'), 'utf8'))
const CLASSES = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid' }
const oneClass = (mask) => Object.keys(CLASSES).map(Number).find((c) => mask === 1 << (c - 1))

// The head and shoulder model resources of a set's pieces (the same for every race and sex).
const models = new Map()
const headModels = (set) => set.pieces.filter((p) => p.slot === 'head' || p.slot === 'shoulder').flatMap((p) => {
  if (!models.has(p.item.itemId)) {
    let ids = []
    try {
      const item = JSON.parse(readFileSync(join(dir, 'items', `${p.item.itemId}.json`), 'utf8'))
      ids = Object.values(item.variants)[0]?.models.map((m) => m.modelResourcesId).filter(Boolean) ?? []
    } catch { /* no item file: nothing to compare */ }
    models.set(p.item.itemId, ids)
  }
  return models.get(p.item.itemId)
})

// Model resource -> classes whose own (single-class, not new-in-Forever) sets wear it.
const wornBy = new Map()
for (const set of sets) {
  const cls = !set.newInForever && !set.internal ? oneClass(set.classMask) : undefined
  if (!cls) continue
  for (const m of headModels(set)) wornBy.set(m, (wornBy.get(m) ?? new Set()).add(cls))
}

const suggestions = {}
for (const set of sets.filter((s) => s.newInForever && s.classSource !== 'name')) {
  const classes = new Set(headModels(set).flatMap((m) => [...(wornBy.get(m) ?? [])]))
  if (classes.size !== 1) continue
  const [cls] = classes
  suggestions[set.setId] = [cls]
  console.error(`${set.setId} ${set.name} (${set.armor ?? 'no armor'}): ${CLASSES[cls]}`)
}
console.log(JSON.stringify(suggestions, null, 2))
