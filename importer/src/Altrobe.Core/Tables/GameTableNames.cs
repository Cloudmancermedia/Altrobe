namespace Altrobe.Core.Tables;

// Every table the app reads. Each one has a vendored definition in Definitions/.
public static class GameTableNames
{
    public const string CharBaseInfo = nameof(CharBaseInfo);
    public const string CharComponentTextureLayouts = nameof(CharComponentTextureLayouts);
    public const string CharComponentTextureSections = nameof(CharComponentTextureSections);
    public const string CharTitles = nameof(CharTitles);
    public const string ChrClasses = nameof(ChrClasses);
    public const string ChrCustomizationChoice = nameof(ChrCustomizationChoice);
    public const string ChrCustomizationElement = nameof(ChrCustomizationElement);
    public const string ChrCustomizationGeoset = nameof(ChrCustomizationGeoset);
    public const string ChrCustomizationMaterial = nameof(ChrCustomizationMaterial);
    public const string ChrCustomizationOption = nameof(ChrCustomizationOption);
    public const string ChrCustomizationReq = nameof(ChrCustomizationReq);
    public const string ChrModel = nameof(ChrModel);
    public const string ChrModelAltVariant = nameof(ChrModelAltVariant);
    public const string ChrModelMaterial = nameof(ChrModelMaterial);
    public const string ChrModelTextureLayer = nameof(ChrModelTextureLayer);
    public const string ChrRaceXChrModel = nameof(ChrRaceXChrModel);
    public const string ChrRaces = nameof(ChrRaces);
    public const string ComponentModelFileData = nameof(ComponentModelFileData);
    public const string ComponentTextureFileData = nameof(ComponentTextureFileData);
    public const string CreatureDisplayInfo = nameof(CreatureDisplayInfo);
    public const string CreatureModelData = nameof(CreatureModelData);
    public const string HelmetGeosetData = nameof(HelmetGeosetData);
    public const string Item = nameof(Item);
    public const string ItemAppearance = nameof(ItemAppearance);
    public const string ItemDisplayInfo = nameof(ItemDisplayInfo);
    public const string ItemDisplayInfoMaterialRes = nameof(ItemDisplayInfoMaterialRes);
    public const string ItemModifiedAppearance = nameof(ItemModifiedAppearance);
    public const string ItemSet = nameof(ItemSet);
    public const string ItemSparse = nameof(ItemSparse);
    public const string ItemVisuals = nameof(ItemVisuals);
    public const string ModelFileData = nameof(ModelFileData);
    public const string NameGen = nameof(NameGen);
    public const string TextureFileData = nameof(TextureFileData);

    // Spells (Phase 3 — Spell Casts Spec).
    public const string AnimKit = nameof(AnimKit);
    public const string AnimKitSegment = nameof(AnimKitSegment);
    public const string SkillLineAbility = nameof(SkillLineAbility);
    public const string Spell = nameof(Spell);
    public const string SpellCastTimes = nameof(SpellCastTimes);
    public const string SpellDuration = nameof(SpellDuration);
    public const string SpellMisc = nameof(SpellMisc);
    public const string SpellName = nameof(SpellName);
    public const string SpellVisual = nameof(SpellVisual);
    public const string SpellVisualAnim = nameof(SpellVisualAnim);
    public const string SpellVisualEffectName = nameof(SpellVisualEffectName);
    public const string SpellVisualEvent = nameof(SpellVisualEvent);
    public const string SpellVisualKit = nameof(SpellVisualKit);
    public const string SpellVisualKitEffect = nameof(SpellVisualKitEffect);
    public const string SpellVisualKitModelAttach = nameof(SpellVisualKitModelAttach);
    public const string SpellVisualMissile = nameof(SpellVisualMissile);
    public const string SpellXSpellVisual = nameof(SpellXSpellVisual);

    public static readonly IReadOnlyList<string> All =
    [
        CharBaseInfo, CharComponentTextureLayouts, CharComponentTextureSections, CharTitles, ChrClasses,
        ChrCustomizationChoice, ChrCustomizationElement, ChrCustomizationGeoset, ChrCustomizationMaterial,
        ChrCustomizationOption, ChrCustomizationReq, ChrModel, ChrModelAltVariant, ChrModelMaterial,
        ChrModelTextureLayer, ChrRaceXChrModel, ChrRaces, ComponentModelFileData, ComponentTextureFileData,
        CreatureDisplayInfo, CreatureModelData, HelmetGeosetData, Item, ItemAppearance, ItemDisplayInfo,
        ItemDisplayInfoMaterialRes, ItemModifiedAppearance, ItemSet, ItemSparse, ItemVisuals, ModelFileData, NameGen, TextureFileData,
        AnimKit, AnimKitSegment, SkillLineAbility, Spell, SpellCastTimes, SpellDuration, SpellMisc, SpellName, SpellVisual, SpellVisualAnim, SpellVisualEffectName, SpellVisualEvent, SpellVisualKit, SpellVisualKitEffect, SpellVisualKitModelAttach, SpellVisualMissile, SpellXSpellVisual,
    ];
}
