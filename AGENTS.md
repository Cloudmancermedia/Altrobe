# AGENTS.md

Instructions for coding agents working on Altrobe for an outside contributor. The rules are in
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md); read it before making a change. This file is a short
list of what an agent must do, not a second copy.

## Setup

- Needs the .NET 10 SDK, Node.js 20 or newer, and World of Warcraft: Forever installed.
- `npm start` builds the web app and runs the local server. `npm run dev` adds hot reload on
  `http://localhost:5173/`. The [README](README.md#development) has the rest.

## Tests

- Write a test that fails without the change first, then make it pass.
- Run `npm test` from the repository root before every commit. It checks for game content, then
  runs the .NET tests and the web app's lint and unit tests.
- If you change `infra/`, also run `npm --prefix infra test` and
  `npm --prefix infra run synth:offline`.

## Hard rules

- Never commit game content: models, textures, tables or anything else taken from the game.
  `scripts/check-no-game-content.mjs` enforces this.
- Never commit secrets, credentials or AWS account IDs.
- Changes under `.github/`, `infra/`, packaging and the content check need the maintainer's review
  (see `.github/CODEOWNERS`). Don't touch them unless the task needs it.

## Pull requests

The human you work for opens and owns the pull request. Help them, but don't act for them:

- They must understand the change and be able to explain it without you. Walk them through it.
- The pull request description says which AI tool was used and what it did. Suggest an
  `Assisted-by: <tool>` commit trailer.
- They write the description and answer review comments themselves. Don't draft replies to
  reviewers for them to paste.
- Any change to how the site looks or moves needs before-and-after screenshots, a short clip for
  animation or camera changes, and a phone-width screenshot for layout changes. Remind them to
  attach these.
- Don't open issues, pull requests or comments without their approval.
