# Contributing

Altrobe is a community project, and suggestions and pull requests are welcome. Bug reports, fixes
and new features all help.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- The [README](../README.md#development) covers setup. You need the .NET 10 SDK, Node.js 20
  or newer, and World of Warcraft: Forever installed.

## Making a change

1. Branch from `main`.
2. Add a test that fails without your change, then make it pass.
3. Run `npm test` from the repository root. If you changed `infra/`, also run
   `npm --prefix infra test` and `npm --prefix infra run synth:offline`.
4. Open a pull request and fill in the template: what changed and why, how you tested it, and
   whether you used AI tools. Conventional commit titles (`fix: ...`, `feat: ...`) are welcome but
   not required.

## Rules every change follows

- **No game content.** Never commit models, textures, tables or anything else taken from the game.
  `scripts/check-no-game-content.mjs` checks this in CI.
- **No secrets and no AWS account IDs.** Deploy settings come from the GitHub environment, not the
  repository.
- **Some paths need the maintainer's review:** `.github/`, `infra/`, packaging and the content
  check. [`.github/CODEOWNERS`](../.github/CODEOWNERS) lists them.

## Using AI tools

You can use AI coding tools. Altrobe itself was built with Claude Code. What matters is that a
person stays in the loop and stands behind every change, as in
[LLVM's AI Tool Use Policy](https://llvm.org/docs/AIToolPolicy.html):

- **Understand your change.** Read and review everything a tool wrote before you ask for a review.
  You should be able to explain what the change does, and how it fits the rest of the code, without
  the tool. If you can't, the change isn't ready.
- **You are accountable for it.** You are the author, whatever wrote the first draft. That includes
  the rules above: a tool that reproduces game content or someone else's code doesn't make it okay
  to commit.
- **Say what you used.** Name the tool in the pull request description and what it did (wrote the
  first draft, wrote the tests, suggested a fix). An `Assisted-by: <tool>` commit trailer is
  welcome too.
- **Write the pull request description yourself.** A tool can help with spelling or translation,
  but the description should show that you understand the change.
- **Answer review comments yourself.** Don't paste a reviewer's comments into a tool and post its
  reply. Review is a conversation between people.
- **Keep a person in charge.** Don't let an agent open issues, pull requests or comments on its own.

Issues and comments follow the same rules: if a tool helped write one, read it, cut it down, and
make sure it says what you mean.

## Visual changes

Any change to what the site looks like or how it moves needs screenshots in the pull request
before it can be approved:

- Before-and-after screenshots of what changed.
- A short clip for animation or camera changes.
- A phone-width screenshot when the layout changes.

Pull requests without them aren't reviewed until they're added.

## How CI treats pull requests

Pull requests from forks run the tests with read-only permissions and no secrets. Nothing a pull
request runs can deploy; deploys happen only from `main`, after the maintainer merges. See
[deployment.md](deployment.md).

## Security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).
