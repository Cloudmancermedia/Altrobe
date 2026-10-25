using System.Text.Json;

namespace Altrobe.Core.Catalog;

public sealed record WeaponGroup(string Group, IReadOnlyList<ItemSummary> Items);

// One class's lists. OffHand: shields and held off-hand items (off-hand weapons are in OneHand). Ranged:
// bows, guns and crossbows, or wands for casters.
public sealed record ClassWeapons(IReadOnlyList<int> TwoHand, IReadOnlyList<int> OneHand, IReadOnlyList<int> Ranged, IReadOnlyList<int>? OffHand = null);

// All: shown when no class is picked. Classes: class ID to its lists. NewInForever: weapons Forever added
// (not in Classic Era) with a look of their own, shown to each class that can use them.
public sealed record PopularWeaponsList(IReadOnlyList<int> All, IReadOnlyDictionary<int, ClassWeapons> Classes, IReadOnlyList<int> NewInForever)
{
    // popular-weapons.json, item IDs only (Phase 4 — Find Panel Spec, Step 3).
    public static PopularWeaponsList Shipped()
    {
        using var s = typeof(PopularWeaponsList).Assembly.GetManifestResourceStream("Catalog/popular-weapons.json")!;
        var file = JsonSerializer.Deserialize<FileShape>(s, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        return new(file.All, file.Classes.ToDictionary(c => int.Parse(c.Key), c => new ClassWeapons(c.Value.TwoHand ?? [], c.Value.OneHand ?? [], c.Value.Ranged ?? [], c.Value.OffHand ?? [])), file.NewInForever ?? []);
    }

    sealed record FileShape(int[] All, Dictionary<string, ClassShape> Classes, int[]? NewInForever);
    sealed record ClassShape(int[]? TwoHand, int[]? OneHand, int[]? Ranged, int[]? OffHand);
}

// The Weapons tab: popular weapons for a class, grouped Two-hand, One-hand, Off hand, Ranged, or "Popular"
// with no class. A class sees its own weapons, not everything it can wield (no daggers for warriors).
public sealed class PopularWeapons(ItemCatalog items, PopularWeaponsList? list = null)
{
    public const string Popular = "Popular", TwoHand = "Two-hand", OneHand = "One-hand", OffHand = "Off hand", Ranged = "Ranged", NewInForever = "New in Forever";

    readonly PopularWeaponsList _list = list ?? PopularWeaponsList.Shipped();

    // Forever's weapon proficiencies: Classic's, plus polearms for druids (new in Forever; checked in the
    // beta on 2026-10-17). A two-hand axe, mace or sword is its own skill; the rest are one skill whatever
    // the hands.
    public static readonly IReadOnlyDictionary<int, IReadOnlySet<string>> Usable = new Dictionary<int, IReadOnlySet<string>>
    {
        [1] = Set("axe", "two-hand axe", "mace", "two-hand mace", "sword", "two-hand sword", "polearm", "staff", "dagger", "fist weapon", "bow", "gun", "crossbow", "thrown", "shield"),
        [2] = Set("axe", "two-hand axe", "mace", "two-hand mace", "sword", "two-hand sword", "polearm", "shield"),
        [3] = Set("axe", "two-hand axe", "sword", "two-hand sword", "polearm", "staff", "dagger", "fist weapon", "bow", "gun", "crossbow", "thrown"),
        [4] = Set("dagger", "sword", "mace", "fist weapon", "bow", "gun", "crossbow", "thrown"),
        [5] = Set("dagger", "mace", "staff", "wand"),
        [7] = Set("axe", "two-hand axe", "mace", "two-hand mace", "staff", "dagger", "fist weapon", "shield"),
        [8] = Set("dagger", "sword", "staff", "wand"),
        [9] = Set("dagger", "sword", "staff", "wand"),
        [11] = Set("dagger", "mace", "two-hand mace", "polearm", "staff", "fist weapon"),
    };

    static IReadOnlySet<string> Set(params string[] skills) => skills.ToHashSet();

