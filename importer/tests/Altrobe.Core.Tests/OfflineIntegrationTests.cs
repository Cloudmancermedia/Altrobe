using System.Net;
using System.Net.Sockets;
using Altrobe.Core.Builds;
using Altrobe.Core.Catalog;
using Altrobe.Core.Install;
using Altrobe.Core.Storage;

namespace Altrobe.Core.Tests;

// Opt-in: runs only with ALTROBE_INTEGRATION=1 and a real install (ALTROBE_WOW_PATH or the default
// location). Reads the install, writes converted files to a temp folder outside the repo, and
// deletes it afterwards.
public sealed class IntegrationFactAttribute : FactAttribute
{
    public IntegrationFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ALTROBE_INTEGRATION") != "1") Skip = "Set ALTROBE_INTEGRATION=1 to run against a real install.";
        else if (RealInstall.Find() == null) Skip = "No WoW install with a Forever product found.";
    }
}

static class RealInstall
{
    public static (WowInstall install, WowProduct product)? Find()
    {
        foreach (var install in InstallDiscovery.Discover())
            if (install.Products.FirstOrDefault(p => p.IsForever) is { } product) return (install, product);
        return null;
    }
}

// Every outgoing HTTP request in the process goes to this listener instead, which counts the
// connections. HttpClient.DefaultProxy covers any handler that does not set its own proxy, which
// is how both TACTSharp and our definition downloader create theirs.
sealed class ProxyTrap : IDisposable
{
    readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    readonly IWebProxy _previous = HttpClient.DefaultProxy;
    int _connections;

    public ProxyTrap()
    {
        _listener.Start();
        HttpClient.DefaultProxy = new WebProxy($"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}");
        _ = AcceptLoop();
    }

    public int Connections => Volatile.Read(ref _connections);

    async Task AcceptLoop()
    {
        try
        {
            while (true)
            {
                using var client = await _listener.AcceptTcpClientAsync();
                Interlocked.Increment(ref _connections);
            }
        }
        catch (ObjectDisposedException) { }
        catch (SocketException) { }
    }

    public void Dispose()
    {
        HttpClient.DefaultProxy = _previous;
        _listener.Stop();
    }
}

