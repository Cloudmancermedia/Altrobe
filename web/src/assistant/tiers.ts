// The class tier sets, as the prompt API's instructions list them (infra/lambda/prompt/instructions.ts
// TIERS; tiers.test.ts keeps the two equal), so a tool can take "Mage" and "T2" instead of a set ID: the
// model read the list one tier off and guessed set IDs (2026-10-21).

export const TIER_SETS: Record<string, string[]> = {
  Warrior: ['Battlegear of Valor', 'Battlegear of Heroism', 'Battlegear of Might', 'Battlegear of Wrath', "Conqueror's Battlegear", "Dreadnaught's Battlegear"],
  Paladin: ['Lightforge Armor', 'Soulforge Armor', 'Lawbringer Armor', 'Judgement Armor', "Avenger's Battlegear", 'Redemption Armor'],
  Hunter: ['Beaststalker Armor', 'Beastmaster Armor', 'Giantstalker Armor', 'Dragonstalker Armor', "Striker's Garb", 'Cryptstalker Armor'],
  Rogue: ['Shadowcraft Armor', 'Darkmantle Armor', 'Nightslayer Armor', 'Bloodfang Armor', "Deathdealer's Embrace", 'Bonescythe Armor'],
  Priest: ['Vestments of the Devout', 'Vestments of the Virtuous', 'Vestments of Prophecy', 'Vestments of Transcendence', 'Garments of the Oracle', 'Vestments of Faith'],
  Shaman: ['The Elements', 'The Five Thunders', 'The Earthfury', 'The Ten Storms', "Stormcaller's Garb", 'The Earthshatterer'],
  Mage: ["Magister's Regalia", "Sorcerer's Regalia", 'Arcanist Regalia', 'Netherwind Regalia', 'Enigma Vestments', 'Frostfire Regalia'],
  Warlock: ['Dreadmist Raiment', 'Deathmist Raiment', 'Felheart Raiment', 'Nemesis Raiment', "Doomcaller's Attire", 'Plagueheart Raiment'],
  Druid: ['Wildheart Raiment', 'Feralheart Raiment', 'Cenarion Raiment', 'Stormrage Raiment', 'Genesis Raiment', 'Dreamwalker Raiment'],
}

/** The tiers in TIER_SETS order. */
export const TIERS = ['0', '0.5', '1', '2', '2.5', '3']

/** The set a class wears at a tier ("T2", "2", "tier 2"), or undefined for an unknown class or tier. */
export function tierSetName(className: string, tier: string | number): string | undefined {
  const cls = Object.keys(TIER_SETS).find((c) => c.toLowerCase() === className.trim().toLowerCase())
  const t = String(tier).trim().toLowerCase().replace(/^tier\s*|^t/, '')
  const i = TIERS.indexOf(t)
  return cls && i >= 0 ? TIER_SETS[cls][i] : undefined
}
