# Hosted prompt box

The website's "type what you want" box. Players type a command; Amazon Bedrock (Nova 2 Lite) answers
with tool calls; the browser runs them. No sign-in. The project pays from its AWS account, so every
command passes limits first. The design and the reasons for it are in the maintainer's Phase 4 Hosted
Prompt Box Spec; this file is the contract between the two halves:

- **The prompt API** (`infra/`): a Lambda behind API Gateway (HTTP API), routed from the app's
  CloudFront distribution at `/api/*`. It holds the instructions, the tool list and the Bedrock
  permission, checks the limits, and relays one model step per request.
- **The website** (`web/`): the prompt box in hosted mode. It runs the agent loop: it sends steps to
  the API and runs the returned tool calls itself, against the static bundle and the existing commands.

## `POST /api/prompt`

One request is one model step. A command takes one to eight steps.

### Request

```json
{
  "messages": [ ... ],
  "turnstileToken": "...",
  "ticket": "...",
  "creative": true,
  "tools": false
}
```

- `messages`: the conversation so far, in Bedrock Converse shape. The first step sends one user
  message with the typed text. Each later step appends the model's last message (as returned) and a
  user message with one `toolResult` per `toolUse`.
  - user text: `{ "role": "user", "content": [{ "text": "put this Undead in Judgement" }] }`
  - model reply: `{ "role": "assistant", "content": [{ "text": "..." }, { "toolUse": { "toolUseId": "...", "name": "search_sets", "input": { ... } } }] }`
  - tool results: `{ "role": "user", "content": [{ "toolResult": { "toolUseId": "...", "content": [{ "json": { ... } }], "status": "success" | "error" } }] }`
- `turnstileToken`: required on the first step only (one user message). Cloudflare tokens work once
  and last 300 seconds.
- `creative`: optional; `true` on every step of a name request (the Identity panel's Suggest names),
  which runs the model at temperature 0.8 instead of 0 for more varied names. It changes nothing else:
  not the limits, the cost cap or the tools. Any other value than a boolean is a `bad_request`.
- `tools`: optional; `false` on a text-only request (no page sends it since Polish was removed on 2026-10-19), which sends the model
  no tools, so it can only reply in text (at most 200 characters, like any reply). Such a command ends in
  one step, so a later step with `tools: false` is a `bad_request`, as is any value other than `false`.
- `ticket`: required on every later step: the value the previous step's response returned. Each
  ticket is good for the next step only, for two minutes, from the same IP address (the same /64 for
  IPv6), and only for the conversation it was issued with: the messages before the last one must be
  exactly those of the previous request plus the `message` it returned.

### Response, 200

```json
{
  "ticket": "...",
  "stop": "tool_use",
  "toolUses": [{ "toolUseId": "...", "name": "equip_set", "input": { "setId": 217 } }],
  "message": { "role": "assistant", "content": [ ... ] },
  "text": "Put Judgement on the Undead.",
  "remaining": 19,
  "resetAt": "2026-10-20T13:00:00Z"
}
```

- `stop`: `tool_use` (run the tools and send the next step) or `end` (the command is done).
- `toolUses`: the tool calls to run, in order. Empty when `stop` is `end`.
- `message`: the model's message, to append to `messages` unchanged.
- `text`: the model's reply text, at most 200 characters; empty when there is none. `message` holds
  the same trimmed text followed by the tool calls, nothing else.
- `remaining`: commands this IP address has left today, after this one.
- `resetAt`: when the daily limits reset, 13:00 UTC.

### Errors

Never 403 or 404: the app distribution rewrites those to `index.html` for the browser's routes.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `bad_request` | Malformed body, too large (over 64 KB), too many messages (over 17), typed text over 500 characters, a ticket for a different conversation, or a ticket already used (each step's ticket works once) |
| 400 | `turnstile` | The first step's Turnstile token fails Cloudflare's check |
| 429 | `ip_limit` | This IP address has used its 20 commands today; `resetAt` says when they come back |
| 429 | `daily_cap` | Today's spend reached the global cap ($10); `resetAt` says when the box reopens |
| 429 | `too_many_steps` | The command passed 8 steps |
| 503 | `disabled` | The kill switch is off; the box hides |
| 503 | `unavailable` | The API can't reach its own storage or secrets; try again in a moment |
| 502 | `model` | Bedrock failed |

Every error body is `{ "error": "...", "message": "...", "resetAt"?: "..." }`. `message` is a short
sentence the box can show as it is. Any other path or method under `/api/` answers 400 `bad_request`.