    // The skill an item needs: "two-hand sword" for a two-handed axe, mace or sword, "shield" for a shield,
    // else its weapon type. A held off-hand item needs none.
    static string? Skill(ItemSummary i) => i.Hands == "shield" ? "shield"
        : i.Hands == "two-hand" && i.Weapon is "axe" or "mace" or "sword" ? $"two-hand {i.Weapon}" : i.Weapon;

    static bool IsOffHandItem(ItemSummary i) => i.Hands is "shield" or "held in off hand";

    // AllowableClass: -1 for any class, else bit classId - 1 (Rhok'delar is for hunters only).
    static bool MadeFor(int classId, ItemSummary i) => i.AllowableClass == -1 || (i.AllowableClass & (1 << (classId - 1))) != 0;

    public IReadOnlyList<WeaponGroup> For(int? classId)
    {
        if (classId is not { } c) return Groups((Popular, _list.All), (NewInForever, _list.NewInForever));
        // Forever's weapons, shields and held items for this class: the ones its proficiencies allow. A held
        // item needs none, so every class sees those.
        var forever = _list.NewInForever.Where(id => items.Get(id) is { } i && (i.Weapon != null || IsOffHandItem(i)) && CanUse(c, i) && MadeFor(c, i)).ToList();
        var own = _list.Classes.TryGetValue(c, out var w) ? new[] { (TwoHand, w.TwoHand), (OneHand, w.OneHand), (OffHand, w.OffHand ?? []), (Ranged, w.Ranged) } : [];
        return Groups([.. own, (NewInForever, forever)]);
    }

    static bool CanUse(int classId, ItemSummary i) => Skill(i) is not { } skill || Usable.TryGetValue(classId, out var skills) && skills.Contains(skill);

    IReadOnlyList<WeaponGroup> Groups(params (string Group, IReadOnlyList<int> Ids)[] lists) => lists
        .Select(l => new WeaponGroup(l.Group, l.Ids.Select(items.Get).OfType<ItemSummary>().ToList()))
        .Where(g => g.Items.Count > 0)
        .ToList();

    // What is wrong with the list against this build: an ID that is missing, not a weapon (or shield or held
    // item), in the wrong group for its hands, a type its class can't use, or made for other classes. The
    // bake fails on any.
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        void Check(string where, int id, Func<ItemSummary, string?> rule)
        {
            if (items.Get(id) is not { } i) problems.Add($"{where}: {id} is not in this build");
            else if (i.Weapon == null && !IsOffHandItem(i)) problems.Add($"{where}: {id} ({i.Name}) is not a weapon");
            else if (rule(i) is { } problem) problems.Add($"{where}: {id} ({i.Name}) {problem}");
        }
        foreach (var id in _list.All) Check("all", id, _ => null);
        foreach (var id in _list.NewInForever) Check("new in Forever", id, _ => id <= ItemCatalog.ClassicEraMaxItemId ? $"is in Classic Era (IDs up to {ItemCatalog.ClassicEraMaxItemId})" : null);
        foreach (var (c, w) in _list.Classes)
        {
            string? Usable(ItemSummary i) => !CanUse(c, i) ? $"is a {Skill(i)}, which class {c} can't use" : !MadeFor(c, i) ? "is for other classes" : null;
            foreach (var id in w.TwoHand) Check($"class {c} two-hand", id, i => i.Hands != "two-hand" ? $"is {i.Hands}" : Usable(i));
            foreach (var id in w.OneHand) Check($"class {c} one-hand", id, i => i.Hands is not ("one-hand" or "main hand" or "off hand") ? $"is {i.Hands}" : Usable(i));
            foreach (var id in w.OffHand ?? []) Check($"class {c} off hand", id, i => !IsOffHandItem(i) ? $"is {i.Hands}" : Usable(i));
            foreach (var id in w.Ranged) Check($"class {c} ranged", id, i => i.Hands != "ranged" ? $"is {i.Hands}" : Usable(i));
        }
        return problems;
    }
}
