using System.Text.Json;

namespace Altrobe.Core.Catalog;

public sealed record WeaponGroup(string Group, IReadOnlyList<ItemSummary> Items);

// One class's lists, in display order. Ranged is for hunters: no class gets wands (no wand attack yet).
public sealed record ClassWeapons(IReadOnlyList<int> TwoHand, IReadOnlyList<int> OneHand, IReadOnlyList<int> Ranged);

// All: shown when no class is picked. Classes: class ID to its lists.
public sealed record PopularWeaponsList(IReadOnlyList<int> All, IReadOnlyDictionary<int, ClassWeapons> Classes)
{
    // popular-weapons.json, item IDs only (Phase 4 — Find Panel Spec, Step 3).
    public static PopularWeaponsList Shipped()
    {
        using var s = typeof(PopularWeaponsList).Assembly.GetManifestResourceStream("Catalog/popular-weapons.json")!;
        var file = JsonSerializer.Deserialize<FileShape>(s, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        return new(file.All, file.Classes.ToDictionary(c => int.Parse(c.Key), c => new ClassWeapons(c.Value.TwoHand ?? [], c.Value.OneHand ?? [], c.Value.Ranged ?? [])));
    }

    sealed record FileShape(int[] All, Dictionary<string, ClassShape> Classes);
    sealed record ClassShape(int[]? TwoHand, int[]? OneHand, int[]? Ranged);
}

// The Weapons tab: popular weapons for a class, grouped Two-hand, One-hand, Ranged, or "Popular" with no
// class. A class sees its own weapons, not everything it can wield (no daggers for warriors).
public sealed class PopularWeapons(ItemCatalog items, PopularWeaponsList? list = null)
{
    public const string Popular = "Popular", TwoHand = "Two-hand", OneHand = "One-hand", Ranged = "Ranged";
    readonly PopularWeaponsList _list = list ?? PopularWeaponsList.Shipped();

    // Classic's weapon proficiencies. A two-hand axe, mace or sword is its own skill; the rest are one
    // skill whatever the hands. Druids have no polearms in Classic (Wrath of the Lich King added them).
    public static readonly IReadOnlyDictionary<int, IReadOnlySet<string>> Usable = new Dictionary<int, IReadOnlySet<string>>
    {
        [1] = Set("axe", "two-hand axe", "mace", "two-hand mace", "sword", "two-hand sword", "polearm", "staff", "dagger", "fist weapon", "bow", "gun", "crossbow", "thrown"),
        [2] = Set("axe", "two-hand axe", "mace", "two-hand mace", "sword", "two-hand sword", "polearm"),
        [3] = Set("axe", "two-hand axe", "sword", "two-hand sword", "polearm", "staff", "dagger", "fist weapon", "bow", "gun", "crossbow", "thrown"),
        [4] = Set("dagger", "sword", "mace", "fist weapon", "bow", "gun", "crossbow", "thrown"),
        [5] = Set("dagger", "mace", "staff", "wand"),
        [7] = Set("axe", "two-hand axe", "mace", "two-hand mace", "staff", "dagger", "fist weapon"),
        [8] = Set("dagger", "sword", "staff", "wand"),
        [9] = Set("dagger", "sword", "staff", "wand"),
        [11] = Set("dagger", "mace", "two-hand mace", "staff", "fist weapon"),
    };

    static IReadOnlySet<string> Set(params string[] skills) => skills.ToHashSet();

    // The skill an item needs: "two-hand sword" for a two-handed axe, mace or sword, else its weapon type.
    static string Skill(ItemSummary i) => i.Hands == "two-hand" && i.Weapon is "axe" or "mace" or "sword" ? $"two-hand {i.Weapon}" : i.Weapon!;

    public IReadOnlyList<WeaponGroup> For(int? classId)
    {
        if (classId is not { } c) return Groups((Popular, _list.All));
        return _list.Classes.TryGetValue(c, out var w) ? Groups((TwoHand, w.TwoHand), (OneHand, w.OneHand), (Ranged, w.Ranged)) : [];
    }

    IReadOnlyList<WeaponGroup> Groups(params (string Group, IReadOnlyList<int> Ids)[] lists) => lists
        .Select(l => new WeaponGroup(l.Group, l.Ids.Select(items.Get).OfType<ItemSummary>().ToList()))
        .Where(g => g.Items.Count > 0)
        .ToList();

    // What is wrong with the list against this build: an ID that is missing, not a weapon, in the wrong
    // group for its hands, or a type its class can't use. The bake fails on any.
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        void Check(string where, int id, Func<ItemSummary, string?> rule)
        {
            if (items.Get(id) is not { } i) problems.Add($"{where}: {id} is not in this build");
            else if (i.Weapon == null) problems.Add($"{where}: {id} ({i.Name}) is not a weapon");
            else if (rule(i) is { } problem) problems.Add($"{where}: {id} ({i.Name}) {problem}");
        }
        foreach (var id in _list.All) Check("all", id, _ => null);
        foreach (var (c, w) in _list.Classes)
        {
            string? Usable(ItemSummary i) => PopularWeapons.Usable.TryGetValue(c, out var skills) && skills.Contains(Skill(i)) ? null : $"is a {Skill(i)}, which class {c} can't use";
            foreach (var id in w.TwoHand) Check($"class {c} two-hand", id, i => i.Hands != "two-hand" ? $"is {i.Hands}" : Usable(i));
            foreach (var id in w.OneHand) Check($"class {c} one-hand", id, i => i.Hands is not ("one-hand" or "main hand" or "off hand") ? $"is {i.Hands}" : Usable(i));
            foreach (var id in w.Ranged) Check($"class {c} ranged", id, i => i.Hands != "ranged" ? $"is {i.Hands}" : Usable(i));
        }
        return problems;
    }
}
