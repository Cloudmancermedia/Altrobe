using Altrobe.Core.Catalog;
using Altrobe.Core.Tables;
using static Altrobe.Core.Tests.Fake;

namespace Altrobe.Core.Tests;

// New-in-Forever sets: the shipped list of Forever's set IDs, plus sets whose pieces are all unnamed and
// mostly use looks no named item has (Phase 4 — Data-Mined Sets Spec, Phase 4 — Find Panel Spec).
// Made-up item, display and set IDs unless a test says otherwise.
public class NewInForeverSetsTests
{
    const int Cloth = 1, Leather = 2, Plate = 4;
    static int Mask(params int[] classIds) => classIds.Aggregate(0, (m, c) => m | (1 << (c - 1)));

    sealed class Fixture
    {
        readonly InMemoryTables _t = new();

        // An item with a visual. name null: no ItemSparse row (unnamed, as in the Forever beta).
        public Fixture Item(int id, string? name, int inventoryType, int display, int armor = 0)
        {
            if (name != null)
                _t.Add(GameTableNames.ItemSparse, R(("ID", id), ("Display_lang", name), ("InventoryType", (byte)inventoryType), ("OverallQualityID", (byte)4)));
            _t.Add(GameTableNames.Item, R(("ID", id), ("InventoryType", (byte)inventoryType), ("ClassID", (byte)(armor > 0 ? 4 : 0)), ("SubclassID", (byte)armor)))
                .Add(GameTableNames.ItemModifiedAppearance, R(("ID", id), ("ItemID", id), ("ItemAppearanceModifierID", 0), ("OrderIndex", 0), ("ItemAppearanceID", id)))
                .Add(GameTableNames.ItemAppearance, R(("ID", id), ("ItemDisplayInfoID", display)));
            if (_displays.Add(display)) _t.Add(GameTableNames.ItemDisplayInfo, R(("ID", display)));
            return this;
        }
        readonly HashSet<int> _displays = [];

        public Fixture Set(int id, string name, params int[] items)
        {
            _t.Add(GameTableNames.ItemSet, R(("ID", id), ("Name_lang", name), ("ItemID", items)));
            return this;
        }

        // sodSets: Season of Discovery's set IDs, which are left out.
        public SetCatalog Build(IReadOnlyDictionary<int, int[]>? foreverSets = null, IReadOnlySet<int>? sodSets = null)
        {
            var items = new ItemCatalog(_t);
            return new SetCatalog(_t, items, foreverSets ?? new Dictionary<int, int[]>(), sodSets ?? new HashSet<int>());
        }
    }

    // Named plate pieces (displays 900, 901) that unnamed copies can reuse.
    static Fixture Named() => new Fixture()
        .Item(1, "Named Helm", 1, 900, Plate).Item(2, "Named Breastplate", 5, 901, Plate);

    [Fact]
    public void AnUnnamedSetWithNewLooksIsNewInForeverAndKnowsItsArmorType()
    {
        var sets = Named().Item(10, null, 1, 100, Cloth).Item(11, null, 5, 101, Cloth).Set(1600, "Whispering Garb", 10, 11).Build();
        var set = sets.Get(1600)!;
        Assert.True(set.NewInForever);
        Assert.Equal("cloth", set.Armor);
    }

    [Fact]
    public void AnUnnamedCopyOfNamedLooksIsNotNewInForever()
    {
        var sets = Named().Item(10, null, 1, 900, Plate).Item(11, null, 5, 901, Plate).Set(1600, "Battlegear of Valor", 10, 11).Build();
        Assert.False(sets.Get(1600)!.NewInForever);
    }

    [Fact]
    public void AtLeastHalfThePiecesMustHaveNewLooks()
    {
        var sets = Named()
            .Item(10, null, 1, 900, Plate).Item(11, null, 5, 101, Plate).Set(1600, "Half New", 10, 11)
            .Item(20, null, 1, 900, Plate).Item(21, null, 5, 901, Plate).Item(22, null, 7, 102, Plate).Set(1601, "Third New", 20, 21, 22)
            .Build();
        Assert.True(sets.Get(1600)!.NewInForever);
        Assert.False(sets.Get(1601)!.NewInForever);
    }

    [Fact]
    public void ASetWithANamedPieceOrADeveloperNameIsNotNewInForever()
    {
        var sets = Named()
            .Item(10, null, 1, 100, Cloth).Item(11, "Real Robe", 5, 101, Cloth).Set(1600, "Mixed Set", 10, 11)
            .Item(20, null, 1, 102, Cloth).Set(1601, "Test Set [PH]", 20)
            .Build();
        Assert.False(sets.Get(1600)!.NewInForever);
        Assert.False(sets.Get(1601)!.NewInForever);
    }

