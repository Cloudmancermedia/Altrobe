namespace Altrobe.Core.Catalog;

public sealed record ClassTierSets(int ClassId, string Class, IReadOnlyList<string> Sets);

public sealed record SetGroup(string Group, IReadOnlyList<ItemSetInfo> Sets);

// The sets players look for first: each class's tier sets and the PvP rank sets. The client data has
// no tier on a set, and tier 1 and 2 pieces have no ItemSparse row to read a class from, so tier sets
// go by these names (each checked against the Forever beta's ItemSet names). PvP pieces do carry their class, but
// every piece allows every race, so a PvP set's faction goes by its rank title.
public static class NotableSets
{
    public static readonly IReadOnlyList<string> TierLabels = ["Tier 0", "Tier 0.5", "Tier 1", "Tier 2", "Tier 2.5", "Tier 3"];

    public static readonly IReadOnlyList<ClassTierSets> Tiers =
    [
        new(1, "Warrior", ["Battlegear of Valor", "Battlegear of Heroism", "Battlegear of Might", "Battlegear of Wrath", "Conqueror's Battlegear", "Dreadnaught's Battlegear"]),
        new(2, "Paladin", ["Lightforge Armor", "Soulforge Armor", "Lawbringer Armor", "Judgement Armor", "Avenger's Battlegear", "Redemption Armor"]),
        new(3, "Hunter", ["Beaststalker Armor", "Beastmaster Armor", "Giantstalker Armor", "Dragonstalker Armor", "Striker's Garb", "Cryptstalker Armor"]),
        new(4, "Rogue", ["Shadowcraft Armor", "Darkmantle Armor", "Nightslayer Armor", "Bloodfang Armor", "Deathdealer's Embrace", "Bonescythe Armor"]),
        new(5, "Priest", ["Vestments of the Devout", "Vestments of the Virtuous", "Vestments of Prophecy", "Vestments of Transcendence", "Garments of the Oracle", "Vestments of Faith"]),
        new(7, "Shaman", ["The Elements", "The Five Thunders", "The Earthfury", "The Ten Storms", "Stormcaller's Garb", "The Earthshatterer"]),
        new(8, "Mage", ["Magister's Regalia", "Sorcerer's Regalia", "Arcanist Regalia", "Netherwind Regalia", "Enigma Vestments", "Frostfire Regalia"]),
        new(9, "Warlock", ["Dreadmist Raiment", "Deathmist Raiment", "Felheart Raiment", "Nemesis Raiment", "Doomcaller's Attire", "Plagueheart Raiment"]),
        new(11, "Druid", ["Wildheart Raiment", "Feralheart Raiment", "Cenarion Raiment", "Stormrage Raiment", "Genesis Raiment", "Dreamwalker Raiment"]),
    ];

    public const string PvpRare = "PvP (rare)", PvpEpic = "PvP (epic)";

    // Rank title -> (group, faction). Knight-Lieutenant's and Blood Guard's are the first rare sets,
    // Lieutenant Commander's and Champion's the later ones.
    static readonly (string Prefix, string Group, string Faction)[] Pvp =
    [
        ("Knight-Lieutenant's", PvpRare, "alliance"), ("Knight Lieutenant's", PvpRare, "alliance"), ("Lieutenant Commander's", PvpRare, "alliance"),
        ("Blood Guard's", PvpRare, "horde"), ("Champion's", PvpRare, "horde"),
        ("Field Marshal's", PvpEpic, "alliance"), ("Warlord's", PvpEpic, "horde"),
    ];

    public static IReadOnlyList<string> GroupOrder { get; } = [PvpRare, PvpEpic, .. TierLabels];

    static readonly Dictionary<string, (string Group, int ClassId)> TierByName =
        Tiers.SelectMany(c => c.Sets.Select((name, i) => (name, group: TierLabels[i], c.ClassId)))
            .ToDictionary(x => x.name, x => (x.group, x.ClassId), StringComparer.OrdinalIgnoreCase);

