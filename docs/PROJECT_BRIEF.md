# Realized HLTV Extension — Project Brief

Product context, current implementation, target architecture, and delivery roadmap.

**Audience:** Engineering, product, design, QA, and project collaborators
**Document status:** Working project brief — shareable draft
**Prototype status:** Version 1.0.0 built and packaged; live browser smoke test pending
**Document owner:** TBD

> **Project posture.** Keep the product local-first and focused on reliable team
> alerts. Refactor around a normalized match model and event engine before
> adding live-score depth or a backend.

---

## 1. Executive summary

Realized HLTV Extension is a Chrome and Edge extension that notifies a user when a
selected Counter-Strike team is live or approaching a scheduled match on HLTV.
The v1.0 prototype proves the core interaction: users add team names in the
extension popup, an HLTV content script scans visible match data, and the
extension delivers on-page and optional desktop notifications while preventing
duplicate alerts.

The immediate product opportunity is to remove friction and increase
reliability: support one-click following, show upcoming matches, allow richer
reminder rules, and monitor in the background without requiring an HLTV tab.
The recommended engineering method is a modular Manifest V3 architecture with
replaceable data adapters, normalized match state, an event-based rules engine,
and channel-specific notification modules.

### Project snapshot

| Project field | Current context |
| --- | --- |
| Product promise | Follow the teams you care about and receive a timely alert when they play. |
| Current release | Prototype v1.0.0, packaged as a dependency-free unpacked Chromium extension. |
| Supported browsers | Chrome 102+ and compatible Chromium-based Edge versions. |
| Current operating mode | Local-only; scans open HLTV pages every 30 seconds. |
| Primary users | Counter-Strike fans who regularly check HLTV and do not want to miss selected teams. |
| Commercial status | TBD; no monetization or distribution model has been selected. |

---

## 2. Product definition

### Problem statement

HLTV contains schedules, live-match information, and match pages, but a fan
still needs to remember when a preferred team plays and revisit the site at the
right time. The extension turns that manual checking behavior into an explicit
follow-and-alert workflow.

### Primary user journey

1. Install the extension and open or reload an HLTV page.
2. Add one or more exact team names and select the desired lead time.
3. Leave an HLTV tab open while the extension scans match cards every 30 seconds.
4. Receive an on-page toast, desktop notification, or both when a followed team qualifies.
5. Open the match directly from the notification.

### Product principles

- **Focused:** optimize for reminders rather than recreating every HLTV feature.
- **Private by default:** avoid transmitting browsing activity or preferences to
  a project server unless a user opts into a network feature.
- **Reliable over clever:** explicit team IDs, deduplication, health indicators,
  and parser tests matter more than decorative features.
- **Source-aware:** isolate third-party extraction, rate-limit requests, and
  prefer an authorized structured source when available.
- **Progressive:** every milestone should leave the extension usable and releasable.

### Current non-goals

The initial product is not a betting or prediction tool, a complete HLTV
replacement, a mobile application, or a guaranteed real-time scoring service.
Phone push, cross-device history, and browser-closed monitoring require
additional data and delivery infrastructure.

---

## 3. Current implementation

The shipped prototype is a Manifest V3 extension written in plain HTML, CSS, and
JavaScript. There is no build step or third-party runtime dependency. Settings
are stored with the browser extension storage API, the content script performs
match detection, and the service worker owns system notifications.

### Capabilities and boundaries

| Area | Shipped in v1.0 | Current boundary |
| --- | --- | --- |
| Following | Manual entry of exact team names; case-insensitive matching. | No team autocomplete, team IDs, or one-click follow button yet. |
| Match detection | Parses match links, teams, live state, and timestamps from open HLTV pages. | Depends on page markup and an open HLTV tab. |
| Alerts | On-page toast and optional desktop notification; configurable lead time. | No map, score, overtime, result, or stream events yet. |
| Deduplication | One alert per match/team/status, retained for seven days. | History is operational state rather than a user-facing activity feed. |
| Privacy | No project server; settings use browser extension storage. | Cross-device and phone delivery would require additional infrastructure. |
| Quality | Six automated core tests pass; manifest references validated. | A live unpacked-extension browser smoke test remains pending. |

