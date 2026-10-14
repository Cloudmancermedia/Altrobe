using Altrobe.Core.Catalog;
using Altrobe.Core.Tables;
using static Altrobe.Core.Tests.Fake;

namespace Altrobe.Core.Tests;

// Data-mined sets: sets whose pieces are all unnamed and mostly use looks no named item has
// (Phase 4 — Data-Mined Sets Spec). Made-up item, display and set IDs.
public class DataMinedSetsTests
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

        // eraSets: set IDs Classic Era has (Season of Discovery's data-mined sets are among them).
        public SetCatalog Build(IReadOnlyDictionary<int, int[]>? curated = null, IReadOnlySet<int>? eraSets = null)
        {
            var items = new ItemCatalog(_t);
            return new SetCatalog(_t, items, curated ?? new Dictionary<int, int[]>(), eraSets ?? new HashSet<int>());
        }
    }

    // Named plate pieces (displays 900, 901) that unnamed copies can reuse.
    static Fixture Named() => new Fixture()
        .Item(1, "Named Helm", 1, 900, Plate).Item(2, "Named Breastplate", 5, 901, Plate);

    [Fact]
    public void AnUnnamedSetWithNewLooksIsDataMinedAndKnowsItsArmorType()
    {
        var sets = Named().Item(10, null, 1, 100, Cloth).Item(11, null, 5, 101, Cloth).Set(1600, "Whispering Garb", 10, 11).Build();
        var set = sets.Get(1600)!;
        Assert.True(set.DataMined);
        Assert.Equal("cloth", set.Armor);
    }

    [Fact]
    public void AnUnnamedCopyOfNamedLooksIsNotDataMined()
    {
        var sets = Named().Item(10, null, 1, 900, Plate).Item(11, null, 5, 901, Plate).Set(1600, "Battlegear of Valor", 10, 11).Build();
        Assert.False(sets.Get(1600)!.DataMined);
    }

    [Fact]
    public void AtLeastHalfThePiecesMustHaveNewLooks()
    {
        var sets = Named()
            .Item(10, null, 1, 900, Plate).Item(11, null, 5, 101, Plate).Set(1600, "Half New", 10, 11)
            .Item(20, null, 1, 900, Plate).Item(21, null, 5, 901, Plate).Item(22, null, 7, 102, Plate).Set(1601, "Third New", 20, 21, 22)
            .Build();
        Assert.True(sets.Get(1600)!.DataMined);
        Assert.False(sets.Get(1601)!.DataMined);
    }

    [Fact]
    public void ASetWithANamedPieceOrADeveloperNameIsNotDataMined()
    {
        var sets = Named()
            .Item(10, null, 1, 100, Cloth).Item(11, "Real Robe", 5, 101, Cloth).Set(1600, "Mixed Set", 10, 11)
            .Item(20, null, 1, 102, Cloth).Set(1601, "Test Set [PH]", 20)
            .Build();
        Assert.False(sets.Get(1600)!.DataMined);
        Assert.False(sets.Get(1601)!.DataMined);
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
    public void TheCuratedFileGivesClassesWhenTheNameDoesNot()
    {
        var sets = Named().Item(10, null, 5, 100, Cloth).Set(1600, "Whispering Garb", 10).Build(new Dictionary<int, int[]> { [1600] = [5, 9] });
        Assert.Equal((Mask(5, 9), "curated"), (sets.Get(1600)!.ClassMask, sets.Get(1600)!.ClassSource));
    }

    [Fact]
    public void TheNameWinsOverTheCuratedFile()
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
    public void SetsThatAreNotDataMinedKeepTheirClassAndHaveNoSource()
    {
        var sets = Named().Set(1600, "Named Set", 1, 2).Build();
        var set = sets.Get(1600)!;
        Assert.False(set.DataMined);
        Assert.Null(set.ClassSource);
        Assert.Equal(-1, set.ClassMask);
    }

    [Fact]
    public void ADataMinedSetClassicEraHasIsFromSeasonOfDiscoveryAndAnyOtherIsNewInForever()
    {
        var sets = Named()
            .Item(10, null, 5, 100, Cloth).Set(1704, "Arcanist Insight", 10)
            .Item(20, null, 5, 101, Cloth).Set(2098, "Manaflare Regalia", 20)
            .Build(eraSets: new HashSet<int> { 1704, 1 });
        Assert.Equal("season-of-discovery", sets.Get(1704)!.Origin);
        Assert.Equal("forever", sets.Get(2098)!.Origin);
    }

    [Fact]
    public void NotableListsNewInForeverAfterTheTiersAndSeasonOfDiscoveryLastInClassThenNameOrder()
    {
        var sets = Named()
            .Item(10, null, 5, 100, Cloth).Set(2100, "Whispering Garb", 10)        // cloth: Priest, Mage, Warlock
            .Item(20, null, 5, 101, Cloth).Set(1704, "Arcanist Insight", 20)       // Mage by name; Season of Discovery
            .Item(30, null, 5, 102, Plate).Set(2102, "Whispering Plate", 30)       // Warrior, Paladin
            .Item(40, null, 13, 103).Set(2103, "Whispering Blades", 40)            // no armor: every class
            .Item(50, null, 5, 104, Cloth).Set(2104, "Battlegear of Wrath", 50)    // a tier name: Tier 2, in no data-mined group
            .Build(eraSets: new HashSet<int> { 1704 });
        var mage = sets.Notable("alliance", [8]);
        Assert.Equal([NotableSets.NewInForever, NotableSets.SeasonOfDiscovery], mage.Select(g => g.Group).TakeLast(2));
        // Class order goes by the first class in the mask: cloth (Priest first), then every class.
        Assert.Equal(["Whispering Garb", "Whispering Blades"], mage[^2].Sets.Select(x => x.Name));
        Assert.Equal(["Arcanist Insight"], mage[^1].Sets.Select(x => x.Name));
        var warrior = sets.Notable("alliance", [1]);
        Assert.Equal(["Whispering Plate", "Whispering Blades"], warrior.Single(g => g.Group == NotableSets.NewInForever).Sets.Select(x => x.Name));
        Assert.DoesNotContain(warrior, g => g.Group == NotableSets.SeasonOfDiscovery);
        Assert.Equal([NotableSets.NewInForever, NotableSets.SeasonOfDiscovery], NotableSets.GroupOrder.TakeLast(2));
    }
}