    [Fact]
    public void ATierSetNameGivesItsClass()
    {
        var sets = Named().Item(10, null, 5, 100, Cloth).Set(1600, "Arcanist Regalia", 10).Build();
        var set = sets.Get(1600)!;
        Assert.Equal(Mask(8), set.ClassMask);
        Assert.Equal("name", set.ClassSource);
    }

    [Fact]
    public void AWordOnlyOneClassesTierSetsUseGivesThatClass()
    {
        var sets = Named()
            .Item(10, null, 5, 100, Cloth).Set(1600, "Arcanist Insight", 10)
            .Item(20, null, 5, 101, Leather).Set(1601, "Cenarion Rage", 20)
            .Build();
        Assert.Equal((Mask(8), "name"), (sets.Get(1600)!.ClassMask, sets.Get(1600)!.ClassSource));
        Assert.Equal((Mask(11), "name"), (sets.Get(1601)!.ClassMask, sets.Get(1601)!.ClassSource));
    }

    [Fact]
    public void AMultiWordTierPhraseGivesItsClass()
    {
        // "Ten Storms" is two plain words alone, but together only the Shaman tier 2 name uses them.
        var sets = Named().Item(10, null, 5, 100, 3).Set(1600, "Eruption of the Ten Storms", 10).Build();
        Assert.Equal((Mask(7), "name"), (sets.Get(1600)!.ClassMask, sets.Get(1600)!.ClassSource));
    }

    [Fact]
    public void TheForeverListGivesClassesWhenTheNameDoesNot()
    {
        var sets = Named().Item(10, null, 5, 100, Cloth).Set(1600, "Whispering Garb", 10).Build(new Dictionary<int, int[]> { [1600] = [5, 9] });
        Assert.Equal((Mask(5, 9), "curated"), (sets.Get(1600)!.ClassMask, sets.Get(1600)!.ClassSource));
    }

    // The shipped list holds Forever's 21 set IDs from build 1.60.1.70374 and places each set family in the
    // one class it was made for (Phase 4 — Find Panel Spec). An empty list: class from the name or armor type.
    [Fact]
    public void TheShippedListHoldsEveryForeverSetAndPlacesEachFamilyInItsClass()
    {
        using var s = typeof(SetCatalog).Assembly.GetManifestResourceStream("Catalog/forever-sets.json")!;
        var shipped = System.Text.Json.JsonSerializer.Deserialize<Dictionary<int, int[]>>(s)!;
        var expected = new Dictionary<int, int[]>
        {
            [1969] = [],                                         // Goliaths' Adaptive Garments: armor type
            [2102] = [1], [2103] = [1],                          // Glory: Warrior
            [2106] = [2], [2107] = [2], [2108] = [2],            // Justice: Paladin
            [2101] = [3],                                        // Wildstalker: Hunter
            [2099] = [4],                                        // Grimstitch: Rogue
            [2104] = [5], [2105] = [5],                          // Conviction: Priest
            [2109] = [7], [2110] = [7], [2111] = [7],            // Spiritcaller: Shaman
            [2098] = [8],                                        // Manaflare: Mage
            [2100] = [9],                                        // Demonheart: Warlock
            [2112] = [11], [2113] = [11], [2114] = [11], [2115] = [11], // Grovekeeper: Druid
            [2134] = [],                                         // Violet Sorcerer's Vestments: Mage by name
            [2135] = [],                                         // Krol'dok Battlegear: armor type
        };
        Assert.Equal(expected.OrderBy(e => e.Key).Select(e => (e.Key, string.Join(',', e.Value))),
            shipped.OrderBy(e => e.Key).Select(e => (e.Key, string.Join(',', e.Value))));
    }

    // Blizzard's hotfixes name items that share these sets' looks, so the unnamed-new-looks test fails for
    // them; the list keeps them in the group, with their class.
    [Fact]
    public void AListedForeverSetStaysNewInForeverWhenNamedItemsShareItsLooks()
    {
        var sets = Named().Item(10, null, 1, 900, Leather).Item(11, null, 5, 901, Leather).Set(2112, "Grovekeeper Raiment", 10, 11)
            .Build(new Dictionary<int, int[]> { [2112] = [11] });
        var set = sets.Get(2112)!;
        Assert.True(set.NewInForever);
        Assert.Equal((Mask(11), "curated", "leather"), (set.ClassMask, set.ClassSource, set.Armor));
        Assert.Equal(["Grovekeeper Raiment"], sets.Notable("alliance", [11]).Single(g => g.Group == NotableSets.NewInForever).Sets.Select(x => x.Name));
    }

    [Fact]
    public void ANamedSetOnTheListIsNewInForeverToo()
    {
        var sets = Named().Item(10, "Grovekeeper Boots", 8, 100, Leather).Set(2112, "Grovekeeper Raiment", 10).Build(new Dictionary<int, int[]> { [2112] = [] });
        Assert.Equal((true, Mask(4, 11), "armor"), (sets.Get(2112)!.NewInForever, sets.Get(2112)!.ClassMask, sets.Get(2112)!.ClassSource));
    }