[Collection("network trap")]
public class OfflineIntegrationTests : IDisposable
{
    readonly string _cacheRoot = Path.Combine(Path.GetTempPath(), "altrobe-integration", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_cacheRoot)) Directory.Delete(_cacheRoot, true);
    }

    [IntegrationFact]
    public async Task ABodyListsItsAnimationsAndConvertsOneOnRequest()
    {
        var (install, product) = RealInstall.Find()!.Value;
        var session = BuildSession.Open(install, product, _cacheRoot);
        var look = (await session.LookAsync(2, 0, 1, ModelSet.Hd))!;
        Assert.Contains(look.Animations, a => a.Id == 5 && a.Name == "Run");

        var glb = await File.ReadAllBytesAsync(await session.AnimationAsync((uint)look.ModelFileDataId, 5));
        var jsonLength = BitConverter.ToInt32(glb, 12);
        var gltf = System.Text.Json.Nodes.JsonNode.Parse(System.Text.Encoding.UTF8.GetString(glb, 20, jsonLength))!;
        var anim = gltf["animations"]!.AsArray().Single()!;
        Assert.Equal("anim_5_0", anim["name"]!.GetValue<string>());
        Assert.NotEmpty(anim["channels"]!.AsArray());
        Assert.StartsWith("bone_", gltf["nodes"]![0]!["name"]!.GetValue<string>());
        Assert.Empty(gltf["meshes"]?.AsArray() ?? []);

        await Assert.ThrowsAsync<FileNotFoundException>(() => session.AnimationAsync((uint)look.ModelFileDataId, 60000));
    }

    [IntegrationFact]
    public async Task AnAutoAttackFileHoldsEverySwing()
    {
        // An Orc male has two one-hand swings (Attack1H, 17) and three polearm swings (Attack2HL, 19).
        var (install, product) = RealInstall.Find()!.Value;
        var session = BuildSession.Open(install, product, _cacheRoot);
        var look = (await session.LookAsync(2, 0, 1, ModelSet.Hd))!;
        foreach (var (animId, swings) in new[] { (17, 2), (19, 3) })
        {
            var glb = await File.ReadAllBytesAsync(await session.AnimationAsync((uint)look.ModelFileDataId, animId));
            var gltf = System.Text.Json.Nodes.JsonNode.Parse(System.Text.Encoding.UTF8.GetString(glb, 20, BitConverter.ToInt32(glb, 12)))!;
            Assert.Equal(Enumerable.Range(0, swings).Select(v => $"anim_{animId}_{v}"), gltf["animations"]!.AsArray().Select(a => a!["name"]!.GetValue<string>()));
        }
    }

    [IntegrationFact]
    public async Task EverythingRunsWithoutANetworkCall()
    {
        var (install, product) = RealInstall.Find()!.Value;
        using var trap = new ProxyTrap();

        // The trap itself works: a request from a default HttpClient lands on it.
        using (var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(2) })
            await Assert.ThrowsAnyAsync<Exception>(() => probe.GetAsync("http://example.invalid/"));
        // HttpClient retries a reset connection, so one probe can land more than once.
        var baseline = trap.Connections;
        Assert.True(baseline > 0);

        var session = BuildSession.Open(install, product, _cacheRoot);
        Assert.Equal(10, session.Characters.Races().Count);
        Assert.NotEmpty(session.Items.Search(new ItemQuery("thunderfury")).Items);
        Assert.NotNull(await session.LookAsync(2, 0, 1, ModelSet.Hd));
        Assert.NotNull(await session.LookAsync(2, 0, 1, ModelSet.Sd));
        var thunderfury = session.ResolveItem(19019, 2, 0, ModelSet.Hd);
        Assert.Null(thunderfury.Error);
        Assert.True(File.Exists(await session.TextureAsync((uint)thunderfury.Models[0].Textures[0].FileDataId)));

        // Files that are in the build's encoding table but not on local disk: the path where
        // TACTSharp would otherwise ask Blizzard's version service for CDNs and ping them.
        var build = OpenBuild(install, product, GameStorage.CreateOfflineBuild(install.Path, product.Product, Path.Combine(_cacheRoot, "tact-probe")));
        Assert.Equal(3, MissingLocalFiles(build).Count());

        Assert.Equal(baseline, trap.Connections);
    }

    // The sets panel's first view for a Human rogue (Alliance) and an Undead paladin, a pairing
    // Forever adds: every tier, and only their own faction's PvP sets.
    [IntegrationFact]
    public void NotableSetsFollowTheRacesFactionAndTheClass()
    {
        var (install, product) = RealInstall.Find()!.Value;
        var session = BuildSession.Open(install, product, _cacheRoot);

        var rogue = session.Sets.Notable("alliance", [4]).ToDictionary(g => g.Group, g => g.Sets.Select(x => x.Name).ToList());
        Assert.Equal(NotableSets.GroupOrder, rogue.Keys);
        // Grimstitch Armor is on Forever's rogue list (forever-sets.json). The group's other members change with
        // the build: in 1.60.1.70450 four vanilla weapon sets (Dal'Rend's Arms among them) count, their pieces
        // unnamed and their looks new.
        Assert.Contains("Grimstitch Armor", rogue[NotableSets.NewInForever]);
        Assert.Contains("Lieutenant Commander's Guard", rogue[NotableSets.PvpRare]);
        Assert.Contains("Field Marshal's Vestments", rogue[NotableSets.PvpEpic]);
        Assert.Equal(["Shadowcraft Armor", "Darkmantle Armor", "Nightslayer Armor", "Bloodfang Armor", "Deathdealer's Embrace", "Bonescythe Armor"],
            NotableSets.TierLabels.Select(t => Assert.Single(rogue[t])));
        Assert.DoesNotContain(rogue.Values.SelectMany(v => v), n => n.StartsWith("Warlord's") || n.StartsWith("Champion's"));

        var paladin = session.Sets.Notable("horde", [2]).ToDictionary(g => g.Group, g => g.Sets.Select(x => x.Name).ToList());
        Assert.Contains("Warlord's Aegis", paladin[NotableSets.PvpEpic]);
        Assert.DoesNotContain(paladin.Values.SelectMany(v => v), n => n.StartsWith("Field Marshal's"));
    }

    // The barber shop's form colors in 1.60.1.70532: five on the newer cat plus Purple on druidcat_legacy.m2 for
    // a Night Elf, and the Skyborne cat's four colors on its own model.
    [IntegrationFact]
    public void DruidFormsListEachRacesColorsWithTheClassicAsDefault()
    {
        var (install, product) = RealInstall.Find()!.Value;
        var session = BuildSession.Open(install, product, _cacheRoot);
        var races = session.Characters.Races().ToDictionary(r => r.Name, r => r.Race);
        var druids = new[] { "Night Elf", "Tauren", "High Order Skyborne", "Windshaper Skyborne" }.Select(n => races[n]).ToList();
        var forms = session.Forms.For(druids);

        Assert.Equal(16, forms.Count);
        var cat = forms.Single(f => f.Form == "cat" && f.Race == races["Night Elf"]);
        Assert.Equal(6, cat.Choices.Count);
        var classic = Assert.Single(cat.Choices, c => c.Classic);
        Assert.Equal(("Purple", 307529), (classic.Name, classic.ModelFileDataId));
        Assert.Equal(classic.ChoiceId, cat.DefaultChoiceId);

        var skyborne = forms.Single(f => f.Form == "cat" && f.Race == races["Windshaper Skyborne"]);
        Assert.Equal(["Blue", "Gray", "Green", "White"], skyborne.Choices.Select(c => c.Name).Order());
        Assert.All(skyborne.Choices, c => Assert.Equal(7749920, c.ModelFileDataId));
        Assert.Equal(["Cheetah"], forms.Single(f => f.Form == "travel" && f.Race == races["Tauren"]).Choices.Select(c => c.Name));

        var travel = forms.Single(f => f.Form == "travel" && f.Race == races["High Order Skyborne"]);
        Assert.Equal(["Blue", "Gray", "Green", "White", "Cheetah"], travel.Choices.Select(c => c.Name));
        Assert.Equal(travel.Choices[0].ChoiceId, travel.DefaultChoiceId);
    }

    // Proves the trap would catch a regression: without the placeholder CDN list, the same missing
    // file makes TACTSharp call the version service.
    [IntegrationFact]
    public void WithoutThePlaceholderCdnListAMissingFileGoesToTheNetwork()
    {
        var (install, product) = RealInstall.Find()!.Value;
        using var trap = new ProxyTrap();
        var build = new TACTSharp.BuildInstance();
        build.Settings.BaseDir = install.Path;
        build.Settings.Product = product.Product;
        build.Settings.TryCDN = false;
        build.Settings.CacheDir = Path.Combine(_cacheRoot, "tact-unsafe");
        build.Settings.RootMode = TACTSharp.RootInstance.LoadMode.Full;
        OpenBuild(install, product, build);

        Assert.ThrowsAny<Exception>(() => MissingLocalFiles(build).First());
        Assert.True(trap.Connections > 0);
    }

    static TACTSharp.BuildInstance OpenBuild(WowInstall install, WowProduct product, TACTSharp.BuildInstance build)
    {
        var info = new TACTSharp.BuildInfo(Path.Combine(install.Path, ".build.info"), build.Settings, build.cdn);
        var entry = info.Entries.First(e => e.Product == product.Product);
        build.cdn.ProductDirectory = entry.CDNPath;
        build.LoadConfigs(entry.BuildConfig, entry.CDNConfig);
        build.Load();
        return build;
    }

    // Lazily yields up to three FileDataIDs whose content key is in encoding but whose data is not
    // local. Opening each one is the point: it exercises the CDN fallback.
    static IEnumerable<uint> MissingLocalFiles(TACTSharp.BuildInstance build)
    {
        var found = 0;
        foreach (var fdid in build.Root!.GetAvailableFDIDs().Where((_, i) => i % 13 == 0))
        {
            if (!build.Root.GetEntriesByFDID(fdid).Any(e => build.Encoding!.FindContentKey(e.md5.AsSpan()).Length > 0)) continue;
            bool missing;
            try { LocalFiles.Open(build, fdid); missing = false; }
            catch (FileNotFoundException) { missing = true; }
            if (!missing) continue;
            yield return fdid;
            if (++found == 3) yield break;
        }
    }
}
