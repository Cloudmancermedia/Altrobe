using Altrobe.Core.Catalog;
using Altrobe.Core.Tables;
using static Altrobe.Core.Tests.Fake;

namespace Altrobe.Core.Tests;

// The Weapons tab's lists (Phase 4 — Find Panel Spec, Step 3). Made-up item IDs unless a test says otherwise.
public class PopularWeaponsTests
{
    // Item subclasses (ItemCatalog.WeaponTypes) and inventory types.
    const int Axe2H = 1, Bow = 2, Mace1H = 4, Sword1H = 7, Sword2H = 8, Staff = 10, Dagger = 15;
    const int OneHand = 13, TwoHand = 17, Ranged = 15;

    sealed class Fixture
    {
        readonly InMemoryTables _t = new();

        public Fixture Weapon(int id, string name, int subclass, int inventoryType)
        {
            _t.Add(GameTableNames.ItemSparse, R(("ID", id), ("Display_lang", name), ("InventoryType", (byte)inventoryType), ("OverallQualityID", (byte)4)))
                .Add(GameTableNames.Item, R(("ID", id), ("InventoryType", (byte)inventoryType), ("ClassID", (byte)2), ("SubclassID", (byte)subclass)))
                .Add(GameTableNames.ItemModifiedAppearance, R(("ID", id), ("ItemID", id), ("ItemAppearanceModifierID", 0), ("OrderIndex", 0), ("ItemAppearanceID", id)))
                .Add(GameTableNames.ItemAppearance, R(("ID", id), ("ItemDisplayInfoID", id)))
                .Add(GameTableNames.ItemDisplayInfo, R(("ID", id)));
            return this;
        }

        public Fixture Armor(int id, string name)
        {
            _t.Add(GameTableNames.ItemSparse, R(("ID", id), ("Display_lang", name), ("InventoryType", (byte)1), ("OverallQualityID", (byte)4)))
                .Add(GameTableNames.Item, R(("ID", id), ("InventoryType", (byte)1), ("ClassID", (byte)4), ("SubclassID", (byte)4)))
                .Add(GameTableNames.ItemModifiedAppearance, R(("ID", id), ("ItemID", id), ("ItemAppearanceModifierID", 0), ("OrderIndex", 0), ("ItemAppearanceID", id)))
                .Add(GameTableNames.ItemAppearance, R(("ID", id), ("ItemDisplayInfoID", id)))
                .Add(GameTableNames.ItemDisplayInfo, R(("ID", id)));
            return this;
        }

        public ItemCatalog Items() => new(_t);
    }

    static Fixture Arsenal() => new Fixture()
        .Weapon(1, "Arcanite Reaper", Axe2H, TwoHand).Weapon(2, "Thunderfury", Sword1H, OneHand)
        .Weapon(3, "Perdition's Blade", Dagger, OneHand).Weapon(4, "Rhok'delar", Bow, Ranged)
        .Weapon(5, "Staff of Dominance", Staff, TwoHand).Weapon(6, "Ashkandi", Sword2H, TwoHand)
        .Weapon(7, "Aurastone Hammer", Mace1H, OneHand).Armor(8, "Helm of Wrath");

    static PopularWeaponsList List(int[]? all = null, Dictionary<int, ClassWeapons>? classes = null) =>
        new(all ?? [], classes ?? []);

    [Fact]
    public void AClassSeesItsTwoHandOneHandAndRangedGroupsInListOrder()
    {
        var weapons = new PopularWeapons(Arsenal().Items(), List(classes: new() { [3] = new([6, 1], [2], [4]) }));
        var hunter = weapons.For(3);
        Assert.Equal([PopularWeapons.TwoHand, PopularWeapons.OneHand, PopularWeapons.Ranged], hunter.Select(g => g.Group));
        Assert.Equal(["Ashkandi", "Arcanite Reaper"], hunter[0].Items.Select(i => i.Name));
    }

    [Fact]
    public void EmptyGroupsAreLeftOut()
    {
        var weapons = new PopularWeapons(Arsenal().Items(), List(classes: new() { [4] = new([], [3, 2], []) }));
        Assert.Equal([PopularWeapons.OneHand], weapons.For(4).Select(g => g.Group));
    }

    [Fact]
    public void NoClassShowsThePopularListAndAClassWithNoListShowsNothing()
    {
        var weapons = new PopularWeapons(Arsenal().Items(), List(all: [2, 1]));
        Assert.Equal([(PopularWeapons.Popular, "Thunderfury,Arcanite Reaper")], weapons.For(null).Select(g => (g.Group, string.Join(',', g.Items.Select(i => i.Name)))));
        Assert.Empty(weapons.For(9));
    }

    [Fact]
    public void ProblemsNameAnIdThatIsMissingNotAWeaponOrInTheWrongGroup()
    {
        var weapons = new PopularWeapons(Arsenal().Items(), List(all: [99], classes: new() { [1] = new([8, 2], [], []) }));
        Assert.Equal([
            "all: 99 is not in this build",
            "class 1 two-hand: 8 (Helm of Wrath) is not a weapon",
            "class 1 two-hand: 2 (Thunderfury) is one-hand",
        ], weapons.Problems());
    }

    [Fact]
    public void ProblemsNameAWeaponTheClassCannotUse()
    {
        // Druids use staves and maces, not two-hand axes; mages no bows; priests no one-hand swords.
        var weapons = new PopularWeapons(Arsenal().Items(), List(classes: new()
        {
            [11] = new([5, 1], [7], []),
            [8] = new([], [], [4]),
            [5] = new([], [2], []),
        }));
        Assert.Equal([
            "class 11 two-hand: 1 (Arcanite Reaper) is a two-hand axe, which class 11 can't use",
            "class 8 ranged: 4 (Rhok'delar) is a bow, which class 8 can't use",
            "class 5 one-hand: 2 (Thunderfury) is a sword, which class 5 can't use",
        ], weapons.Problems());
    }

    [Fact]
    public void TheShippedListParsesAndCoversEveryClass()
    {
        var list = PopularWeaponsList.Shipped();
        Assert.Equal(12, list.All.Count);
        Assert.Equal([1, 2, 3, 4, 5, 7, 8, 9, 11], list.Classes.Keys.Order());
        Assert.NotEmpty(list.Classes[3].Ranged);
        Assert.Empty(list.Classes[4].TwoHand);
        Assert.All(list.Classes, c => Assert.Equal(c.Value.TwoHand.Concat(c.Value.OneHand).Concat(c.Value.Ranged).Count(),
            c.Value.TwoHand.Concat(c.Value.OneHand).Concat(c.Value.Ranged).Distinct().Count()));
    }
}
