using System.Text.Json;
using Altrobe.Core.Tables;
using T = Altrobe.Core.Tables.GameTableNames;

namespace Altrobe.Core.Spells;

// A model a spell's kit hangs on the caster or target: on body attachment `Attachment` (-1: the world
// position), scaled, offset and turned as SpellVisualKitModelAttach says.
public sealed record SpellModel(int FileDataId, int Attachment, float Scale, float[] Offset, float[] Rotation);

// One SpellVisualEvent: the kit plays from event `Start` to `End` on `Target` (1 caster, 2 target; kept as
// data, since channel kits put the caster's hand glows on 2). `Anim`: the AnimationData ID it plays, if any.
public sealed record SpellKit(int Kit, int Start, int End, int Target, int? Anim, IReadOnlyList<SpellModel> Models);

// The projectile, for Step 3: model, from and to attachments, speed (yards per second), launch delay and
// minimum flight (seconds), motion and how long it lingers after impact (ms; 0 means the game's default).
public sealed record SpellMissile(int FileDataId, int From, int To, float Speed, float LaunchDelay, float MinDuration, int MotionId, int DecayMs);

// One spell, all its player ranks together (they share one visual). CastMs from SpellCastTimes, DurationMs
// from SpellDuration (a channel's or an aura's length).
public sealed record SpellInfo(int SpellId, string Name, int ClassId, IReadOnlyList<int> Ranks, int CastMs, int DurationMs, IReadOnlyList<SpellKit> Kits, SpellMissile? Missile);

// The Spell picker's spells: each class's picks (Catalog/spell-picks.json, first-rank IDs) resolved through
// the game's visual chain: Spell → SpellXSpellVisual → SpellVisualEvent → SpellVisualKit →
// SpellVisualKitEffect (2: a model through SpellVisualKitModelAttach and SpellVisualEffectName; 6: an
// animation through SpellVisualAnim, or its AnimKit's first segment). Sound, camera and procedural effects
// are skipped (Phase 3 — Spell Casts Spec).
public sealed class SpellCatalog
{
    // Kit events whose models the caster shows while casting: precast, cast and channel.
    static readonly int[] CasterEvents = [1, 3, 11];

    readonly Dictionary<int, SpellInfo> _byId = [];
    readonly List<(int ClassId, IReadOnlyList<int> Picks)> _picks = [];
    readonly List<string> _problems = [];

