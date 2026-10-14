using System.Text.Json;
using Altrobe.Core.Catalog;
using Altrobe.Server;

namespace Altrobe.Server.Tests;

// The local API's set JSON carries what notable.json carries, so both backends show the same sets panel.
public class SetJsonTests
{
    static JsonElement Json(ItemSetInfo set) =>
        JsonDocument.Parse(JsonSerializer.Serialize(Api.SetJson(set), new JsonSerializerOptions(JsonSerializerDefaults.Web))).RootElement;

    [Fact]
    public void ADataMinedSetCarriesItsArmorAndWhereItsClassCameFrom()
    {
        var set = new ItemSetInfo(1600, "Whispering Garb", [], [], false, true) { DataMined = true, Armor = "cloth", ClassMask = 400, ClassSource = "armor" };
        var json = Json(set);
        Assert.True(json.GetProperty("dataMined").GetBoolean());
        Assert.Equal("cloth", json.GetProperty("armor").GetString());
        Assert.Equal("armor", json.GetProperty("classSource").GetString());
    }

    [Fact]
    public void OtherSetsAreNotDataMinedAndHaveNoClassSource()
    {
        var json = Json(new ItemSetInfo(100, "Battlegear of Might", [], [], false));
        Assert.False(json.GetProperty("dataMined").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("classSource").ValueKind);
    }
}