    [Fact]
    public void TheGroupIsLabelledNewInForever() => Assert.Equal("New in Forever", NotableSets.NewInForever);

    [Fact]
    public void TheNameWinsOverTheForeverList()
    {
        var sets = Named().Item(10, null, 5, 100, Cloth).Set(1600, "Arcanist Insight", 10).Build(new Dictionary<int, int[]> { [1600] = [5] });
        Assert.Equal((Mask(8), "name"), (sets.Get(1600)!.ClassMask, sets.Get(1600)!.ClassSource));
    }

    [Fact]
    public void OtherwiseArmorTypeGivesTheClassesThatWearIt()
    {
        var sets = Named()
            .Item(10, null, 5, 100, Plate).Set(1600, "Whispering Plate", 10)
            .Item(20, null, 5, 101, Cloth).Item(21, null, 1, 102, Cloth).Set(1601, "Whispering Garb", 20, 21)
            .Item(30, null, 13, 103).Set(1602, "Whispering Blades", 30)
            .Build();
        Assert.Equal((Mask(1, 2), "armor"), (sets.Get(1600)!.ClassMask, sets.Get(1600)!.ClassSource));
        Assert.Equal((Mask(5, 8, 9), "armor"), (sets.Get(1601)!.ClassMask, sets.Get(1601)!.ClassSource));
        // No armor piece: every class.
        Assert.Equal((-1, "armor"), (sets.Get(1602)!.ClassMask, sets.Get(1602)!.ClassSource));
        Assert.Null(sets.Get(1602)!.Armor);
    }

    [Fact]
    public void SetsThatAreNotNewInForeverKeepTheirClassAndHaveNoSource()
    {
        var sets = Named().Set(1600, "Named Set", 1, 2).Build();
        var set = sets.Get(1600)!;
        Assert.False(set.NewInForever);
        Assert.Null(set.ClassSource);
        Assert.Equal(-1, set.ClassMask);
    }

    [Fact]
    public void SeasonOfDiscoverySetsAreLeftOutEverywhere()
    {
        var sets = Named()
            .Item(10, null, 5, 100, Cloth).Set(1704, "Arcanist Insight", 10)      // unnamed new looks, Season of Discovery
            .Item(20, null, 5, 900, Plate).Set(1682, "Battlegear of Valor", 20)    // an unnamed copy, Season of Discovery
            .Item(30, null, 5, 101, Cloth).Set(2098, "Manaflare Regalia", 30)     // Forever
            .Build(sodSets: new HashSet<int> { 1704, 1682 });
        Assert.Null(sets.Get(1704));
        Assert.Null(sets.Get(1682));
        Assert.True(sets.Get(2098)!.NewInForever);
        Assert.DoesNotContain(sets.Search(new SetQuery(IncludeInternal: true)).Sets, x => x.SetId is 1704 or 1682);
        Assert.DoesNotContain(10, sets.PieceItemIds());
        Assert.DoesNotContain(sets.Notable("alliance", [8]).SelectMany(g => g.Sets), x => x.SetId == 1704);
    }

    [Fact]
    public void NotableListsNewInForeverSetsAfterTheTiersInClassThenNameOrder()
    {
        var sets = Named()
            .Item(10, null, 5, 100, Cloth).Set(2100, "Whispering Garb", 10)        // cloth: Priest, Mage, Warlock
            .Item(20, null, 5, 101, Cloth).Set(2101, "Arcanist Insight", 20)       // Mage by name
            .Item(30, null, 5, 102, Plate).Set(2102, "Whispering Plate", 30)       // Warrior, Paladin
            .Item(40, null, 13, 103).Set(2103, "Whispering Blades", 40)            // no armor: every class
            .Item(50, null, 5, 104, Cloth).Set(2104, "Battlegear of Wrath", 50)    // a tier name: Tier 2, not the new-in-Forever group
            .Build();
        var mage = sets.Notable("alliance", [8]);
        Assert.Equal(NotableSets.NewInForever, mage[^1].Group);
        // Class order goes by the first class in the mask: cloth (Priest first) before Mage only, every class last.
        Assert.Equal(["Whispering Garb", "Arcanist Insight", "Whispering Blades"], mage[^1].Sets.Select(x => x.Name));
        var warrior = sets.Notable("alliance", [1]).Single(g => g.Group == NotableSets.NewInForever);
        Assert.Equal(["Whispering Plate", "Whispering Blades"], warrior.Sets.Select(x => x.Name));
        Assert.Equal(NotableSets.NewInForever, NotableSets.GroupOrder[^1]);
    }
}
