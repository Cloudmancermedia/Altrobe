using Altrobe.Core.Hosted;
using Altrobe.Core.Storage;
using Altrobe.Core.Tables;
using T = Altrobe.Core.Tables.GameTableNames;

namespace Altrobe.Server;

// `set-ids --product wow_classic_era [--region us] [--cache <dir>] [--out <file>]`: the ItemSet IDs of a
// product's current build on Blizzard's CDN, as a JSON array. Maintainers run it against Classic Era to
// refresh importer/src/Altrobe.Core/Catalog/classic-era-sets.json, which places data-mined sets in
// Season of Discovery (Phase 4 — Data-Mined Sets Spec). Reads about 300 MB of indexes; never part of a bake.
public static class SetIdsCommand
{
    public const string Usage = "Usage:\n  set-ids --product <product> [--region us] [--cache <dir>] [--out <file>]";

    public static string Format(IEnumerable<int> ids) =>
        "[\n" + string.Join(",\n", ids.Distinct().Order().Select(i => $"  {i}")) + "\n]\n";

    public static async Task<int> RunAsync(string[] args, TextWriter output)
    {
        string? product = null, region = "us", cache = null, outFile = null;
        for (var i = 0; i < args.Length; i++)
        {
            var value = i + 1 < args.Length ? args[i + 1] : null;
            switch (args[i])
            {
                case "--product" when value != null: product = value; i++; break;
                case "--region" when value != null: region = value; i++; break;
                case "--cache" when value != null: cache = value; i++; break;
                case "--out" when value != null: outFile = value; i++; break;
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
        var json = Format(tables.Get(T.ItemSet).Select(r => r.Int("ID")));
        if (outFile != null) await File.WriteAllTextAsync(outFile, json);
        else await output.WriteAsync(json);
        await output.WriteLineAsync($"{product} {source.Version}: ItemSet IDs written{(outFile != null ? $" to {outFile}" : "")}.");
        return 0;
    }
}
