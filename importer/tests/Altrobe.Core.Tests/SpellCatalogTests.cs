using Altrobe.Core.Spells;
using Altrobe.Core.Tables;
using static Altrobe.Core.Tests.Fake;
using T = Altrobe.Core.Tables.GameTableNames;

namespace Altrobe.Core.Tests;

// Spells as the game data builds their visuals (Phase 3 — Spell Casts Spec, Step 1). Made-up rows, shaped
// like Fireball's on build 1.60.1.70425 unless a test says otherwise.
public class SpellCatalogTests
{
    const int Mage = 8, Rogue = 4;

    sealed class Fixture
    {
        readonly InMemoryTables _t = new();
        int _next = 1000;
        int Next() => _next++;

        // A player spell: its name, the class that learns it, its visual, cast time and duration.
        public Fixture Spell(int id, string name, int classId, int visual, int castMs = 0, int durationMs = 0, int acquireMethod = 2, float speed = 0)
        {
            _t.Add(T.SpellName, R(("ID", id), ("Name_lang", name)))
                .Add(T.SkillLineAbility, R(("ID", Next()), ("Spell", id), ("ClassMask", 1 << (classId - 1)), ("AcquireMethod", acquireMethod)))
                .Add(T.SpellXSpellVisual, R(("ID", Next()), ("SpellID", id), ("SpellVisualID", visual), ("DifficultyID", 0)));
            var cast = Next(); var duration = Next();
            _t.Add(T.SpellCastTimes, R(("ID", cast), ("Base", castMs)))
                .Add(T.SpellDuration, R(("ID", duration), ("Duration", durationMs)))
                .Add(T.SpellMisc, R(("ID", Next()), ("SpellID", id), ("DifficultyID", 0), ("CastingTimeIndex", cast), ("DurationIndex", duration), ("Speed", speed), ("LaunchDelay", 0f), ("MinDuration", 0f)));
            return this;
        }

        // An event of a visual: its kit, with an animation (loop or AnimKit) and models on attachments.
        public Fixture Event(int visual, int start, int end, int target, int kit, int loopAnim = 0, int animKitFirst = 0, params (int fdid, int attachment)[] models)
        {
            _t.Add(T.SpellVisualEvent, R(("ID", Next()), ("SpellVisualID", visual), ("StartEvent", start), ("EndEvent", end), ("TargetType", target), ("SpellVisualKitID", kit)));
            if (loopAnim != 0 || animKitFirst != 0)
            {
                var anim = Next(); var animKit = animKitFirst != 0 ? Next() : 0;
                _t.Add(T.SpellVisualAnim, R(("ID", anim), ("InitialAnimID", -1), ("LoopAnimID", loopAnim == 0 ? -1 : loopAnim), ("AnimKitID", animKit)))
                    .Add(T.SpellVisualKitEffect, R(("ID", Next()), ("ParentSpellVisualKitID", kit), ("EffectType", 6), ("Effect", anim)));
                if (animKit != 0)
                    _t.Add(T.AnimKitSegment, R(("ID", Next()), ("ParentAnimKitID", animKit), ("OrderIndex", 0), ("AnimID", animKitFirst)));
            }
            foreach (var (fdid, attachment) in models)
            {
                var name = Next(); var attach = Next();
                _t.Add(T.SpellVisualEffectName, R(("ID", name), ("ModelFileDataID", fdid), ("Scale", 1f)))
                    .Add(T.SpellVisualKitModelAttach, R(("ID", attach), ("ParentSpellVisualKitID", kit), ("SpellVisualEffectNameID", name),
                        ("AttachmentID", attachment), ("Scale", 0.9f), ("Offset", new[] { 0f, 0f, 0.5f }), ("Yaw", 0f), ("Pitch", 0f), ("Roll", 0f)))
                    .Add(T.SpellVisualKitEffect, R(("ID", Next()), ("ParentSpellVisualKitID", kit), ("EffectType", 2), ("Effect", attach)));
            }
            // A sound (effect type 5) on every kit, which the resolver skips.
            _t.Add(T.SpellVisualKitEffect, R(("ID", Next()), ("ParentSpellVisualKitID", kit), ("EffectType", 5), ("Effect", 1)));
            return this;
        }

        public Fixture Missile(int visual, int set, int fdid, int from, int to)
        {
            var name = Next();
            _t.Add(T.SpellVisual, R(("ID", visual), ("SpellVisualMissileSetID", set)))
                .Add(T.SpellVisualEffectName, R(("ID", name), ("ModelFileDataID", fdid), ("Scale", 1f)))
                .Add(T.SpellVisualMissile, R(("ID", Next()), ("SpellVisualMissileSetID", set), ("SpellVisualEffectNameID", name), ("Attachment", from),
                    ("DestinationAttachment", to), ("SpellMissileMotionID", 0), ("DecayTimeAfterImpact", 0)));
            return this;
        }

        public SpellCatalog Build(Dictionary<int, int[]> picks) => new(_t, picks);
    }

