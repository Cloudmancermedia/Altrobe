using Altrobe.Core.Convert;

namespace Altrobe.Core.Tests;

// Auto-attacks keep every swing the model has (the game alternates them); other animations keep the first.
public class AnimationVariationsTests
{
    // Flags 0x20: the sequence's data is in its own .anim file; 0x40: an alias of another sequence.
    static M2Sequence Seq(ushort id, ushort variation, uint flags = 0x20) => new(id, variation, 1000, flags, -1, 0);

    [Fact]
    public void AnAutoAttackExportsEverySwingInVariationOrder()
    {
        // Attack1H (17) with two swings listed out of order, and Stand (0) in between.
        var seqs = new[] { Seq(0, 0), Seq(17, 1), Seq(17, 0), Seq(19, 0) };
        Assert.Equal([2, 1], ModelConverter.SequencesFor(seqs, 17));
    }

    [Fact]
    public void OtherAnimationsExportTheirFirstVariationOnly()
    {
        // EmoteDance (69) has several variations, but only auto-attacks alternate.
        var seqs = new[] { Seq(69, 1), Seq(69, 0), Seq(69, 2) };
        Assert.Equal([1], ModelConverter.SequencesFor(seqs, 69));
    }

    [Fact]
    public void AnAliasSwingIsLeftOutAndAMissingAnimationGivesNothing()
    {
        var seqs = new[] { Seq(18, 0), Seq(18, 1, flags: 0x40) };
        Assert.Equal([0], ModelConverter.SequencesFor(seqs, 18));
        Assert.Empty(ModelConverter.SequencesFor(seqs, 16));
    }

    [Fact]
    public void TheAutoAttacksAreUnarmedOneHandTwoHandAndPolearm()
    {
        Assert.Equal(["AttackUnarmed", "Attack1H", "Attack2H", "Attack2HL"], AnimationNames.AutoAttacks.Order().Select(AnimationNames.Name));
    }
}