### Current component map

- **Popup UI.** Adds/removes teams, enables alerts, sets lead time, chooses
  page/desktop channels, and triggers a manual scan.
- **Content parser.** Finds match links, extracts team labels and timestamps,
  detects live state, and normalizes text.
- **Alert core.** Matches selected teams exactly, classifies live/starting
  matches, and creates deduplication keys.
- **Page notifier.** Injects an accessible toast stack into HLTV pages.
- **Service worker.** Creates desktop notifications and opens the relevant match
  after a click.
- **Storage.** Uses sync storage for preferences, local storage for sent-alert
  state, and session storage for notification click targets.

### Current data flow

> **V1 flow.** Open HLTV page → content parser → normalized match candidates →
> team/rule matching → deduplication check → on-page and/or desktop notification
> → stored delivery state.

### Verified quality status

- Six automated tests cover normalization, exact matching, status
  classification, alert generation, disabled/empty states, and representative
  live-card parsing.
- JavaScript syntax and manifest JSON were validated, including every referenced
  project file.
- The packaged ZIP was checked for its extension root and manifest.
- A real browser installation and live HLTV smoke test could not be completed in
  the build environment and remains an explicit release gate.

---

## 4. Target architecture

Before expanding functionality, separate data acquisition from product logic.
Every source should produce the same normalized team, event, match, score, and
stream objects. The rest of the extension should operate only on those objects.

> **Target flow.** HLTV or authorized provider → source adapter/parser →
> normalized match repository → state transition detector → user rules engine →
> notification router → desktop, on-page, calendar, or optional remote channels.

### Core architectural decisions

- **Use stable IDs:** Persist HLTV team, match, and event IDs where available;
  names remain display labels and search aliases.
- **Make storage authoritative:** Manifest V3 service workers are short-lived,
  so preferences, snapshots, schedules, and delivery history cannot depend on
  global variables.
- **Model match transitions:** Compare consecutive snapshots and emit events
  such as starting-soon, live, map-started, map-finished, overtime, and
  series-finished.
- **Separate rules from channels:** A rule decides whether an event matters; a
  channel decides how it is delivered. This avoids duplicating logic for
  desktop, page, calendar, or remote alerts.
- **Keep the source replaceable:** All HLTV selectors and extraction behavior
  belong in one adapter with versioned fixtures and health checks.

### Background monitoring option

A local-first v2 can use `chrome.alarms` to wake the service worker, fetch
schedule data with declared host permission, and pass returned HTML to an
offscreen document for DOM parsing. This removes the open-tab requirement but
raises the minimum Chrome version to 109 and requires careful source-policy,
caching, and rate-limit decisions. Important alarms should be verified and
recreated when the service worker starts.

---

## 5. Delivery roadmap

The following sequence is designed to reduce technical risk while producing
visible user value in every milestone. Scope should advance only after the
preceding milestone meets its release criteria.

### Phase 1 — Foundation and one-click following

*Outcome: Replace name-only configuration with a stable team model and reduce
setup friction.*

- Refactor parser, match repository, rule engine, and delivery channels into separate modules.
- Inject a follow bell beside team links and team profiles.
- Store team ID, canonical name, slug, and aliases; migrate existing name-only preferences.
- Add parser fixtures and an extension health/status panel.

### Phase 2 — Upcoming-match dashboard

*Outcome: Give users a useful schedule view even when no alert is firing.*

- Show followed-team matches grouped into today, tomorrow, and later.
- Display opponent, event, match format, start time, status, and direct match link.
- Add team search/autocomplete, empty states, last-updated time, and manual refresh.

### Phase 3 — Reliable scheduling and background checks

*Outcome: Deliver reminders without requiring an HLTV tab to stay open.*

- Add `chrome.alarms` scheduling and an offscreen DOM parser or bundled parser.
- Implement snapshot caching, backoff, parse-health validation, and alarm recreation.
- Support multiple lead times, quiet hours, timezone handling, and missed-alarm recovery.

### Phase 4 — Live match event engine

