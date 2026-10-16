# Hosted bundle pipeline

The hosted website serves game data converted ahead of time, as a static bundle. The server binary's
`bake` command writes one build as a bundle, the web app's static build reads it, and
`npm run publish:bundle` uploads it.

## Why it works this way

- **Blizzard's public CDN, not a game install.** The bake reads each build straight from the CDN
  through TACTSharp, so it needs no machine with the game installed and can run unattended. All
  reads go through `IGameFiles`, so the converter is the same one the local app uses.
- **glTF and PNG, converted on our side.** The browser then needs no parser for the game's own model
  formats, and the web app reads the same files from the local server or a bundle.
- **Static files only.** The dressing room needs no application server: search runs in the browser
  over the baked catalog.
- **Pinned table layouts.** The bake reads game tables with a pinned WoWDBDefs commit. A build that
  changes a layout fails the run, and the site keeps serving the previous build until someone bumps
  the pin.
- **No hotfixes.** The local app applies the player's client hotfix cache (`DBCache.bin`). The CDN has
  no such file, so the site shows each build as shipped.
- **Local-only features stay local.** The command channel (`/api/v1/session`) and the `/mcp` endpoint
  let a program on your own computer drive your own tab, so the static build leaves them out.

## Bundle layout

Under the output folder:

| Path | Holds |
| --- | --- |
| `{product}/current.json` | the build the site shows |
| `{product}/{build}/manifest.json` | counts, and what failed to convert |
| `{product}/{build}/characters.json` | races and every base look |
| `{product}/{build}/catalog.json`, `sets.json` | the item catalog and sets, for search in the browser |
| `{product}/{build}/notable.json` | notable sets per race and class, new-in-Forever sets last |
| `{product}/{build}/set-pieces.json` | every item that is a piece of some set |
| `{product}/{build}/popular-weapons.json` | the Weapons tab: `all` (no class) and each class ID, ending with the weapons Forever added (IDs above Classic Era's 246062), from `Catalog/popular-weapons.json`; a bad ID fails the bake |
| `{product}/{build}/titles.json`, `names.json` | titles and the random-name lists |
| `{product}/{build}/items/{itemId}.json` | the item resolved for every race, sex and body kind |
| `{product}/{build}/v{N}/models/{fdid}.glb`, `.json` | converted models |
| `{product}/{build}/v{N}/textures/{fdid}.png` | textures |
| `{product}/{build}/v{N}/anims/{model}/{animId}.glb` | the offered animations for each body model |

The fields are in `web/src/api/types.ts`. `N` is the converter version (`AssetConverter.OutputVersion`),
as in the local cache, so a converter change publishes new files beside the old ones instead of
overwriting them. Below `v{N}` the paths keep the local server's `/assets/{build}/...` shape, so the
web app changes only its base URL. The JSON comes from the resolvers and catalogs, not the converter,
so it stays beside the build. `current.json` moves only after the count check passes.

The site offers a chosen list of animations (`BundleBaker.AnimationList`), because every animation
would add about 1.7 GB per build. Only Classic animations count (`AnimationNames.IsClassic`): the HD
bodies also carry retail's, which the app never offers.

## Run it from a local install

Reads local files only; no network.

```sh
dotnet build importer/src/Altrobe.Server
dotnet importer/src/Altrobe.Server/bin/Debug/net10.0/Altrobe.Server.dll bake \
  --out bundle --install "/Applications/World of Warcraft" --product wow_classic_beta \
  --limit-items 5 --limit-sets 2
```

`--limit-items` and `--limit-sets` bake a subset for a quick check (a limited set keeps its pieces).
`--cache <dir>` sets where converted files are cached between runs (default: a temp folder).
`--parallel N` sets how many files convert at once (default: one per CPU core).

Even a small bake writes several hundred MB, because customization textures and animations are a
fixed cost per body whatever the item count.

## Run the site from a bundle

The web app picks its backend at build time. Vite's `static` mode swaps the local server for
`web/src/api/static.ts`, which reads the bundle's JSON once per file and runs item and set search in
the browser (`web/src/api/search.ts`, ported from `ItemCatalog.Search` and `SetCatalog.Search` with
their test cases). The static site has no install picker, no command channel and no prompt box.

```sh
npm --prefix web run dev:static      # serves output/bundle at /bundle
npm --prefix web run build:static    # writes web/dist-static/
npm --prefix web run test:e2e:static # one browser check against the bundle
```

`ALTROBE_BUNDLE_DIR` points the dev server at another bundle folder. At build time,
`VITE_ALTROBE_BUNDLE_URL` (default `/bundle`) says where the site fetches the bundle from, and
`VITE_ALTROBE_PRODUCT` (default `wow_classic_beta`) which product folder it reads. CI sets it from the
`BUNDLE_PRODUCT` repository variable ([deployment.md](deployment.md#switching-products)).

## The count check

Pass the last published build's manifest with `--previous <manifest.json>`. If any count (races,
looks, items, sets, resolved items, models, textures) drops by more than `--max-drop` (default
`0.05`, 5%), the run prints each drop, exits 1, and leaves `current.json` as it was.

## Publish a build

`npm run publish:bundle` uploads the build that `{product}/current.json` names to the assets bucket,
then switches the site to it. It runs the AWS CLI with whatever credentials it finds: a profile
locally, the deploy role in CI. It writes to AWS, so run it with `--dry-run` first.

```sh
npm run publish:bundle -- --product wow_classic_beta --profile <profile> --dry-run
```

Add `--prune` to delete every build folder but the new build and the one it replaced, after the
switch. Without a distinct previous build (the first publish, or republishing the live build),
nothing is pruned. The dry run still reads the bucket, to show what would be deleted.

`--bucket` and `--distribution` default to `BUNDLE_BUCKET` and `ASSET_DISTRIBUTION_ID`, the
`AltrobeSite` outputs ([deployment.md](deployment.md)); `--bundle` defaults to `output/bundle`. In
order, it:

1. Syncs `{product}/{build}/` to the bucket.
2. Uploads files over 10,000,000 bytes gzipped with `Content-Encoding: gzip`
   ([deployment.md](deployment.md#publishing-a-bundle) says why).
3. Uploads `{product}/current.json`, so the site moves to the build only once every file is there.
4. Invalidates `/{product}/current.json` in CloudFront.
5. When the build was already live (a bake change republishing the same build), invalidates
   `/{product}/{build}/*` too, since its JSON was rewritten under the same paths.

Rolling back is uploading the previous build's `current.json` and invalidating it; that build's files are still in the bucket.

## Automatic publishing

`.github/workflows/publish.yml` runs every six hours and from the Actions tab. It publishes with no
approval, using the publish role ([deployment.md](deployment.md#publishing-a-bundle)). In order:

1. `scripts/watch-bundle.mjs` asks the version service for the product's build and reads the live
   `current.json`. If they match, the run stops there, unless the manual run's `force` input is set:
   that rebakes and republishes the live build after a change to Altrobe's own data or code. It saves the version service's answer, so the
   bake reads the same build (`--versions-file`), and the live build's manifest for the count check.
2. The bake runs from the CDN with `--previous` set to the live manifest, so a build that drops a
   count by more than 5% fails the run.
3. The bake cache is deleted, and `web/e2e/static.spec.ts` runs against the new bundle.
4. `npm run publish:bundle -- --prune` uploads the build, switches `current.json` and deletes builds
   older than the previous one.

A failed run changes nothing on the site and opens a "Bundle publish failed" issue, or comments on
the open one. A bake took 21 minutes and peaked at 8.3 GB of disk on 2026-10-13 (3.1 GB of bundle,
5.2 GB of cache), under the 14 GB a standard GitHub-hosted Linux runner has. If builds outgrow it,
move the bake to CodeBuild through CDK.

The same workflow's `launch-watch` job opens an issue when Forever's builds reach a public product, so
the site can move off the beta ([deployment.md](deployment.md#switching-products)).

## Run it from Blizzard's CDN

This downloads several GB from Blizzard's public CDN. It asks the version service for the product's
current build and its CDN hosts, downloads that build's archive indexes and then every file the bake
needs. Nothing in the tests or the local app runs this path.

- **Indexes.** The bake fetches the archive indexes itself, 16 at a time with retries, into the cache
  folder TACTSharp reads first (`CdnIndexPrefetch`), because fetching them all at once timed out.
- **Language.** The CDN has every locale's copy of each text file. Files for English (or for every
  locale) are read first; a local install only has its own locale on disk, so it never had to choose.

A full bake is about 3 GB, with about 5 GB of download cache; a rerun with the cache takes seconds.

```sh
dotnet importer/src/Altrobe.Server/bin/Debug/net10.0/Altrobe.Server.dll bake \
  --out bundle --cdn --product wow_classic_beta --region us --cache bake-cache
```

`--versions-file <file>` uses a saved version-service answer instead of asking the service.
Encrypted files are skipped.

## Item names

Items the game files leave unnamed get Classic names from cmangos classic-db (`ClassicItemNames`);
`catalog.json` marks them `nameSource: "cmangos"` and carries the GPL-3.0 credit. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## New-in-Forever sets

Altrobe covers Classic and Forever. Season of Discovery's sets are left out everywhere: the set IDs in
`importer/src/Altrobe.Core/Catalog/season-of-discovery-sets.json` are Classic Era sets none of whose
pieces cmangos classic-db (1.12) has. The `set-ids` command writes that list from Era's current build
(about 300 MB of indexes); the bake never reads Era. The list in the repository comes from Era
1.15.9.70003.

```sh
dotnet importer/src/Altrobe.Server/bin/Debug/net10.0/Altrobe.Server.dll set-ids --product wow_classic_era \
  --season-of-discovery --out importer/src/Altrobe.Core/Catalog/season-of-discovery-sets.json
```

Of the rest, a set is new in Forever when it is on `importer/src/Altrobe.Core/Catalog/forever-sets.json`
(Forever's 21 set IDs on 1.60.1.70374), or when every piece is unnamed and at least half its pieces use a
look no named item has, which catches a set a later build adds. Unnamed copies of named sets stay out
(`SetCatalog`). The list matters because Blizzard's hotfixes name items that share these sets' looks
(Grovekeeper Boots, Gauntlets of Glory): with hotfixes applied, as in the local app or a later CDN
build, the unnamed-looks test alone drops them. The sets panel lists them as "New in Forever" after
Tier 3. `sets.json` and `notable.json` give each one `newInForever`, its `armor` type and a class mask
with its `classSource`:

- `name`: a tier set name, or a word or phrase only one class's tier sets use (`NotableSets`).
- `curated`: the class IDs `forever-sets.json` gives the set. It places each Forever set family (Glory,
  Justice, Grovekeeper and the rest) in its one class; an empty list falls through to armor type.
- `armor`: the classes that wear its armor type; every class when it has no armor piece.

`node tools/suggest-data-mined-classes.mjs <bundle>/<product>/<build>` suggests curated classes from
shared helm and shoulder models. Check each one before adding it: shared models mislead.

Leaving Season of Discovery out dropped the set count from 520 to 220 on 1.60.1.70338, more than the
count check allows. The first publish after that change goes out by hand, without `--previous`.