    public SpellCatalog(ITables tables, IReadOnlyDictionary<int, int[]>? picks = null)
    {
        picks ??= ShippedPicks();
        var names = tables.Get(T.SpellName).ToDictionary(r => r.Int("ID"), r => r.Str("Name_lang"));
        var abilities = tables.Get(T.SkillLineAbility).Where(r => r.Int("AcquireMethod") != 3).ToList();
        var visualOf = tables.Get(T.SpellXSpellVisual).Where(r => r.Int("DifficultyID") == 0)
            .GroupBy(r => r.Int("SpellID")).ToDictionary(g => g.Key, g => g.First().Int("SpellVisualID"));
        var misc = tables.Get(T.SpellMisc).Where(r => r.Int("DifficultyID") == 0).GroupBy(r => r.Int("SpellID")).ToDictionary(g => g.Key, g => g.First());
        var castTimes = tables.Get(T.SpellCastTimes).ToDictionary(r => r.Int("ID"), r => r.Int("Base"));
        var durations = tables.Get(T.SpellDuration).ToDictionary(r => r.Int("ID"), r => r.Int("Duration"));
        var events = tables.Get(T.SpellVisualEvent).ToLookup(r => r.Int("SpellVisualID"));
        var effects = tables.Get(T.SpellVisualKitEffect).ToLookup(r => r.Int("ParentSpellVisualKitID"));
        var attaches = tables.Get(T.SpellVisualKitModelAttach).ToDictionary(r => r.Int("ID"));
        var effectNames = tables.Get(T.SpellVisualEffectName).ToDictionary(r => r.Int("ID"));
        var anims = tables.Get(T.SpellVisualAnim).ToDictionary(r => r.Int("ID"));
        var segments = tables.Get(T.AnimKitSegment).ToLookup(r => r.Int("ParentAnimKitID"));
        var visuals = tables.Get(T.SpellVisual).ToDictionary(r => r.Int("ID"));
        var missiles = tables.Get(T.SpellVisualMissile).ToLookup(r => r.Int("SpellVisualMissileSetID"));

        int? AnimOf(int kit)
        {
            foreach (var e in effects[kit].Where(e => e.Int("EffectType") == 6))
            {
                if (!anims.TryGetValue(e.Int("Effect"), out var a)) continue;
                if (a.Int("LoopAnimID") > 0) return a.Int("LoopAnimID");
                if (a.Int("AnimKitID") > 0 && segments[a.Int("AnimKitID")].OrderBy(s => s.Int("OrderIndex")).FirstOrDefault() is { } s) return s.Int("AnimID");
                if (a.Int("InitialAnimID") > 0) return a.Int("InitialAnimID");
            }
            return null;
        }

        List<SpellModel> ModelsOf(int kit) => effects[kit].Where(e => e.Int("EffectType") == 2)
            .Select(e => attaches.GetValueOrDefault(e.Int("Effect")))
            .Where(a => a != null && effectNames.ContainsKey(a.Int("SpellVisualEffectNameID")))
            .Select(a =>
            {
                var name = effectNames[a!.Int("SpellVisualEffectNameID")];
                var scale = (a.Float("Scale") is var s and > 0 ? s : 1) * (name.Float("Scale") is var n and > 0 ? n : 1);
                return new SpellModel(name.Int("ModelFileDataID"), a.Int("AttachmentID"), scale, Pad(a.Floats("Offset")), [a.Float("Yaw"), a.Float("Pitch"), a.Float("Roll")]);
            })
            .Where(m => m.FileDataId > 0)
            .ToList();

        foreach (var (classId, ids) in picks.OrderBy(p => p.Key))
        {
            var resolved = new List<int>();
            foreach (var id in ids)
            {
                if (!names.TryGetValue(id, out var name) || !visualOf.TryGetValue(id, out var visual))
                {
                    _problems.Add($"class {classId}: spell {id} is not in this build");
                    continue;
                }
                var bit = 1 << (classId - 1);
                var ranks = abilities.Where(a => (a.Int("ClassMask") & bit) != 0 && names.GetValueOrDefault(a.Int("Spell")) == name)
                    .Select(a => a.Int("Spell")).Append(id).Distinct().Order().ToList();
                foreach (var rank in ranks)
                    if (visualOf.GetValueOrDefault(rank) is var v && v != visual)
                        _problems.Add($"{name} ({id}): rank {rank} has visual {v}, not {visual}");
                var m = misc.GetValueOrDefault(id);
                var kits = events[visual].OrderBy(e => e.Int("StartEvent")).ThenBy(e => e.Int("TargetType")).ThenBy(e => e.Int("SpellVisualKitID"))
                    .Select(e => new SpellKit(e.Int("SpellVisualKitID"), e.Int("StartEvent"), e.Int("EndEvent"), e.Int("TargetType"), AnimOf(e.Int("SpellVisualKitID")), ModelsOf(e.Int("SpellVisualKitID"))))
                    .ToList();
                var missileRow = visuals.TryGetValue(visual, out var vr) ? missiles[vr.Int("SpellVisualMissileSetID")].FirstOrDefault() : null;
                SpellMissile? missile = missileRow != null && effectNames.TryGetValue(missileRow.Int("SpellVisualEffectNameID"), out var mn) && mn.Int("ModelFileDataID") > 0
                    ? new(mn.Int("ModelFileDataID"), missileRow.Int("Attachment"), missileRow.Int("DestinationAttachment"), m?.Float("Speed") ?? 0,
                        m?.Float("LaunchDelay") ?? 0, m?.Float("MinDuration") ?? 0, missileRow.Int("SpellMissileMotionID"), missileRow.Int("DecayTimeAfterImpact"))
                    : null;
                // A negative cast time (Arcane Shot's -1000000) marks a ranged shot: instant here.
                _byId[id] = new SpellInfo(id, name, classId, ranks, Math.Max(0, castTimes.GetValueOrDefault(m?.Int("CastingTimeIndex") ?? 0)),
                    durations.GetValueOrDefault(m?.Int("DurationIndex") ?? 0), kits, missile);
                resolved.Add(id);
            }
            _picks.Add((classId, resolved));
        }
    }

    static float[] Pad(float[] v) => [v.ElementAtOrDefault(0), v.ElementAtOrDefault(1), v.ElementAtOrDefault(2)];

    public SpellInfo? Get(int spellId) => _byId.GetValueOrDefault(spellId);

    // Every picked spell, by class then pick order.
    public IReadOnlyList<SpellInfo> All => _picks.SelectMany(p => p.Picks.Select(id => _byId[id])).ToList();

    public IReadOnlyList<SpellInfo> ForClass(int classId) => _picks.Where(p => p.ClassId == classId).SelectMany(p => p.Picks.Select(id => _byId[id])).ToList();

    // Model files the caster shows while casting (precast, cast and channel kits), ascending. Step 3 adds
    // the impact and aura ones.
    public IReadOnlyList<int> CasterModels() => _byId.Values.SelectMany(s => s.Kits).Where(k => CasterEvents.Contains(k.Start))
        .SelectMany(k => k.Models.Select(m => m.FileDataId)).Distinct().Order().ToList();

    // What is wrong with the picks in this build: a spell that is missing, or a rank with another visual.
    // The bake fails on any (Phase 3 — Spell Casts Spec).
    public IReadOnlyList<string> Problems() => _problems;

    // Catalog/spell-picks.json: class ID to first-rank spell IDs.
    public static IReadOnlyDictionary<int, int[]> ShippedPicks()
    {
        using var s = typeof(SpellCatalog).Assembly.GetManifestResourceStream("Catalog/spell-picks.json")!;
        using var doc = JsonDocument.Parse(s);
        return doc.RootElement.EnumerateObject().Where(p => !p.Name.StartsWith('_'))
            .ToDictionary(p => int.Parse(p.Name), p => p.Value.EnumerateArray().Select(e => e.GetInt32()).ToArray());
    }
}
