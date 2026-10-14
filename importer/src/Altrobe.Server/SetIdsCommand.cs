using Altrobe.Core.Hosted;
using Altrobe.Core.Storage;
using Altrobe.Core.Tables;
using T = Altrobe.Core.Tables.GameTableNames;

namespace Altrobe.Server;

// `set-ids --product wow_classic_era [--season-of-discovery] [--region us] [--cache <dir>] [--out <file>]`:
// the ItemSet IDs of a product's current build on Blizzard's CDN, as a JSON array. With
// --season-of-discovery, only sets none of whose pieces cmangos classic-db (1.12) has. Maintainers run that
// against Classic Era to refresh importer/src/Altrobe.Core/Catalog/season-of-discovery-sets.json, the sets
// Altrobe leaves out (Phase 4 — Data-Mined Sets Spec). Reads about 300 MB of indexes; never part of a bake.
public static class SetIdsCommand
{
    public const string Usage = "Usage:\n  set-ids --product <product> [--season-of-discovery] [--region us] [--cache <dir>] [--out <file>]";

    // Sets with no piece from 1.12 Classic: Season of Discovery's, when the sets are Classic Era's.
    public static IReadOnlyList<int> SeasonOfDiscovery(IEnumerable<(int SetId, int[] Items)> sets, IReadOnlySet<int> classicItems) =>
        sets.Where(s => !s.Items.Any(classicItems.Contains)).Select(s => s.SetId).Order().ToList();

    public static string Format(IEnumerable<int> ids) =>
        "[\n" + string.Join(",\n", ids.Distinct().Order().Select(i => $"  {i}")) + "\n]\n";

    public static async Task<int> RunAsync(string[] args, TextWriter output)
    {
        string? product = null, region = "us", cache = null, outFile = null;
        var sod = false;
        for (var i = 0; i < args.Length; i++)
        {
            var value = i + 1 < args.Length ? args[i + 1] : null;
            switch (args[i])
            {
                case "--product" when value != null: product = value; i++; break;
                case "--region" when value != null: region = value; i++; break;
                case "--cache" when value != null: cache = value; i++; break;
                case "--out" when value != null: outFile = value; i++; break;
                case "--season-of-discovery": sod = true; break;
                default: await output.WriteLineAsync($"Unknown or incomplete argument: {args[i]}\n\n{Usage}"); return 2;
            }
        }
        if (product == null)
        {
            await output.WriteLineAsync($"--product is required, such as wow_classic_era.\n\n{Usage}");
            return 2;
        }

        // NOT RUN by tests: asks the version service and reads the build's ItemSet table from the CDN.
        var cacheRoot = cache ?? Path.Combine(Path.GetTempPath(), "altrobe-bake");
        using var http = new HttpClient();
        var source = CdnSource.From(product, VersionService.ForRegion(VersionService.Parse(await http.GetStringAsync(VersionService.VersionsUrl(product))), region));
        var cdns = VersionService.ParseCdns(await http.GetStringAsync(VersionService.CdnsUrl(product)), region);
        var storage = await GameStorage.OpenCdnAsync(source, Path.Combine(cacheRoot, product, source.Version, "tact"), cdns.Hosts, http, m => output.WriteLine(m));
        var tables = new Db2Tables(storage, new DefinitionProvider(Path.Combine(cacheRoot, "definitions")), source.Version, null);
        var sets = tables.Get(T.ItemSet).Select(r => (SetId: r.Int("ID"), Items: r.Ints("ItemID").Where(i => i != 0).ToArray())).ToList();
        IEnumerable<int> ids = sets.Select(s => s.SetId);
        if (sod)
        {
            var classic = await Altrobe.Core.Catalog.ClassicItemNames.LoadAsync(cacheRoot, http, m => output.WriteLine(m));
            if (classic.Count == 0) { await output.WriteLineAsync("cmangos classic-db did not load; refusing to call every set Season of Discovery."); return 1; }
            ids = SeasonOfDiscovery(sets, classic.Keys.ToHashSet());
        }
        var json = Format(ids);
        if (outFile != null) await File.WriteAllTextAsync(outFile, json);
        else await output.WriteAsync(json);
        await output.WriteLineAsync($"{product} {source.Version}: ItemSet IDs written{(outFile != null ? $" to {outFile}" : "")}.");
        return 0;
    }
}