*Outcome: Turn raw match changes into configurable, deduplicated events.*

- Add map started/finished, overtime, score change, and series result events where the data supports them.
- Provide spoiler-free mode and a user-visible notification history.
- Add direct watch links and preferred stream language where available.

### Phase 5 — Advanced personalization

*Outcome: Allow different fans to define what counts as important.*

- Follow events and players in addition to teams.
- Filter by LAN/online, playoffs, ranking, opponent, and best-of format.
- Add calendar export, toolbar live count, and optional side-panel match center.

### Phase 6 — Optional backend and cross-device delivery

*Outcome: Support browser-closed monitoring, phones, and remote channels only
after local reliability is proven.*

- Centralize source polling instead of having every installation fetch independently.
- Add authenticated subscriptions and push delivery for email, Discord, Telegram, or mobile.
- Define retention, security, abuse controls, operational monitoring, and cost limits before launch.

---

## 6. Functional requirements

### Priority 0 — reliable core

- Follow and unfollow a stable team identity from HLTV pages and the extension UI.
- Show upcoming matches for followed teams with local time and source link.
- Deliver selected reminder events once, despite reloads, duplicate cards, or service-worker restarts.
- Expose last successful sync, parse status, and notification permission/health information.
- Recover safely when a source request or parse fails; never replace known-good data with an unexplained empty state.

### Priority 1 — control and depth

- Multiple lead-time reminders, quiet hours, and per-team settings.
- Live, map, overtime, final-result, and spoiler-free events.
- Stream links, calendar export, history, and event/player following.
- Filters for event stage, ranking, format, LAN/online, and opponent.

### Priority 2 — network services

- Phone or browser push when the local browser is closed.
- Cross-device preference sync beyond browser-native settings sync.
- Remote channels such as email, Discord, and Telegram.
- Shared monitoring, operational analytics, and account management.

### Suggested normalized entities

| Entity | Core fields |
| --- | --- |
| Team | `id`, `canonicalName`, `slug`, `logoUrl`, `aliases`, `followedAt` |
| Event | `id`, `name`, `stage`, `region`, `lanOnline`, `startDate`, `endDate` |
| Match | `id`, `team1Id`, `team2Id`, `eventId`, `format`, `startTime`, `status`, `sourceUrl` |
| Match snapshot | `matchId`, `capturedAt`, `status`, `maps`, `score`, `streams`, `sourceVersion` |
| Alert rule | `scopeId`, `eventTypes`, `leadTimes`, `filters`, `quietHours`, `enabledChannels` |
| Delivery | `dedupeKey`, `channel`, `attemptedAt`, `result`, `openedAt`, `expiresAt` |

---

## 7. Engineering quality and release method

### Testing pyramid

- **Unit tests:** Normalization, time calculations, stable-ID matching, state transitions, filters, quiet hours, and deduplication.
- **Parser fixtures:** Representative scheduled, live, delayed, completed, filtered, and malformed page fragments.
- **Integration tests:** Alarm/fetch → parse → repository → event engine → rule engine → delivery state.
- **Browser tests:** Load the unpacked extension, follow a team, simulate transitions, verify popup/toast/desktop behavior, and click through.
- **Release checks:** Manifest validation, permission review, migrations, packaged-file audit, privacy copy, and clean install/upgrade tests.

### Definition of done for a feature

- The behavior is represented by a documented user story and acceptance criteria.
- Core logic has unit coverage; source-dependent behavior has a saved fixture.
- Failure, empty, loading, disabled, and permission-denied states are handled.
- Settings persist across service-worker restarts and extension updates where appropriate.
- Accessibility, privacy, least-privilege permissions, and notification deduplication are reviewed.
- The unpacked extension passes Chrome/Edge smoke testing and the release package is audited.

### Privacy and security baseline

- Request only permissions tied to visible product behavior and explain each one in release documentation.
- Keep executable code inside the extension package; do not load remote scripts.
- Store preferences and delivery state locally unless a user explicitly enables a network service.
- Never store HLTV authentication cookies, browser history, or unrelated page content.
- If a backend is introduced, define encryption, authentication, deletion, retention, abuse prevention, and incident response before collecting user data.

