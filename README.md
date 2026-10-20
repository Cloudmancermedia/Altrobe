# Altrobe

A dressing room for World of Warcraft: Forever. Dress any race in any gear, give the character a
name, guild and title, and share the look as a link.

**Try it at [altrobe.com](https://altrobe.com)**, no install or account needed.

If Altrobe is useful to you, you can [buy me a coffee](https://buymeacoffee.com/cloudmancer).

## What it does

- Shows every playable race and sex, in the HD or classic (SD) models.
- Finds any item by name or ID, or a whole set: the classic tier sets, PvP sets, and the sets new in
  Forever.
- Draws the name, guild and title over the character's head, and the in-game tooltip, with a name
  generator for when you're stuck.
- Changes skin, face, hair and the other customization options, and plays the character's
  animations.
- Puts up to six characters side by side, each in its own outfit, for comparing races or planning a
  leveling journey.
- Saves a look as a link to share, or as a file to open later, and writes it out as a short text
  description to copy.

The downloadable app adds two things the website leaves out. You can dress characters by typing what
you want in plain language, and Claude or Codex can drive it directly over
[MCP](https://modelcontextprotocol.io).

## Two ways to run it

**The website** reads game data Altrobe converts ahead of time from Blizzard's public CDN. It
updates on its own when Blizzard ships a new build.

**The local app** reads the World of Warcraft: Forever install on your own computer and converts
models as you view them. It never downloads game data from Blizzard, and it adds plain-language
commands and an MCP endpoint that the website doesn't have.

> **Beta: only tested on Macs with Apple silicon.** Builds for Windows, Intel Macs and Linux are in
> each release but haven't been tried on real hardware yet. If you run one, please
> [report](https://github.com/Cloudmancermedia/altrobe/issues/new) how it goes.

To run it:

1. Download the zip for your computer from
   [Releases](https://github.com/Cloudmancermedia/altrobe/releases) and unzip it.
2. Start `Altrobe` (`Altrobe.exe` on Windows; on Linux, run `./Altrobe` from a terminal). Your
   browser opens it at `http://127.0.0.1:5161/`.
3. Altrobe isn't signed, so the first start shows a warning:
   - Windows SmartScreen: click **More info**, then **Run anyway**.
   - macOS: click **Done**, then open System Settings > Privacy & Security and click **Open
     Anyway**.

`READ ME FIRST.txt` in the zip has the full steps, and what to do if Altrobe can't find your game.

## How it works

```
game files ──► importer (.NET) ──► glTF models, PNG textures, JSON ──► web app (React, three.js)
```

- **`importer/`** reads the game's file storage with [TACTSharp](https://github.com/wowdev/TACTSharp)
  and its tables with [DBCD](https://github.com/wowdev/DBCD). It works out what each item looks like
  on each race (geosets, textures, attached models, glows) and converts the game's model and texture
  formats to glTF and PNG, so the browser needs no game-format parser.
  - `Altrobe.Server` is the local app: it does this on demand from your install.
  - Its `bake` command does it ahead of time for a whole build, read from Blizzard's CDN, and writes
    the static bundle the website serves.
- **`web/`** is the dressing room itself. It runs unchanged against the local server or a baked
  bundle; the website is a static build with search running in the browser.
- **`infra/`** is the website's AWS setup in the CDK: two private S3 buckets behind CloudFront, one
  for the app and one for the game bundles. GitHub Actions deploys it, and a scheduled job bakes and
  publishes each new game build.
- **`desktop-extension/`** packages the local app's MCP endpoint as a Claude Desktop extension.

[docs/hosted-pipeline.md](docs/hosted-pipeline.md) covers the bake and publish in detail.

## Development

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download), [Node.js](https://nodejs.org) 20 or
newer, and World of Warcraft: Forever installed.

```sh
git clone https://github.com/Cloudmancermedia/altrobe.git
cd altrobe
npm start
```

`npm start` builds the web app, then runs the local server and opens it in your browser.

| Command | What it does |
| --- | --- |
| `npm run dev` | The server plus Vite with hot reload on `http://localhost:5173/`. |
| `npm test` | Checks that no game content is tracked, then runs the .NET tests and the web app's lint and unit tests. |
| `npm run package -- <rid>` | Builds a release zip for `win-x64`, `osx-arm64`, `osx-x64` or `linux-x64`. |
| `npm --prefix web run test:e2e` | Browser checks against your own install (opt-in). |

More detail:

- [docs/local-server.md](docs/local-server.md): the server's options, API and MCP setup
- [web/README.md](web/README.md): the web app and its browser checks
- [docs/look-format.md](docs/look-format.md): the format of a saved or shared look
- [docs/hosted-pipeline.md](docs/hosted-pipeline.md) and [docs/deployment.md](docs/deployment.md): the website
- [docs/releasing.md](docs/releasing.md): cutting a release

Contributions are welcome; [CONTRIBUTING.md](docs/CONTRIBUTING.md) has the ground rules. Report
security issues privately, as [SECURITY.md](docs/SECURITY.md) describes.

## Game content

This repository contains code only. It never holds Blizzard's game files, models, textures or
extracted tables, and a check in `npm test` enforces that. Altrobe doesn't offer game models or
textures for download, doesn't read encrypted or unreleased files, and doesn't use Blizzard
trademarks in its name.

## License

The code is under the [MIT License](LICENSE). It covers Altrobe's code only and grants no rights to
Blizzard's game content. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists the open-source work
Altrobe builds on.

Altrobe is a fan project. It is not affiliated with or endorsed by Blizzard Entertainment. World of
Warcraft and World of Warcraft: Forever are trademarks of Blizzard Entertainment, Inc.