    // Fireball rank 1 (133) and rank 2 (143) share visual 67: precast on 1-2, cast on 3-13, impact on 6.
    static Fixture Fireball() => new Fixture()
        .Spell(133, "Fireball", Mage, 67, castMs: 1500, speed: 24).Spell(143, "Fireball", Mage, 67, castMs: 2000, speed: 24)
        .Event(67, 1, 2, 1, 30, loopAnim: 51, models: [(166120, 21), (166120, 22)])
        .Event(67, 3, 13, 1, 38, loopAnim: 53, models: [(166110, 21), (166110, 22)])
        .Event(67, 6, 13, 2, 286, loopAnim: 9, models: [(166583, 34)])
        .Missile(67, 9834, 166129, 38, 34);

    [Fact]
    public void ASpellsVisualFollowsTheChainToItsKitsAnimationsModelsAndMissile()
    {
        var fireball = Fireball().Build(new() { [Mage] = [133] }).Get(133)!;
        Assert.Equal(("Fireball", Mage, 1500), (fireball.Name, fireball.ClassId, fireball.CastMs));
        Assert.Equal([133, 143], fireball.Ranks);
        Assert.Equal([(1, 2, 1, 51), (3, 13, 1, 53), (6, 13, 2, 9)], fireball.Kits.Select(k => (k.Start, k.End, k.Target, k.Anim ?? 0)));
        var cast = fireball.Kits[1];
        Assert.Equal([(166110, 21), (166110, 22)], cast.Models.Select(m => (m.FileDataId, m.Attachment)));
        Assert.Equal(0.9f, cast.Models[0].Scale, 3);
        Assert.Equal([0f, 0f, 0.5f], cast.Models[0].Offset);
        Assert.Equal((166129, 38, 34, 24f), (fireball.Missile!.FileDataId, fireball.Missile.From, fireball.Missile.To, fireball.Missile.Speed));
    }

    [Fact]
    public void AnAnimKitGivesItsFirstSegmentsAnimation()
    {
        // Kick: the cast kit's animation is an AnimKit whose first segment plays Kick (95).
        var kick = new Fixture().Spell(1766, "Kick", Rogue, 90).Event(90, 3, 13, 1, 162, animKitFirst: 95).Build(new() { [Rogue] = [1766] }).Get(1766)!;
        Assert.Equal(95, kick.Kits.Single().Anim);
        Assert.Null(kick.Missile);
    }

    [Fact]
    public void RanksLeaveOutRowsThatAreNotPlayerRanks()
    {
        // AcquireMethod 3 marks triggered spells and Season of Discovery copies, such as Lightning Bolt 408439.
        var catalog = Fireball().Spell(408439, "Fireball", Mage, 192758, acquireMethod: 3).Build(new() { [Mage] = [133] });
        Assert.Equal([133, 143], catalog.Get(133)!.Ranks);
        Assert.Empty(catalog.Problems());
    }

    [Fact]
    public void ARankWithAnotherVisualIsAProblem()
    {
        // A pick whose ranks look different belongs in the animation list, not the spell list.
        var catalog = Fireball().Spell(145, "Fireball", Mage, 999).Build(new() { [Mage] = [133] });
        Assert.Equal(["Fireball (133): rank 145 has visual 999, not 67"], catalog.Problems());
    }

    [Fact]
    public void APickTheBuildDoesNotHaveIsAProblem()
    {
        Assert.Equal(["class 8: spell 999 is not in this build"], Fireball().Build(new() { [Mage] = [133, 999] }).Problems());
    }

    [Fact]
    public void ForAClassListsItsPicksInOrderAndCasterModelsAreThePrecastCastAndChannelOnes()
    {
        var catalog = Fireball().Build(new() { [Mage] = [133] });
        Assert.Equal(["Fireball"], catalog.ForClass(Mage).Select(s => s.Name));
        Assert.Empty(catalog.ForClass(Rogue));
        // The impact kit's model (166583) waits for Step 3.
        Assert.Equal([166110, 166120], catalog.CasterModels());
    }

    [Fact]
    public void TheShippedPicksHaveFiveSpellsForEveryClass()
    {
        var picks = SpellCatalog.ShippedPicks();
        Assert.Equal([1, 2, 3, 4, 5, 7, 8, 9, 11], picks.Keys.Order());
        Assert.All(picks, p => Assert.Equal(5, p.Value.Distinct().Count()));
        Assert.Equal([133, 116, 5143, 122, 1449], picks[Mage]);
    }

    [Fact]
    public void ANegativeCastTimeIsInstant()
    {
        // Arcane Shot's SpellCastTimes.Base is -1000000 on 1.60.1.70425: a ranged shot, not a cast.
        var shot = new Fixture().Spell(3044, "Arcane Shot", 3, 3299, castMs: -1000000).Build(new() { [3] = [3044] }).Get(3044)!;
        Assert.Equal(0, shot.CastMs);
    }

    [Fact]
    public void RowsReadFloatsAndFloatArrays()
    {
        var row = new Row(R(("Scale", 0.9f), ("Offset", new[] { 1f, 2f, 3f })));
        Assert.Equal(0.9f, row.Float("Scale"), 3);
        Assert.Equal([1f, 2f, 3f], row.Floats("Offset"));
        Assert.Equal(0f, row.Float("Missing"));
    }
}
