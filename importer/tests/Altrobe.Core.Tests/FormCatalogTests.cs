using Altrobe.Core.Catalog;
using Altrobe.Core.Tables;
using static Altrobe.Core.Tests.Fake;

namespace Altrobe.Core.Tests;

// Made-up IDs in the shapes of Forever's tables.
public class FormCatalogTests
{
    const int Druid = 1 << 10;
    const int NightElf = 4, Tauren = 6, Skyborne = 95;

    sealed class Fixture
    {
        readonly InMemoryTables _t = new();
        int _id = 1000;

        public Fixture()
        {
            // PlayableRaceBit: Night Elf 3, Tauren 5, High Order Skyborne 32, the second 32-bit word's first bit.
            _t.Add(GameTableNames.ChrRaces, R(("ID", NightElf), ("PlayableRaceBit", 3)), R(("ID", Tauren), ("PlayableRaceBit", 5)), R(("ID", Skyborne), ("PlayableRaceBit", 32)));
        }

        // A choice drawn by a creature display, for one shapeshift form, with a requirement.
        public Fixture Choice(int choiceId, string name, int form, int model, int[] textures, int[] raceMasks, int classMask = Druid, int order = 0)
        {
            var id = ++_id;
            _t.Add(GameTableNames.ChrCustomizationChoice, R(("ID", choiceId), ("Name_lang", name), ("ChrCustomizationOptionID", 911), ("ChrCustomizationReqID", id), ("OrderIndex", order)))
                .Add(GameTableNames.ChrCustomizationReq, R(("ID", id), ("ReqType", 1), ("ClassMask", classMask), ("RaceMasks", raceMasks)))
                .Add(GameTableNames.ChrCustomizationElement, R(("ID", id), ("ChrCustomizationChoiceID", choiceId), ("ChrCustomizationDisplayInfoID", id)))
                .Add(GameTableNames.ChrCustomizationDisplayInfo, R(("ID", id), ("SpellShapeshiftFormID", form), ("CreatureDisplayInfoID", id)))
                .Add(GameTableNames.CreatureDisplayInfo, R(("ID", id), ("ModelID", id), ("TextureVariationFileDataID", textures)))
                .Add(GameTableNames.CreatureModelData, R(("ID", id), ("FileDataID", model)));
            return this;
        }

        // A retail leftover: a choice with no element, so nothing would draw it.
        public Fixture Undrawn(int choiceId, string name)
        {
            _t.Add(GameTableNames.ChrCustomizationChoice, R(("ID", choiceId), ("Name_lang", name), ("ChrCustomizationOptionID", 911), ("ChrCustomizationReqID", 12), ("OrderIndex", 0)));
            return this;
        }

        public FormCatalog Catalog() => new(_t);
    }

    static readonly int[] NightElfMask = [1 << 3, 0], TaurenMask = [1 << 5, 0], SkyborneMask = [0, 1];

    [Fact]
    public void EachRaceGetsItsOwnChoicesPerForm()
    {
        var forms = new Fixture()
            .Choice(1, "Black", 1, 500, [600, 0, 0, 0], NightElfMask, order: 1)
            .Choice(2, "Brown", 1, 501, [601, 0, 0, 0], TaurenMask)
            .Choice(3, "Blue", 1, 502, [602, 0, 0, 0], SkyborneMask)
            .Choice(4, "Brown", 5, 503, [603, 0, 0, 0], TaurenMask)
            .Catalog().For([NightElf, Tauren, Skyborne]);
        Assert.Equal(["cat-4", "cat-6", "cat-95", "bear-6"], forms.Select(f => $"{f.Form}-{f.Race}"));
        Assert.Equal("Blue", Assert.Single(forms.Single(f => f.Form == "cat" && f.Race == Skyborne).Choices).Name);
    }

    [Fact]
    public void LeavesOutChoicesForOtherClassesUnknownFormsAndRetailLeftovers()
    {
        var forms = new Fixture()
            .Choice(1, "Black", 1, 500, [600, 0, 0, 0], NightElfMask)
            .Choice(2, "Shaman wolf", 1, 501, [601, 0, 0, 0], NightElfMask, classMask: 1 << 6)
            .Choice(3, "Flight", 29, 502, [602, 0, 0, 0], NightElfMask)
            .Undrawn(4, "Dreamsaber (Blue)")
            .Catalog().For([NightElf]);
        Assert.Equal(["Black"], Assert.Single(forms).Choices.Select(c => c.Name));
    }

    [Fact]
    public void TheClassicModelIsTheOneSharingAColorNameWithFewerChoicesAndIsTheDefault()
    {
        // Five colors on the newer model and Purple again on the Classic one (druidcat_legacy.m2), as the
        // Night Elf cat has; Black is first in the game's order, but a fresh character shifts into the Classic.
        var cat = Assert.Single(new Fixture()
            .Choice(1, "Black", 1, 500, [600, 0, 0, 0], NightElfMask, order: 0)
            .Choice(2, "Purple", 1, 500, [601, 0, 0, 0], NightElfMask, order: 1)
            .Choice(3, "Purple", 1, 509, [609, 0, 0, 0], NightElfMask, order: 2)
            .Catalog().For([NightElf]));
        Assert.Equal([(1, false), (2, false), (3, true)], cat.Choices.Select(c => (c.ChoiceId, c.Classic)));
        Assert.Equal(3, cat.DefaultChoiceId);
    }

    [Fact]
    public void ADistinctNameOnAnotherModelIsNoClassic()
    {
        // Skyborne travel: the Cheetah on its own model beside four colors of the Skyborne one.
        var travel = Assert.Single(new Fixture()
            .Choice(1, "Cheetah", 3, 510, [610, 0, 0, 0], SkyborneMask)
            .Choice(2, "Blue", 3, 511, [611, 0, 0, 0], SkyborneMask)
            .Choice(3, "Gray", 3, 511, [612, 0, 0, 0], SkyborneMask)
            .Catalog().For([Skyborne]));
        Assert.All(travel.Choices, c => Assert.False(c.Classic));
        Assert.Equal(1, travel.DefaultChoiceId);
    }

    [Fact]
    public void KeepsTexturesInTheirSkinSlotOrder()
    {
        // TextureVariationFileDataID fills the model's creature skin slots in order (M2 texture types 11 to 13).
        var moonkin = Assert.Single(new Fixture().Choice(1, "Blue", 31, 520, [620, 621, 0, 0], NightElfMask).Catalog().For([NightElf]));
        Assert.Equal("moonkin", moonkin.Form);
        Assert.Equal([620, 621, 0], Assert.Single(moonkin.Choices).Textures);
        Assert.Equal(520, moonkin.Choices[0].ModelFileDataId);
    }
}
