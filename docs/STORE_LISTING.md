# Chrome Web Store listing

Copy for the developer dashboard. Field limits are the store's own.

---

## Name (45 char limit shown in most surfaces)

```
Player & Match Tracker for HLTV
```

31 characters. Deliberately "for HLTV" rather than "HLTV ...": naming the site
the extension works with reads as description, while leading with the mark reads
as a claim to be HLTV's own product. See [Trademark](#trademark-position).

## Short description (132 char limit)

```
Follow Counter-Strike teams and players on HLTV. Get alerted when they play or go live, and pop the stream open.
```

111 characters.

## Category

`Sports` — the extension's single purpose is following esports fixtures and
broadcasts. (Secondary candidate: `Productivity`, but Sports is the honest fit.)

## Detailed description

```
Never miss a Counter-Strike match again.

Follow your teams and players on HLTV, and get told the moment they play or go
live — without keeping the schedule open in your head.

FOLLOW TEAMS
Open any team's HLTV page and press Follow. The extension remembers the team
itself, not just the name, so your settings stay attached even if the name
changes.

FOLLOW PLAYERS
Open a player's profile and press Follow. You get two separate switches:
  • alert me when their team plays
  • alert me when they go live on their own stream
Following a player is enough to cover their team's fixtures — you don't have to
follow the org separately. If they transfer, the extension notices on your next
visit to their profile and stops alerting for the roster they left.

WATCH IMMEDIATELY
Choose to have the stream pop open in its own window the moment a match goes
live. Pick a preferred platform and language; if nobody is broadcasting on your
pick, the biggest available stream opens instead — a preference, not a filter.

SET IT ONCE, OR TUNE IT ANYWHERE
Settings cascade: a global default, overridden per team, overridden per match.
Anything you leave alone keeps following the level above, so pinning one option
for one team doesn't freeze the rest.

ALERTS THAT DON'T REPEAT
Each alert is delivered once per match, team and status — across reloads,
duplicate cards on the page, and browser restarts. Stream alerts fire the moment
a broadcast comes online, not continuously while it stays online.

PRIVATE BY DESIGN
No account, no server, no analytics, no tracking. The extension asks only for
storage and notifications, reads only public HLTV pages you're already viewing,
and keeps everything in your own browser. It contains no remote code.

HOW IT WORKS
Keep an HLTV tab open. The extension checks it every 30 seconds and alerts you
via an on-page toast, a desktop notification, or both. A "Send a test alert"
button lets you confirm notifications work without waiting for a match.

Not affiliated with or endorsed by HLTV.org.
```

## Privacy tab

**Single purpose:**

```
Notify the user when Counter-Strike teams and players they follow on HLTV are
playing a match or streaming, and optionally open the broadcast.
```

**Data collection:** select **"This extension does not collect or use user
data."** Then certify all three statements:

- data is not sold to third parties
- data is not used or transferred for purposes unrelated to the single purpose
- data is not used or transferred to determine creditworthiness or for lending

This is accurate: nothing leaves the browser. Preferences stored in
`chrome.storage.sync` are synced by Chrome itself under the user's own Google
account, which is not collection by the extension.

**Privacy policy URL:** point at the raw `PRIVACY.md` in the repo, or a hosted
copy:

```
https://github.com/realizedgamingtools/HLTVPlayerAndMatchTracker/blob/main/PRIVACY.md
```

### Permission justifications

**`storage`**

```
Stores the teams and players the user follows, their per-team and per-match
alert preferences, and which alerts have already been delivered so the same
alert is never shown twice. All of it stays in the user's browser.
```

**`notifications`**

```
Shows a desktop notification when a followed team or player is live or about to
play. This is the extension's core function and the user chooses whether to
enable it.
```

**Host access to `https://www.hltv.org/*`**

```
The extension reads publicly visible match, team, player and stream information
from HLTV pages the user is already viewing, and adds its Follow controls to
team and player profiles. It runs on no other site, makes no requests of its
own, and sends nothing anywhere.
```

**Remote code:** select **"No, I am not using remote code."** Everything ships
inside the package; there are no external scripts, no `eval`, no CDN.

## Visibility

Start **Unlisted**. It gives a real store install, a permanent extension ID and
automatic updates, without a public listing. Switch to Public from the dashboard
when ready — no resubmission of the package required.

## Assets

| Asset | Requirement | Status |
| --- | --- | --- |
| Store icon | 128×128 PNG | `icons/icon128.png` |
| Screenshots | 1280×800 or 640×400, 1–5, at least one required | `docs/store/` |
| Small promo tile | 440×280, optional | not made |
| Marquee tile | 1400×560, optional | not made |

## Trademark position

The riskiest thing about this listing is the word HLTV, which is not ours.

The name is built as "X for HLTV" rather than "HLTV X" deliberately: naming the
site an extension interoperates with is descriptive use, whereas leading with
another party's mark reads as a claim to be their product and is what the store's
impersonation policy targets. The listing also carries an explicit
non-affiliation line, the extension's own panels name **Realized Tools** as the
maker rather than HLTV, and the icon is our own.

None of that is a licence. HLTV can still object, and if they do the answer is
to rename rather than argue — a takedown for IP reasons is a strike against the
developer account, and repeat strikes end in termination. Renaming is cheap;
losing the account is not.

## Before submitting

- [ ] Register the developer account under the Google account that should own
      this permanently — transferring later is possible but awkward
- [ ] Pay the one-time 5 USD registration fee and verify the contact email
- [ ] Run `node tools/package.js` and upload `dist/*.zip`
- [ ] Paste the copy above; attach screenshots
- [ ] Complete the privacy tab and all three permission justifications
- [ ] Set visibility to Unlisted
- [ ] Submit; review is typically a few days and longer for a new account
