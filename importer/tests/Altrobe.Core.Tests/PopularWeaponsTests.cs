using Altrobe.Core.Catalog;
using Altrobe.Core.Tables;
using static Altrobe.Core.Tests.Fake;

namespace Altrobe.Core.Tests;

// The Weapons tab's lists (Phase 4 — Find Panel Spec, Step 3). Made-up item IDs unless a test says otherwise.
public class PopularWeaponsTests
{
    // Item subclasses (ItemCatalog.WeaponTypes) and inventory types.
    const int Axe2H = 1, Bow = 2, Mace1H = 4, Polearm = 6, Sword1H = 7, Sword2H = 8, Staff = 10, Dagger = 15, Wand = 19;
    const int OneHand = 13, TwoHand = 17, Ranged = 15, RangedRight = 26, Shield = 14, HeldInOffHand = 23;

    sealed class Fixture
    {
        readonly InMemoryTables _t = new();

        public Fixture Weapon(int id, string name, int subclass, int inventoryType, int allowableClass = -1) => Item(id, name, 2, subclass, inventoryType, allowableClass);

        // Item class 4 (armor): subclass 6 is a shield, 0 a miscellaneous held item.
        public Fixture OffHand(int id, string name, int inventoryType) => Item(id, name, 4, inventoryType == Shield ? 6 : 0, inventoryType);