---

## 8. Risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| HLTV markup changes | Selectors can stop finding teams, times, or status. | Keep one adapter, use stable IDs/links first, retain fixtures, and fail visibly on empty parses. |
| Source access and policy | Aggressive polling or unsupported access can create reliability and compliance issues. | Prefer authorized structured data; rate-limit, cache, back off, and review applicable terms before background polling. |
| Service-worker lifecycle | Global variables and timers disappear when the worker sleeps. | Treat storage as source of truth and use `chrome.alarms` for scheduled work. |
| Notification variability | OS and browser settings can suppress or delay alerts. | Expose a health check, last-sync timestamp, and on-page fallback. |
| Scope growth | A full match center can overwhelm a focused reminder product. | Ship milestone acceptance criteria and validate demand before backend or mobile work. |

---

## 9. Decisions the team must make

- **Data strategy:** continue HTML parsing, adopt an authorized provider, or operate a controlled project backend?
- **Product boundary:** remain a focused reminder extension or expand toward a full match center?
- **Background mode:** accept Chrome 109+ and offscreen parsing for tab-independent monitoring?
- **Codebase:** keep dependency-free JavaScript or migrate to TypeScript and a bundled UI framework as the dashboard grows?
- **Distribution:** internal/unpacked use, public Chrome Web Store release, or both?
- **Success metrics:** which measures determine progress — followed teams, weekly active users, alert delivery rate, match-page opens, or retention?
- **Backend trigger:** what validated demand justifies accounts, remote delivery, and ongoing infrastructure cost?

> **Recommended next decision.** Approve Phase 1 scope and decide whether Phase 3
> background monitoring may rely on HLTV HTML. That choice determines the parser
> contract, minimum browser version, and whether a backend investigation should
> begin.

---

## 10. Collaboration handoff

### Suggested first working session

1. Install and smoke-test the packaged v1.0 extension against current HLTV match pages.
2. Review the product principles, non-goals, and six roadmap phases in this brief.
3. Assign owners for product, source/data, extension architecture, interface design, and QA.
4. Resolve the data strategy and background-monitoring decisions.
5. Create the Phase 1 backlog with acceptance criteria and fixtures before implementation begins.

### Handoff checklist

- [ ] Repository URL and branching/review conventions recorded — TBD.
- [ ] Product owner, technical owner, design owner, and QA owner assigned — TBD.
- [ ] Current ZIP and source folder shared with collaborators.
- [ ] Live Chrome and Edge smoke-test results recorded.
- [ ] HLTV access/policy assumptions reviewed and documented.
- [ ] Phase 1 scope, success criteria, and release target approved.

### Reference links

- [HLTV matches](https://www.hltv.org/matches)
- [Chrome extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome Notifications API](https://developer.chrome.com/docs/extensions/reference/api/notifications)

---

## Implementation notes against this brief

Recorded during the v1.0 build, where the code and the brief diverged:

- **Stable IDs arrived early.** The brief scheduled HLTV team/match/event IDs for
  Phase 1. Current HLTV markup exposes them as attributes on the match card, so
  `src/core/parser.js` already emits `data-match-id`, `data-event-id` and both
  team IDs. The follow list still keys on names, so the Phase 1 work is now a
  migration onto IDs the adapter is already capturing, not a discovery exercise.
- **Two source layouts, not one.** HLTV renders `/matches` and the front page
  with different markup and different live flags (`live` vs `filteraslive`). The
  adapter handles both behind one interface.
- **A stale selector was actively dangerous.** `.matchLive` still exists on HLTV
  but now denotes a star rating on *scheduled* matches. This is the concrete form
  of the "HLTV markup changes" risk in section 8: the mitigation has to be a
  fixture and a health signal, because a selector that still resolves gives no
  error to catch.
- **The live path is still unobserved.** No match was live during the build, so
  live rendering is derived from the attribute contract. It is the top item on
  the smoke-test gate in the README.

*Disclaimer: This is an independent project concept and is not affiliated with
or endorsed by HLTV.org.*
