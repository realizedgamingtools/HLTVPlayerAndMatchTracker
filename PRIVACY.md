# Privacy Policy

**Player & Match Tracker for HLTV**
Last updated: 20 August 2026

## Summary

This extension does not collect, transmit, or sell any data. There is no server,
no analytics, and no account. Everything it stores stays in your own browser.

## What is stored, and where

All storage uses the browser's own extension storage API.

| What | Where | Why |
| --- | --- | --- |
| Teams and players you follow, and their alert settings | `chrome.storage.sync` | So your follows work across browsers you are signed into, using Chrome's own sync |
| Global preferences (lead time, alert channels, stream platform and language) | `chrome.storage.sync` | Same |
| Which alerts have already been delivered | `chrome.storage.local` | To avoid alerting you twice for the same match |
| Which stream channels were live on the previous check | `chrome.storage.local` | To detect the moment a stream comes online rather than re-alerting while it stays online |
| Stream lists captured from match pages you visit | `chrome.storage.local` | So an alert can open the broadcast you asked for |
| Last scan result (time, counts, whether parsing succeeded) | `chrome.storage.local` | To show extension health in the popup |

Data written to `chrome.storage.sync` is synchronised by Chrome under your own
Google account, subject to Google's privacy policy. The extension does not send
it anywhere else.

Delivery history and stream snapshots are pruned after seven days.

## What is never stored

- Your browsing history
- Page content from any site other than the public HLTV pages described below
- HLTV account details, cookies, or session tokens
- Any personally identifying information

## What the extension reads

The extension runs only on `https://www.hltv.org/*`. On those pages it reads
publicly visible information already rendered in your browser:

- match cards: team names, start times, event names, live status
- match pages: the listed streams, their platform, language and viewer counts
- team pages: the team's name, id and upcoming fixtures
- player pages: the player's nickname, real name, id, current team, and the
  public broadcast links on their profile
- the live-streams sidebar present on every HLTV page

This information is used to decide whether to alert you, and is not sent
anywhere.

## Network requests

The extension makes no network requests of its own. It reads pages you have
already opened.

When an alert opens a stream, your browser navigates to that stream's own site
(Twitch, Kick, YouTube, or HLTV). Those sites are governed by their own privacy
policies and are not operated by this extension.

## Permissions

- **`storage`** — to save the preferences and state described above.
- **`notifications`** — to show a desktop notification when a followed team or
  player is live or about to play.
- **Access to `https://www.hltv.org/*`** — to read match and stream information
  from HLTV pages you visit, and to show the extension's controls on them.

No other permissions are requested. The extension contains no remote code.

## Your control

Removing a followed team or player deletes its record. Uninstalling the
extension removes all of its stored data from your browser.

## Contact

realizedextensions@gmail.com

## Affiliation

This is an independent project. It is not affiliated with, endorsed by, or
sponsored by HLTV.org, Valve Corporation, Twitch, Kick, or YouTube. "HLTV" is
used only to describe the site the extension works with.
