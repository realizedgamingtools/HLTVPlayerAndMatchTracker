# Testing without waiting for a real match or stream

Most of what this extension does is triggered by something happening on HLTV:
a team going live, a match starting in fifteen minutes, a player opening their
stream. Waiting for those makes the interesting paths nearly untestable — the
live-match branch went unverified for days simply because nothing was live
during any session.

The way around it is to **fake the source data, not the logic**. Every recipe
below injects markup in HLTV's own shape into a real page, then lets the real
content script parse it, diff it, and deliver through the real notifier. Nothing
downstream is stubbed, so a pass means the shipped path works.

---

## Before you start: reload the page after reloading the extension

Reloading an unpacked extension orphans the content scripts already running in
open tabs. They keep executing, but every `chrome.*` call throws:

```
Error: Extension context invalidated.
```

Symptom: scans silently stop, `Scan now` reports zero tabs, nothing alerts. The
fix is always to reload the HLTV tab (and the popup) after reloading the
extension. This costs more debugging time than any real bug in this codebase.

---

## Recipe 1 — a followed player goes live

The stream path is the easiest to fake, because a live entry is a single element
with data attributes.

1. Follow a player from their HLTV profile. Note their channel — the panel shows
   it, e.g. `Watching Twitch: s1mple`.
2. Leave any HLTV page open for at least one scan (30 seconds) so the extension
   records a baseline of who is currently live.
3. Open DevTools on that page and paste this, replacing the channel:

```js
(() => {
  const CHANNEL = 's1mple';                     // the followed player's channel
  document.getElementById('sim-live')?.remove();
  const host = document.createElement('div');
  host.id = 'sim-live';
  host.innerHTML =
    '<div class="streams-stream"' +
    ' data-frontpage-stream-title="' + CHANNEL + '"' +
    ' data-frontpage-stream-viewers="41230"' +
    ' data-frontpage-stream-type="STREAMER"' +
    ' data-frontpage-stream-flag-name="Ukraine"' +
    ' data-frontpage-stream-embed-src="https://player.twitch.tv/?channel=' +
      CHANNEL + '&autoplay=true&parent=www.hltv.org"></div>';
  document.body.appendChild(host);
  return 'injected — now click Scan now, or wait 30s';
})();
```

4. Click **Scan now** in the popup, or wait for the next automatic scan.

Expected: an on-page toast reading *"&lt;player&gt; is streaming"*, a desktop
notification if enabled, and — if that player has *Open their stream when live*
set — a popup window on their channel.

Then **scan again without removing the node**. Nothing should fire the second
time: the alert belongs to the moment a stream comes online, not to it being
online.

To run the whole thing again, remove the node (`sim-live`), scan once so the
baseline forgets the channel, then re-inject.

## Recipe 2 — a followed team is live, or about to play

Match cards need a little more markup. `.match-wrapper` with two
`.match-teamname` elements and a link is the minimum the adapter accepts.

```js
(() => {
  const TEAM = 'Natus Vincere';                 // a team you follow
  const OPPONENT = 'FaZe';
  const MINUTES = 0;                            // 0 = live, or e.g. 10 = soon
  document.getElementById('sim-match')?.remove();
  const host = document.createElement('div');
  host.id = 'sim-match';
  const live = MINUTES === 0;
  host.innerHTML =
    '<div class="match-wrapper" data-match-id="999999"' +
      (live ? ' live="true"' : '') + '>' +
      '<a href="/matches/999999/simulated"></a>' +
      '<div class="match-teamname">' + TEAM + '</div>' +
      '<div class="match-teamname">' + OPPONENT + '</div>' +
      '<div class="match-event" data-event-headline="Simulated Event"></div>' +
      (live ? '' : '<div data-unix="' + (Date.now() + MINUTES * 60000) + '"></div>') +
    '</div>';
  document.body.appendChild(host);
  return 'injected — now click Scan now';
})();
```

For a *starting soon* alert, `MINUTES` must be inside the lead time in effect
for that team, which the team's own panel shows.

Note the match id is fixed at `999999`, so re-running only alerts once per
status. Change it, or clear the delivery history (below), to fire again.

## Recipe 3 — just check notifications work at all

The popup's **Send a test alert** button pushes a synthetic alert down the real
toast and notification paths and reports per channel what got through. Use it to
separate "the extension is broken" from "the OS is suppressing notifications".

---

## Resetting between runs

From the popup's DevTools console (right-click the popup → Inspect):

```js
// forget which alerts have been delivered
await chrome.storage.local.set({ sentAlerts: {} });

// forget which channels were live last scan
await chrome.storage.local.remove('liveChannels');

// see everything currently stored
console.log(await chrome.storage.sync.get(null), await chrome.storage.local.get(null));
```

Clearing `liveChannels` makes the *next* scan a cold start, which deliberately
alerts for nothing — every live channel would otherwise look newly live. Scan
twice after clearing it.

---

## What this technique will not catch

- **HLTV changing its markup.** Injected nodes are written in the shape the
  adapter expects, so they prove the pipeline works, not that HLTV still emits
  that shape. Fixture tests in `test/fixtures/` guard the shape; only visiting
  the real site catches a change.
- **Timing races between tabs.** Two tabs scanning in the same instant can still
  double-deliver. Stream alerts run through the same delivery history match
  alerts use, which narrows the window and survives a restart, but does not
  close it. A single background scanner (Phase 3) is what actually fixes this.
- **Whether an element is reachable.** A panel can inject, populate correctly,
  and still be 2000px down the page. Check position, not just presence — this
  happened, and "the panel exists" tested true throughout.