    // The group, class mask and faction (null for any) a set counts under, or null if it is not notable.
    // A PvP set counts only when it is one class's own: the shared level 50 cloth sets (Knight-Lieutenant's
    // Satin for Priest and Mage, Dreadweave for those and Warlock) stay in the full list.
    public static (string Group, int ClassMask, string? Faction)? Classify(ItemSetInfo set)
    {
        if (TierByName.TryGetValue(set.Name, out var tier)) return (tier.Group, 1 << (tier.ClassId - 1), null);
        var oneClass = set.ClassMask > 0 && (set.ClassMask & (set.ClassMask - 1)) == 0;
        foreach (var (prefix, group, faction) in Pvp)
            if (set.Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return oneClass ? (group, set.ClassMask, faction) : null;
        return null;
    }

    // Data-mined sets list after the tiers (SetCatalog.DataMined).
    public const string DataMined = "Data-mined";

    // Words that only one class's tier set names use, for data-mined sets such as "Arcanist Insight".
    // Plain English words from those names (Valor, Might, Wrath, Faith, Elements, Genesis, Enigma,
    // Oracle, Redemption) are left out: other sets use them too.
    public static readonly IReadOnlyDictionary<string, int> ClassStems = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
    {
        ["Conqueror"] = 1, ["Dreadnaught"] = 1,
        ["Lightforge"] = 2, ["Soulforge"] = 2, ["Lawbringer"] = 2, ["Judgement"] = 2, ["Avenger"] = 2,
        ["Beaststalker"] = 3, ["Beastmaster"] = 3, ["Giantstalker"] = 3, ["Dragonstalker"] = 3, ["Striker"] = 3, ["Cryptstalker"] = 3,
        ["Shadowcraft"] = 4, ["Darkmantle"] = 4, ["Nightslayer"] = 4, ["Bloodfang"] = 4, ["Deathdealer"] = 4, ["Bonescythe"] = 4,
        ["Devout"] = 5, ["Virtuous"] = 5, ["Prophecy"] = 5, ["Transcendence"] = 5,
        ["Earthfury"] = 7, ["Stormcaller"] = 7, ["Earthshatterer"] = 7,
        ["Magister"] = 8, ["Sorcerer"] = 8, ["Arcanist"] = 8, ["Netherwind"] = 8, ["Frostfire"] = 8,
        ["Dreadmist"] = 9, ["Deathmist"] = 9, ["Felheart"] = 9, ["Nemesis"] = 9, ["Doomcaller"] = 9, ["Plagueheart"] = 9,
        ["Wildheart"] = 11, ["Feralheart"] = 11, ["Cenarion"] = 11, ["Stormrage"] = 11, ["Dreamwalker"] = 11,
    };

    // Phrases of plain words that only one class's tier set name uses together.
    public static readonly IReadOnlyDictionary<string, int> ClassPhrases = new Dictionary<string, int> { ["Ten Storms"] = 7, ["Five Thunders"] = 7 };

    // The classes that wear each armor type in Classic.
    public static readonly IReadOnlyDictionary<string, int[]> ArmorClasses = new Dictionary<string, int[]>
    {
        ["plate"] = [1, 2], ["mail"] = [3, 7], ["leather"] = [4, 11], ["cloth"] = [5, 8, 9],
    };

    // The class mask a data-mined set's name gives: a tier set name, else a class stem or phrase. Null
    // when the name names no class, or more than one.
    public static int? ClassByName(string setName)
    {
        if (TierByName.TryGetValue(setName, out var tier)) return 1 << (tier.ClassId - 1);
        var classes = System.Text.RegularExpressions.Regex.Split(setName, "[^A-Za-z]+")
            .Select(w => ClassStems.TryGetValue(w, out var c) ? c : 0)
            .Concat(ClassPhrases.Where(p => setName.Contains(p.Key, StringComparison.OrdinalIgnoreCase)).Select(p => p.Value))
            .Where(c => c != 0).Distinct().ToList();
        return classes.Count == 1 ? 1 << (classes[0] - 1) : null;
    }

    // Tiers 0 and 0.5 are rare (3), tiers 1-3 epic (4). Null for a set not in the tier list. Used where the
    // pieces have no quality of their own: tier 1 and 2 in the Forever beta have no ItemSparse rows.
    public static int? TierQuality(string setName) =>
        TierByName.TryGetValue(setName, out var tier) ? (tier.Group is "Tier 0" or "Tier 0.5" ? 3 : 4) : null;

    // "Warrior: Battlegear of Valor / ... / Dreadnaught's Battlegear", one line per class, for the MCP instructions.
    public static string InstructionLines(string indent) =>
        string.Join("\n", Tiers.Select(t => $"{indent}{t.Class}: {string.Join(" / ", t.Sets)}"));
}
