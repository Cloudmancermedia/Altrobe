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
    public async Task WithoutAProductItPrintsUsageAndFails()
    {
        var output = new StringWriter();
        Assert.Equal(2, await SetIdsCommand.RunAsync([], output));
        Assert.Contains("set-ids --product", output.ToString());
    }
}
