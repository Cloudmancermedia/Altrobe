using Altrobe.Core.Resolve;
using Altrobe.Core.Tables;
using T = Altrobe.Core.Tables.GameTableNames;

namespace Altrobe.Core.Catalog;

// One look a druid form can take for a race: the creature model and the textures for its skin slots (M2
// texture types 11 to 13, in order; 0 where the display leaves a slot empty). Classic: the original model,
// offered beside the newer ones under a color name they also use.
public sealed record FormChoice(int ChoiceId, string Name, int ModelFileDataId, IReadOnlyList<int> Textures, bool Classic = false);

public sealed record FormLook(string Form, int Race, int DefaultChoiceId, IReadOnlyList<FormChoice> Choices);

// Every race's forms, and the animations of each form model, by FileDataID.
public sealed record FormSet(IReadOnlyList<FormLook> Forms, IReadOnlyDictionary<int, IReadOnlyList<AnimationInfo>> Animations);

// Druid forms as the barber shop offers them. Forever keeps every retail form choice in its tables; the ones
// it draws have a ChrCustomizationDisplayInfo element naming the form and a creature display, and a
// requirement for druids of some races.
public sealed class FormCatalog(ITables t)
{
    // SpellShapeshiftForm IDs, in the order the race picker lists the forms.
    public static readonly IReadOnlyList<(int Id, string Key)> Forms = [(1, "cat"), (5, "bear"), (3, "travel"), (31, "moonkin")];

    const int DruidClassId = 11, DruidClassBit = 1 << (DruidClassId - 1);

    public IReadOnlyList<FormLook> For(IReadOnlyCollection<int> races)
    {
        // Some choices still allow retail's druid races (the Cheetah allows Trolls), so the race must also be
        // able to be a druid at character creation.
        var druidRaces = t.Get(T.CharBaseInfo).Where(r => r.Int("ClassID") == DruidClassId).Select(r => r.Int("RaceID")).ToHashSet();
        var raceBits = t.Get(T.ChrRaces).Where(r => races.Contains(r.Int("ID")) && druidRaces.Contains(r.Int("ID")))
            .ToDictionary(r => r.Int("ID"), r => r.Int("PlayableRaceBit"));
        var choices = t.Get(T.ChrCustomizationChoice).ById();
        var reqs = t.Get(T.ChrCustomizationReq).ById();
        var displayInfo = t.Get(T.ChrCustomizationDisplayInfo).ById();
        var displays = t.Get(T.CreatureDisplayInfo).ById();
        var models = t.Get(T.CreatureModelData).ById();

        var drawn = new List<(string form, int race, Row choice, FormChoice look)>();
        foreach (var e in t.Get(T.ChrCustomizationElement))
        {
            if (!displayInfo.TryGetValue(e.Int("ChrCustomizationDisplayInfoID"), out var info)) continue;
            var form = Forms.FirstOrDefault(f => f.Id == info.Int("SpellShapeshiftFormID")).Key;
            if (form == null || !choices.TryGetValue(e.Int("ChrCustomizationChoiceID"), out var choice)) continue;
            if (!reqs.TryGetValue(choice.Int("ChrCustomizationReqID"), out var req) || !ForDruids(req)) continue;
            if (!displays.TryGetValue(info.Int("CreatureDisplayInfoID"), out var display) || !models.TryGetValue(display.Int("ModelID"), out var model)) continue;
            var textures = display.Ints("TextureVariationFileDataID").Concat(new int[3]).Take(3).ToList();
            var look = new FormChoice(choice.Int("ID"), choice.Str("Name_lang"), model.Int("FileDataID"), textures);
            foreach (var (race, bit) in raceBits)
                if (Allows(req.Ints("RaceMasks"), bit)) drawn.Add((form, race, choice, look));
        }

        var looks = new List<FormLook>();
        foreach (var (_, form) in Forms)
            foreach (var race in races)
            {
                // The barber shop lists by UiOrderIndex; OrderIndex would put the Skyborne's Cheetah first.
                var mine = drawn.Where(d => d.form == form && d.race == race)
                    .OrderBy(d => d.choice.Int("UiOrderIndex")).ThenBy(d => d.choice.Int("ID")).Select(d => d.look).ToList();
                if (mine.Count == 0) continue;
                var marked = MarkClassic(mine);
                var classic = marked.FirstOrDefault(c => c.Classic);
                looks.Add(new FormLook(form, race, (classic ?? marked[0]).ChoiceId, marked));
            }
        return looks;
    }

    // A druid's own choice, offered without an achievement, quest or item to unlock it.
    static bool ForDruids(Row req) =>
        (req.Int("ReqType") & 1) != 0 && (req.Int("ClassMask") & DruidClassBit) != 0
        && req.Int("ReqAchievementID") == 0 && req.Int("ReqQuestID") == 0 && req.Int("ReqItemModifiedAppearanceID") == 0;

    // RaceMasks holds 32-bit words; a race is bit PlayableRaceBit across them.
    static bool Allows(int[] masks, int bit) => bit / 32 < masks.Length && ((uint)masks[bit / 32] >> (bit % 32) & 1) != 0;

    // The Classic model goes by a color name the newer one also uses (Purple twice for the Night Elf cat):
    // of two choices with one name, the Classic is on the model fewer choices use.
    static List<FormChoice> MarkClassic(List<FormChoice> choices)
    {
        var perModel = choices.GroupBy(c => c.ModelFileDataId).ToDictionary(g => g.Key, g => g.Count());
        return choices.Select(c =>
        {
            var twins = choices.Where(o => o.Name == c.Name && o.ModelFileDataId != c.ModelFileDataId).ToList();
            return twins.Count > 0 && twins.All(o => perModel[o.ModelFileDataId] > perModel[c.ModelFileDataId]) ? c with { Classic = true } : c;
        }).ToList();
    }
}
