# HLTV Team Alert

A Chrome and Edge extension that tells you when the Counter-Strike teams you
follow are live or about to play on [HLTV](https://www.hltv.org/).

Add the teams you care about, leave an HLTV tab open, and get an on-page toast
or a desktop notification when one of them qualifies — instead of refreshing
the schedule yourself.

**Status:** v1.0.0 prototype. Everything below is implemented and tested, but
the extension has not yet been loaded into a real browser against a live match.
See [Release gates](#release-gates) before treating it as shipped.

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

That writes `dist/hltv-team-alert-<version>.zip` with `manifest.json` at the
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
- **Scan now** — forces an immediate pass without waiting for the 30s interval.

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

- [ ] Load the unpacked extension in Chrome and Edge and confirm it starts clean.
- [ ] Follow a team, confirm the toast and the desktop notification both fire.
- [ ] **Confirm live-match rendering.** No match was live when the adapter was
      built, so the live branch is derived from the `live`/`filteraslive`
      attribute contract rather than observed. This is the one untested path.
- [ ] Confirm a notification click opens the right match.
- [ ] Confirm no duplicate alerts across a reload and two open HLTV tabs.

Verified so far: the adapter was run against the live `/matches` DOM and parsed
36 of 183 cards — every match with named teams, the rest being TBD placeholders
— with no missing start times, team ids or event names.

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
