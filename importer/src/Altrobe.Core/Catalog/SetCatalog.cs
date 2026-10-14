using System.Text.Json;
using System.Text.Json.Serialization;
using Altrobe.Core.Tables;
using T = Altrobe.Core.Tables.GameTableNames;

namespace Altrobe.Core.Catalog;

public sealed record SetPiece(string Slot, ItemSummary Item);

public sealed record SkippedPiece(int ItemId, string Reason);

// Internal: a developer or placeholder set by its name (ItemCatalog.IsInternal). Listed last.
// Unnamed: every piece is unnamed in this build (ItemSummary.Unnamed), as tier 2 is in the Forever beta.
// ClassMask: the classes every class-restricted piece allows (bit classId - 1), -1 when no piece is restricted.
// Quality: the best piece quality; for an unnamed tier set, its tier's (NotableSets.TierQuality); else null.
// DataMined: every piece unnamed and at least half of them a look no named item has (SetCatalog). For
// these only: Armor, the pieces' armor type; ClassMask from ClassSource, "name" (NotableSets.ClassByName),
// "curated" (data-mined-classes.json) or "armor" (NotableSets.ArmorClasses; -1 with no armor piece).
public sealed record ItemSetInfo(int SetId, string Name, IReadOnlyList<SetPiece> Pieces, IReadOnlyList<SkippedPiece> Skipped, bool Internal, bool Unnamed = false)
{
    public int ClassMask { get; init; } = -1;
    public int? Quality { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool DataMined { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Armor { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? ClassSource { get; init; }
}

// IncludeInternal: also list developer sets and match developer pieces. An exact set ID finds one either way.
public sealed record SetQuery(string? Text = null, int Limit = 20, int Offset = 0, bool IncludeInternal = false);

public sealed record SetPage(int Total, IReadOnlyList<ItemSetInfo> Sets);

// Item sets from ItemSet, each with the pieces that can be shown and the look slot each goes in.
// Slots are assigned in the set's order: an item's own slot if free, else another slot it fits (a
// second one-hander goes in the off hand), else it is skipped. Sets with no piece to show are left out.
public sealed class SetCatalog
{
    public const int MaxLimit = 50;
    readonly IReadOnlyList<ItemSetInfo> _sets;
    readonly Dictionary<int, ItemSetInfo> _byId;

    // curated: set ID -> class IDs for data-mined sets the name doesn't place. Defaults to the shipped
    // data-mined-classes.json.
    public SetCatalog(ITables tables, ItemCatalog items, IReadOnlyDictionary<int, int[]>? curated = null)
    {
        curated ??= CuratedClasses();
        var namedLooks = items.All.Where(i => !i.Unnamed).Select(i => i.DisplayInfoId).ToHashSet();
        _sets = tables.Get(T.ItemSet)
            .Select(r => Build(r, items))
            .Where(s => s.Pieces.Count > 0)
            .Select(s => IsDataMined(s, namedLooks) ? WithDataMinedClass(s, curated) : s)
            .OrderBy(s => s.Internal)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(s => s.SetId)
            .ToList();
        _byId = _sets.ToDictionary(s => s.SetId);
    }

    public int Count => _sets.Count;

    // Every set, in search order (internal sets last, then by name).
    public IReadOnlyList<ItemSetInfo> All => _sets;

    public ItemSetInfo? Get(int setId) => _byId.GetValueOrDefault(setId);

    // Notable sets (NotableSets) for a faction ("alliance" or "horde") and the given classes, grouped
    // PvP (rare), PvP (epic), tiers 0 to 3, then data-mined sets no other group holds; empty groups are left out. A named set wins over an
    // unnamed copy of the same name, and a set repeating another's name and classes is dropped.
    public IReadOnlyList<SetGroup> Notable(string? faction, IReadOnlyCollection<int> classIds)
    {
        var wanted = classIds.Aggregate(0, (m, c) => m | (1 << (c - 1)));
        var picked = _sets
            .Where(s => !s.Internal)
            .Select(s => (set: s, cls: NotableSets.Classify(s)))
            .Where(x => x.cls is { } c && (c.Faction == null || c.Faction == faction) && (c.ClassMask == -1 || (c.ClassMask & wanted) != 0))
            .Select(x => (x.set, group: x.cls!.Value.Group, mask: x.cls.Value.ClassMask))
            .Concat(_sets.Where(s => s.DataMined && NotableSets.Classify(s) == null && (s.ClassMask == -1 || (s.ClassMask & wanted) != 0))
                .Select(s => (set: s, group: NotableSets.DataMined, mask: s.ClassMask)))
            .GroupBy(x => (x.group, name: x.set.Name.ToLowerInvariant(), x.mask))
            .Select(g => g.OrderBy(x => x.set.Unnamed).ThenBy(x => x.set.SetId).First())
            .ToList();
        return NotableSets.GroupOrder
            .Select(group => new SetGroup(group, picked.Where(x => x.group == group)
                .OrderBy(x => TierClassOrder(x.mask)).ThenBy(x => x.set.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.set.SetId)
                .Select(x => x.set).ToList()))
            .Where(g => g.Sets.Count > 0)
            .ToList();
    }

    // Sets list in class order (warrior first), by the first class in the mask; a set for every class last.
    static int TierClassOrder(int mask) => mask == -1 ? int.MaxValue
        : NotableSets.Tiers.ToList().FindIndex(t => (mask & 1 << (t.ClassId - 1)) != 0) is var i and >= 0 ? i : int.MaxValue;

    // Item IDs of every piece of every set, ascending.
    public IReadOnlyList<int> PieceItemIds() => _pieceItemIds ??= _sets.SelectMany(s => s.Pieces.Select(p => p.Item.ItemId)).Distinct().Order().ToList();
    IReadOnlyList<int>? _pieceItemIds;

    public SetPage Search(SetQuery q)
    {
        var text = q.Text?.Trim();
        var id = int.TryParse(text, out var n) ? n : (int?)null;
        var matches = _sets.Where(s => s.SetId == id || ((q.IncludeInternal || !s.Internal) && (string.IsNullOrEmpty(text)
            || s.Name.Contains(text, StringComparison.OrdinalIgnoreCase)
            || s.Pieces.Any(p => (q.IncludeInternal || !p.Item.Internal) && p.Item.Name.Contains(text, StringComparison.OrdinalIgnoreCase))))).ToList();
        return new SetPage(matches.Count, matches.Skip(Math.Max(0, q.Offset)).Take(Math.Clamp(q.Limit, 1, MaxLimit)).ToList());
    }

    // Not internal, every piece unnamed, and at least half the pieces a look no named item has. Unnamed
    // copies of named sets (most of the Forever beta's unnamed sets) reuse every look and stay out.
    static bool IsDataMined(ItemSetInfo set, HashSet<int> namedLooks) =>
        !set.Internal && set.Unnamed && set.Pieces.Count(p => !namedLooks.Contains(p.Item.DisplayInfoId)) * 2 >= set.Pieces.Count;

    // Class from the name, else the curated file, else armor type (spec Step 2); the first that matches wins.
    static ItemSetInfo WithDataMinedClass(ItemSetInfo set, IReadOnlyDictionary<int, int[]> curated)
    {
        var armor = set.Pieces.Select(p => p.Item.Armor).Where(a => a != null)
            .GroupBy(a => a).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();
        var (mask, source) = NotableSets.ClassByName(set.Name) is { } byName ? (byName, "name")
            : curated.TryGetValue(set.SetId, out var ids) && ids.Length > 0 ? (MaskOf(ids), "curated")
            : armor != null ? (MaskOf(NotableSets.ArmorClasses[armor]), "armor")
            : (-1, "armor");
        return set with { DataMined = true, Armor = armor, ClassMask = mask, ClassSource = source };
    }

    static int MaskOf(IEnumerable<int> classIds) => classIds.Aggregate(0, (m, c) => m | (1 << (c - 1)));

    static IReadOnlyDictionary<int, int[]> CuratedClasses()
    {
        using var s = typeof(SetCatalog).Assembly.GetManifestResourceStream("Catalog/data-mined-classes.json")!;
        return JsonSerializer.Deserialize<Dictionary<int, int[]>>(s) ?? [];
    }

    static ItemSetInfo Build(Row set, ItemCatalog items)
    {
        var pieces = new List<SetPiece>();
        var skipped = new List<SkippedPiece>();
        foreach (var itemId in set.Ints("ItemID").Where(i => i != 0))
        {
            if (items.Get(itemId) is not { } item)
            {
                skipped.Add(new SkippedPiece(itemId, "not worn, or has no visual"));
                continue;
            }
            var slots = ItemCatalog.SlotsFor(item);
            var free = slots.FirstOrDefault(s => pieces.All(p => p.Slot != s));
            if (free == null) skipped.Add(new SkippedPiece(itemId, $"{string.Join(" and ", slots)} already taken by this set"));
            else pieces.Add(new SetPiece(free, item));
        }
        var name = set.Str("Name_lang");
        var classMask = pieces.Select(p => p.Item.AllowableClass).Where(m => m is not (-1 or 0)).Aggregate(-1, (all, m) => all & m);
        var known = pieces.Where(p => !p.Item.Unnamed).Select(p => p.Item.Quality).ToList();
        var quality = known.Count > 0 ? known.Max() : NotableSets.TierQuality(name);
        return new ItemSetInfo(set.Int("ID"), name, pieces, skipped, ItemCatalog.IsInternal(name), pieces.Count > 0 && pieces.All(p => p.Item.Unnamed)) { ClassMask = classMask, Quality = quality };
    }
}