API Gateway answers some requests before the Lambda runs, with a body of `{ "message": "..." }` and
no `error`: 429 when its rate limit (10 requests a second, bursts of 20) turns a request away, and an
error status when Lambda refuses an invocation over the reserved concurrency (API Gateway's
documentation doesn't say which status). Measured on 2026-10-19 with 60 requests at once: 5 reached
the Lambda and 55 got `503 {"message":"Service Unavailable"}`. The website treats any 429 or
5xx response without an `error` field as busy ("try again in a moment"). The API itself never
answers with a `busy` code.

## Limits

1. **Turnstile** on the first step of each command, checked server-side (`secret`, `response`,
   `remoteip`). The token's `action` must be `prompt` and its `hostname` `altrobe.com` or
   `www.altrobe.com`.
2. **Per IP, 20 commands a day,** counted on the first step only. The count is stored under an
   HMAC-SHA256 of the IP address with a key that changes daily, and expires when the day ends. An
   IPv6 address counts by its /64, since one home or phone holds a whole /64. The address comes from
   CloudFront's `CloudFront-Viewer-Address` header; CloudFront also adds a secret header, and the API
   refuses requests without it, so nobody can reach the API directly with a made-up address. The raw
   IP address is never stored or logged.
3. **The ticket** ties later steps to a counted first step: an HMAC of the command ID, the hashed IP,
   the step number, an expiry 2 minutes out, the commands left, and a hash of the conversation so far. A step with a missing, expired or mismatched ticket
   is refused, so the limits can't be skipped by starting mid-conversation. Each ticket works once
   (a conditional write in DynamoDB), so a step can't be replayed with other tool results to buy model
   calls: a command costs at most 8 of them.
4. **Global daily spend,** in dollars from each Bedrock call's reported token usage at Nova 2 Lite's
   price ($0.33 per million input tokens, $2.75 per million output tokens). Checked before each step; the box closes for everyone at $10 until 13:00 UTC.
5. **Kill switch:** the SSM parameter `/altrobe/prompt/switch`. When it reads `off`, every request
   answers 503 within 30 seconds (each Lambda instance caches it that long).
6. **Lambda reserved concurrency of 5.** Requests over it are throttled before the Lambda runs, with no
   `error` code; the website shows them as busy.
7. **AWS Budgets action:** past the monthly Bedrock budget, it attaches a policy denying
   `bedrock:InvokeModel` to the Lambda's role. Billing data lags by up to a day, so this is the last
   line behind 4 and 5. Bedrock calls through an inference profile carry no tags, so this budget
   counts the whole account's Bedrock spend.

Each Bedrock call has `maxTokens` 600 and temperature 0, or 0.8 for a `creative` request. The API returns tool calls and at most 200
characters of text, so it can't serve as a general chatbot.

## Tools

The API defines the tools and the instructions; the website runs the tools. Names and inputs:

| Tool | Input | Runs on |
| --- | --- | --- |
| `search_items` | `query`, `slot`, `quality`, `min_level`, `max_level`, `armor`, `weapon`, `hands`, `new_in_forever`, `limit` | the static catalog |
| `search_sets` | `query`, `limit` | the static sets |
| `equip_set` | `setId`, `replace` | the set's pieces, then `equip_items` |
| `equip_item` | `slot`, `itemId` | `commands.equip_item` |
| `unequip` | `slot` | `commands.unequip` |
| `list_characters` | none | the static characters list |
| `set_character` | `race`, `sex` | `commands.set_character` |
| `get_look` | none | `describeLook`, plus the identity with its title and class in words (`commands.describe_identity`) |
| `compare` | `characters` (each with `race`, `sex`, and optionally `label`, `setId`, `items`), `add` | the set's pieces, then `commands.compare`; with `add`, after the characters already there |
| `build_outfit` | `level`, `armor`, `weapons` | the static catalog, then `equip_items` |
| `list_animations` | none | the base look's animations |
| `set_animation` | `name` | `commands.set_animation` |
| `list_customization` | `option` | the main character's options, and whose they are; with `option`, its choices and their swatch colors |
| `set_customization` | `option` and `choice` by name, or `optionId` and `choiceId` | `commands.set_customization` |
| `randomize_customization` | none | `commands.randomize_customization` |
| `reset_customization` | none | `commands.reset_customization` |
| `set_identity` | `firstName`, `lastName`, `guild`, `level`, `pvp`, `class`, `title` | class and title by name, then `commands.set_identity` |
| `set_view` | `view` (`front`, `side`, `back` or `head`) | `commands.set_view` |
| `suggest_names` | `names`: up to 8 of `{ firstName, lastName }` | the name check, the name lists and the famous names, then the first 5 that pass join the Identity panel's suggestions; the look doesn't change |

`compare` takes a whole set by `setId`, so the model doesn't copy each piece's item ID; `items` go on top of it. It replaces the characters beside the main one unless `add` is true, and when it replaces some it names them, so a model that meant to add one can call it again. `set_character` names the characters still beside the main one, so a model told "just show a Gnome" clears them. `equip_set` and `compare` take only a set ID that `search_sets` returned in the same command, since the model otherwise guesses set IDs from the tier list. The instructions tell the model that the races a prompt names are the whole lineup, the first one named being the main character, unless the prompt refers to the characters already shown ("add", "them"). `set_identity` finds a title by its wording among the race's faction's titles, and an empty string clears a name or the guild. `set_customization` by name saves the model a listing step; colors have no names, so those still go by ID. `suggest_names` sends back the pairs that fail the name check (`web/src/identity/name-rules.ts`), use a name already in the name lists or the batch, or use a famous Warcraft name (`web/src/identity/famous-names.ts`), so the model can replace them. A pair already showing that the model sends again is left as it is, and `shown` counts every name showing. The first `suggest_names` call of each command starts the suggestions over, and a command gets three calls: the model ignores "do this once" in the instructions, so the tool refuses a fourth. For the same reason, a second `set_character` in one command answers with a reminder to add other races with `compare`.

### Names

The Identity panel's Suggest names button sends a command for the character's race, sex and class, the style typed into Name style, and a few of the game's names for the model to match without copying. The model runs at temperature 0.8 for these (`creative`) and makes up new names; the examples never share an ending, since the model copies a shared one. `suggest_names` refuses any name in the game's random-name lists (`names.json` in the bundle) or in Altrobe's own lists (`web/src/identity/more-names.json`, about 200 names per race and list, checked by `more-names.test.ts`), since those are what the lists already offer.

The lists are the fallback. When the box can't answer (the daily limits, the kill switch, a busy or failed request) or there's no prompt box (the local app, or `VITE_PROMPT_API` unset), the panel shows five names from the lists and says why; when the model finds fewer than five new names, the lists fill the rest. List picks lean three to one toward Altrobe's names, since the in-game dice button gives Blizzard's. Generate name uses the same lists. Both skip the names the game refuses and the famous names Blizzard's lists hold (Thrall, Arthas, 42 in all).

`build_outfit` follows the local app's rule (`McpTools.BuildOutfit`): in each armor slot, the item with
the highest required level within 7 levels below the target, then an item new in Forever, then the
highest item level; the main hand only when weapon types are given.

## Privacy

The box processes the typed text (sent to Amazon Bedrock, not stored by Altrobe), a hashed IP
address kept one day for the limit, and a Cloudflare Turnstile check. The About dialog says so.

## Turning the box on (website)

The static site shows the box only when its build sets `VITE_PROMPT_API`; without it, nothing
changes. `1` shows it to everyone. `preview` shows it only at a URL with `?prompt=preview`
(`https://altrobe.com/?prompt=preview`), so it can be tried on the live site before anyone else
sees it. The site rewrites its URL into a share link once it loads, so a reload needs the
`?prompt=preview` link again. `VITE_TURNSTILE_SITE_KEY` is the Turnstile widget's site key. A development build without
one uses Cloudflare's always-pass test key, `1x00000000000000000000AA`; a production build without
one can't get a token, so every command fails the Turnstile check. The widget's `action` is `prompt`.

```sh
VITE_PROMPT_API=1 VITE_TURNSTILE_SITE_KEY=<site key> npm --prefix web run build:static
```

In CI, the deploy workflow passes the repository variables `PROMPT_API` and `TURNSTILE_SITE_KEY` to
both static builds. Set `PROMPT_API` to `preview` (hidden, at `?prompt=preview`) or `1` (everyone) and
`TURNSTILE_SITE_KEY` to the site key, then merge or run "Deploy", to turn the box on; unset `PROMPT_API` to take it off the site. The kill switch turns it off
faster, without a deploy.

The browser side lives in `web/src/assistant/`: `hosted.ts` (the agent loop and error states),
`hosted-tools.ts` (the tools), `outfit.ts` (`build_outfit`) and `turnstile.ts`.
