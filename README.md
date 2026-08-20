# Realized HLTV Extension

A Chrome and Edge extension that tells you when the Counter-Strike teams you
follow are live or about to play on [HLTV](https://www.hltv.org/).

Add the teams you care about, leave an HLTV tab open, and get an on-page toast
or a desktop notification when one of them qualifies — and, if you want it, the
match's live stream popped open in its own window.

**Status:** v1.2.0. Loaded and exercised in Chrome 151 against the live site:
following, per-team settings, the on-page toast, the desktop notification and
the stream popup window are all confirmed working. Live-match *detection*
remains the one unverified path — see [Release gates](#release-gates).

---

## Install (unpacked)

1. Clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the repository folder.
5. Open or reload a page on `https://www.hltv.org/`.

Requires Chrome 102+ or a matching Chromium-based Edge.

To build a store-style archive instead:

```bash
node tools/package.js
```

That writes `dist/realized-hltv-extension-<version>.zip` with `manifest.json` at the
archive root, after running the release checks.

## Using it

Click the toolbar icon to open the popup:

- **Followed teams** — add a team by its exact HLTV name (`Vitality`, not
  `Team Vitality`). Matching ignores case, padding and diacritics but is
  otherwise exact, so `NAVI` will not match `NAVI Junior`.
- **When to alert** — pick how far ahead of a match start you want warning, and
  whether alerts arrive as on-page toasts, desktop notifications, or both.
- **Status** — when the last scan ran, how many matches were recognised, and
  whether the browser is actually allowing desktop notifications.
- **Live stream** — whether to pop the stream open when a followed team goes
  live, and which platform and language to prefer. These are preferences, not
  filters: if nobody is broadcasting on your pick, the biggest available stream
  opens instead.
- **Scan now** — forces an immediate pass without waiting for the 30s interval.
- **Send a test alert** — fires a synthetic alert down the real toast and
  notification paths, so you can confirm delivery works without waiting for a
  followed team to actually play.

### Following a player

Open any player's profile and the same panel appears under their name. Following
them covers two separate things, each with its own switch:

- **When their team plays** — their current team is watched as though you had
  followed it directly, so following a player is enough; you do not also have to
  follow their org. The team is re-read on every profile visit, so a transfer
  stops alerting for the roster they left.
- **When they go live** — their own channel, taken from the broadcast links on
  their profile. Non-broadcast socials are ignored.

Personal-stream alerts need no extra permission and no Twitch API key. Every
HLTV page carries a "Top streams" sidebar listing who is broadcasting right now,
with the channel in each entry's embed URL, so the same open tab that scans for
matches also tells us who is live. Matching is on the channel rather than the
displayed label, because HLTV shows names like `chopper` for a channel actually
called `chopperinho`.

Alerts fire on the moment a stream comes online, not while it is online — a
broadcast stays up for hours, and the latter would re-fire every scan. That
means the first scan after install stays quiet on purpose: with no previous
state to compare against, every live channel would look newly live.

### Per-match settings

Open any match page on HLTV and a panel appears above the stream list. It sets
that one match's alerting and stream preferences independently: whether to
alert at all, how far ahead, whether to open the stream, and which platform and
language to prefer. The platform and language menus list only what this match
is actually broadcast on.

Every control offers **Use default**, which inherits the global setting rather
than pinning a copy of it — so overriding a stream language for one match does
not freeze its lead time, and changing your global lead time still moves that
match. The panel also previews which stream would open, and **Watch now** opens
it immediately.

Visiting a match page also snapshots its stream list. That is what lets an
alert firing later — from the matches list, which carries no stream data — open
the broadcast you asked for rather than a generic page.

An HLTV tab must stay open. Removing that requirement is Phase 3 of the
[project brief](docs/PROJECT_BRIEF.md).

## How it works

```
HLTV page  ->  source adapter  ->  match candidates  ->  alert core  ->  channels
               (src/core/parser)   (normalized)         (rules+dedupe)   (toast/desktop)
```

| Path | Role |
| --- | --- |
| `src/core/parser.js` | The **only** file that knows HLTV markup. Emits normalized match candidates. |
| `src/core/streams.js` | Parses a match page's stream list and picks one by preference. |
| `src/core/rules.js` | Resolves overrides down the global -> team -> match chain. |
| `src/core/teams.js` | Followed-team records, identity and v1 migration. |
| `src/core/players.js` | Followed players, their team and their personal channels. |
| `src/core/streamers.js` | The live-streams sidebar, and offline -> live transitions. |
| `src/core/normalize.js` | Comparison keys for team names. |
| `src/core/status.js` | Classifies a match as live, starting-soon, scheduled or past. |
| `src/core/matching.js` | Decides which followed teams a match involves. |
| `src/core/alerts.js` | Generates alerts, builds dedupe keys, prunes delivery history. |
| `src/content/` | Scan loop and the on-page toast stack. |
| `src/background/` | Desktop notifications and notification clicks. |
| `src/popup/` | Settings and health UI. |
| `src/shared/storage.js` | Storage access, split by durability. |

Three design rules hold this together:

**The adapter is replaceable.** Every HLTV selector lives in `parser.js` behind
a `SOURCE_VERSION` stamp. Nothing downstream knows what HLTV markup looks like,
so a site redesign is a one-file change plus a fresh fixture.

**Core logic is pure.** `src/core/` has no DOM and no `chrome.*` calls, which is
why it can be tested in plain Node — and why Phase 3 can move the same pipeline
behind `chrome.alarms` without rewriting the rules.

**Storage is the source of truth.** MV3 service workers are killed whenever
they go idle, so nothing that has to survive a restart lives in a variable. The
URL a desktop notification opens round-trips through session storage, so a click
still works after the worker has been torn down.

### Alerting once, and only once

Each delivery is keyed on `matchId | team | status`. That means:

- a page rendering the same match twice alerts once;
- a reload, a second HLTV tab, or a service-worker restart does not re-alert;
- a match moving from *starting soon* to *live* **does** alert again, because
  the status changed.

Delivery records are pruned after seven days. Turning both channels off records
nothing, so re-enabling a channel later does not find every key already burned.

## Permissions

Two, both tied to visible behaviour:

| Permission | Why |
| --- | --- |
| `storage` | Your followed teams and settings, plus the delivery history that prevents duplicate alerts. |
| `notifications` | Desktop notifications, if you enable that channel. |

There are deliberately **no** `host_permissions` and **no** `tabs` permission.
The extension never reads tab URLs: "Scan now" messages every tab and lets the
non-HLTV ones reject, which achieves the same thing without the permission.
Nothing is sent anywhere — there is no project server, and settings live in your
browser's own extension storage.

## Development

No dependencies and no build step. Node is used only to run the tests.

```bash
node test/run-tests.js
```

```bash
node tools/validate.js
```

`validate.js` is the release gate: it checks that every file the manifest
references exists, that every shipped script compiles, that the popup's own
`<script>`/`<link>` targets resolve, and that no permission has quietly been
added without being documented here.

Icons are generated, not committed as opaque binaries:

```bash
node tools/make-icons.js
```

### Tests

Six suites, 85 assertions, covering normalization, exact matching, status
classification, alert generation, disabled/empty states, and parsing.

The parser suite runs against **real HLTV markup** captured in
`test/fixtures/matches-page.html`. There is no jsdom — `test/stub-dom.js`
implements just enough HTML parsing and CSS selector matching to run the
adapter, which keeps the project dependency-free and means a markup change can
be reproduced by pasting a fresh card into the fixture.

### When HLTV changes its markup

1. Open the page, copy a match card's `outerHTML`, replace the fixture.
2. Update the selectors in `src/core/parser.js`.
3. Bump `SOURCE_VERSION` in `src/shared/constants.js`.
4. `node test/run-tests.js`.

The popup's status panel will show "no matches recognised" while this is broken,
rather than quietly reporting zero matches — a silent empty parse and a genuinely
quiet day must not look the same.

> **A caution from building this.** The adapter was first written against HLTV's
> older markup, where `.matchLive` marked a live match. On current HLTV that
> class still exists but is a **star rating** (`div.match-rating.matchLive`) on
> *scheduled* matches — it matched 41 of them. Live state now comes from the
> `live` attribute on `.match-wrapper`, and `filteraslive` on the front page.
> A class that still resolves does not mean it still means what it did.

## Release gates

Before this is treated as shipped:

- [x] Load the unpacked extension in Chrome and confirm it starts clean.
- [x] Follow a team from its profile, confirm the record stores id, name and
      slug, and that per-team settings round-trip through storage.
- [x] Confirm the on-page toast and the desktop notification both fire.
- [x] Confirm the stream popup opens, reuses its window for the same match, and
      opens a separate one for a different match.
- [ ] **Confirm live-match detection.** No match has been live during any test
      session, so the live branch is still derived from the `live` attribute
      contract rather than observed. This is the one untested path.
- [ ] Confirm a notification click opens the right match.
- [ ] Confirm no duplicate alerts across a reload and two open HLTV tabs.
- [ ] Repeat the above in Edge.

Verified against the live site:

- the adapter parsed 36 of 183 cards on `/matches` — every match with named
  teams, the rest being TBD placeholders — and 56 of 205 on a later run
- one match page carried 27 external streams across Twitch, YouTube and Kick in
  11 languages, all extracted with platform, language and viewer count
- the team panel injected on a real profile, and Follow -> per-team lead time ->
  storage -> the popup's team list round-tripped end to end

Note that `--load-extension` is ignored by Chrome 137+, so automated loading
goes through the DevTools `Extensions.loadUnpacked` command instead.

## Known limitations

- **An HLTV tab must stay open.** No background monitoring yet (Phase 3).
- **Teams are followed by name, not id.** The adapter already captures HLTV's
  stable team, match and event ids; the follow list has not moved onto them yet
  (Phase 1).
- **Two tabs can double-notify.** Each tab merges its delivery history before
  writing, so the window is small, but it exists until scanning moves into a
  single background alarm (Phase 3).
- **No scores, maps or results.** v1 alerts that a match is happening, not what
  is happening in it (Phase 4).

## Roadmap

Six phases, from stable team ids through to optional cross-device delivery, are
described in [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md), along with the
open decisions the team still has to make — data strategy, background mode,
distribution, and whether a backend is ever justified.

## Licence

Not yet chosen. Distribution and commercial status are listed as open decisions
in the project brief, so no licence is asserted here yet.

---

*Independent project. Not affiliated with, endorsed by, or connected to
HLTV.org.*
