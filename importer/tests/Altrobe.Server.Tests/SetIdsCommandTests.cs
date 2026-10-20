using Altrobe.Server;

namespace Altrobe.Server.Tests;

public class SetIdsCommandTests
{
    [Fact]
    public void WritesTheIdsAscendingOnePerLineAsAJsonArray()
    {
        Assert.Equal("[\n  1,\n  7,\n  1704\n]\n", SetIdsCommand.Format([1704, 1, 7, 7]));
    }

    [Fact]
    public void SeasonOfDiscoverySetsAreEraSetsWithNoPieceFromClassic()
    {
        // 218 is Classic's tier 2 (its pieces are in classic-db); 1704 has only newer pieces; 1859 mixes in
        // one classic piece, so it stays.
        (int, int[])[] era = [(218, [16959, 16960]), (1704, [226555, 226558]), (1859, [226600, 19019])];
        Assert.Equal([1704], SetIdsCommand.SeasonOfDiscovery(era, new HashSet<int> { 16959, 16960, 19019 }));
    }

    [Fact]
    public async Task WithoutAProductItPrintsUsageAndFails()
    {
        var output = new StringWriter();
        Assert.Equal(2, await SetIdsCommand.RunAsync([], output));
        Assert.Contains("set-ids --product", output.ToString());
    }
}