        Fixture Item(int id, string name, int itemClass, int subclass, int inventoryType, int allowableClass = -1)
        {
            _t.Add(GameTableNames.ItemSparse, R(("ID", id), ("Display_lang", name), ("InventoryType", (byte)inventoryType), ("OverallQualityID", (byte)4), ("AllowableClass", allowableClass)))
                .Add(GameTableNames.Item, R(("ID", id), ("InventoryType", (byte)inventoryType), ("ClassID", (byte)itemClass), ("SubclassID", (byte)subclass)))
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

    static PopularWeaponsList List(int[]? all = null, Dictionary<int, ClassWeapons>? classes = null, int[]? newInForever = null) =>
        new(all ?? [], classes ?? [], newInForever ?? []);

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
    public void NewInForeverWeaponsFollowTheClassRulesAfterTheOtherGroups()
    {
        // 300001: a new two-hand axe; 300002: a new one-hand sword; 300003: a new bow.
        var items = Arsenal().Weapon(300001, "Forest Defender's Axe", Axe2H, TwoHand).Weapon(300002, "Ironwood Blade", Sword1H, OneHand)
            .Weapon(300003, "New Bow", Bow, Ranged).Items();
        var weapons = new PopularWeapons(items, List(classes: new() { [8] = new([5], [], []), [1] = new([6], [], []) }, newInForever: [300001, 300002, 300003]));
        Assert.Equal([(PopularWeapons.TwoHand, "Staff of Dominance"), (PopularWeapons.NewInForever, "Ironwood Blade")],
            weapons.For(8).Select(g => (g.Group, string.Join(',', g.Items.Select(i => i.Name)))));
        // Warriors get the axe, the sword and the bow (warriors and rogues shoot bows too); a priest gets none of them.
        Assert.Equal("Forest Defender's Axe,Ironwood Blade,New Bow", string.Join(',', weapons.For(1)[^1].Items.Select(i => i.Name)));
        Assert.Equal("Forest Defender's Axe,Ironwood Blade,New Bow", string.Join(',', weapons.For(3)[^1].Items.Select(i => i.Name)));
        Assert.Equal(PopularWeapons.NewInForever, weapons.For(null)[^1].Group);
        Assert.Equal(3, weapons.For(null)[^1].Items.Count);
    }

    [Fact]
    public void NewInForeverHeldItemsShowForEveryClassAndShieldsForShieldClasses()
    {
        // 300010: a new shield; 300011: a new held off-hand item, which needs no proficiency.
        var items = Arsenal().OffHand(300010, "Evergreen Shield", Shield).OffHand(300011, "Fermented Restoration Potion", HeldInOffHand).Items();
        var weapons = new PopularWeapons(items, List(newInForever: [300010, 300011]));
        Assert.Empty(weapons.Problems());
        Assert.Equal("Evergreen Shield,Fermented Restoration Potion", string.Join(',', weapons.For(7)[^1].Items.Select(i => i.Name))); // shaman
        Assert.Equal("Fermented Restoration Potion", string.Join(',', weapons.For(8)[^1].Items.Select(i => i.Name))); // mage
        Assert.Equal("Fermented Restoration Potion", string.Join(',', weapons.For(4)[^1].Items.Select(i => i.Name))); // rogue
    }

    [Fact]
    public void ShieldsAndHeldItemsShowAsTheOffHandGroupBeforeRanged()
    {
        var items = Arsenal().OffHand(20, "Drillborer Disk", Shield).OffHand(21, "Tome of Shadow Force", HeldInOffHand).Items();
        var weapons = new PopularWeapons(items, List(classes: new() { [7] = new([5], [7], [], OffHand: [20, 21]) }));
        Assert.Empty(weapons.Problems());
        Assert.Equal([(PopularWeapons.TwoHand, "Staff of Dominance"), (PopularWeapons.OneHand, "Aurastone Hammer"), (PopularWeapons.OffHand, "Drillborer Disk,Tome of Shadow Force")],
            weapons.For(7).Select(g => (g.Group, string.Join(',', g.Items.Select(i => i.Name)))));
    }

    [Fact]
    public void ProblemsNameAShieldTheClassCannotCarryAndAWeaponInTheOffHandGroup()
    {
        // Mages carry no shield; any class may hold an off-hand item. Off-hand weapons belong with the one-hand ones.
        var items = Arsenal().OffHand(20, "Drillborer Disk", Shield).OffHand(21, "Tome of Shadow Force", HeldInOffHand).Items();
        var weapons = new PopularWeapons(items, List(classes: new() { [8] = new([], [], [], OffHand: [20, 21, 2]) }));
        Assert.Equal([
            "class 8 off hand: 20 (Drillborer Disk) is a shield, which class 8 can't use",
            "class 8 off hand: 2 (Thunderfury) is one-hand",
        ], weapons.Problems());
    }

    [Fact]
    public void CastersShootWandsFromTheRangedGroup()
    {
        var items = Arsenal().Weapon(22, "Touch of Chaos", Wand, RangedRight).Items();
        var weapons = new PopularWeapons(items, List(classes: new() { [9] = new([], [], [22]) }));
        Assert.Empty(weapons.Problems());
        Assert.Equal([(PopularWeapons.Ranged, "Touch of Chaos")], weapons.For(9).Select(g => (g.Group, string.Join(',', g.Items.Select(i => i.Name)))));
    }

    [Fact]
    public void ProblemsNameAnItemMadeForOtherClasses()
    {
        // Rhok'delar is a hunter's bow (class mask 4: bit 2 for class 3); a warrior can use bows but not this one.
        var items = Arsenal().Weapon(23, "Rhok'delar, Longbow of the Ancient Keepers", Bow, Ranged, allowableClass: 4).Items();
        var weapons = new PopularWeapons(items, List(classes: new() { [1] = new([], [], [23]), [3] = new([], [], [23]) }));
        Assert.Equal(["class 1 ranged: 23 (Rhok'delar, Longbow of the Ancient Keepers) is for other classes"], weapons.Problems());
    }

    [Fact]
    public void DruidsUsePolearmsInForever()
    {
        // Forever lets druids train polearms (checked in the Forever beta, 2026-10-17); Classic Era doesn't.
        var items = Arsenal().Weapon(9, "Halberd of Smiting", Polearm, TwoHand).Weapon(300004, "Bear Poking Stick", Polearm, TwoHand).Items();
        var weapons = new PopularWeapons(items, List(classes: new() { [11] = new([9], [], []) }, newInForever: [300004]));
        Assert.Empty(weapons.Problems());
        Assert.Equal([(PopularWeapons.TwoHand, "Halberd of Smiting"), (PopularWeapons.NewInForever, "Bear Poking Stick")],
            weapons.For(11).Select(g => (g.Group, string.Join(',', g.Items.Select(i => i.Name)))));
    }

    [Fact]
    public void ANewInForeverIdFromClassicEraIsAProblem()
    {
        var weapons = new PopularWeapons(Arsenal().Items(), List(newInForever: [2]));
        Assert.Equal(["new in Forever: 2 (Thunderfury) is in Classic Era (IDs up to 246062)"], weapons.Problems());
    }

    [Fact]
    public void TheShippedListParsesAndCoversEveryClass()
    {
        var list = PopularWeaponsList.Shipped();
        Assert.Equal(12, list.All.Count);
        Assert.Equal([1, 2, 3, 4, 5, 7, 8, 9, 11], list.Classes.Keys.Order());
        Assert.NotEmpty(list.Classes[3].Ranged);
        // Expanded on 2026-10-17: warriors and rogues shoot, casters carry wands, shield classes have shields.
        Assert.All(new[] { 1, 4, 5, 8, 9 }, c => Assert.NotEmpty(list.Classes[c].Ranged));
        Assert.All(new[] { 1, 2, 5, 7, 8, 9, 11 }, c => Assert.NotEmpty(list.Classes[c].OffHand ?? []));
        // Warriors get no daggers (Phase 4 — Find Panel Spec): Fang of the Faceless and The Lobotomizer are rogues'.
        Assert.DoesNotContain(19859, list.Classes[1].OneHand);
        Assert.DoesNotContain(19324, list.Classes[1].OneHand);
        Assert.Contains(18805, list.Classes[3].OneHand); // Core Hound Tooth
        Assert.Empty(list.Classes[4].TwoHand);
        Assert.All(list.Classes, c => Assert.Equal(c.Value.TwoHand.Concat(c.Value.OneHand).Concat(c.Value.OffHand ?? []).Concat(c.Value.Ranged).Count(),
            c.Value.TwoHand.Concat(c.Value.OneHand).Concat(c.Value.OffHand ?? []).Concat(c.Value.Ranged).Distinct().Count()));
        // Expanded on 2026-10-15: every class has at least 15 weapons, and Forever's own weapons are listed.
        Assert.All(list.Classes, c => Assert.True(c.Value.TwoHand.Count + c.Value.OneHand.Count + c.Value.Ranged.Count >= 15, $"class {c.Key}"));
        // Expanded on 2026-10-24 to every new-in-Forever weapon, shield and held item with a look Classic never had.
        Assert.True(list.NewInForever.Count >= 60);
        Assert.Equal(list.NewInForever.Count, list.NewInForever.Distinct().Count());
    }
}
