# Changelog

Notable changes to Player & Match Tracker for HLTV are recorded here. Releases
from 1.2.2 onward are maintained by Release Please from Conventional Commit
messages. Earlier entries were reconstructed from the repository history.

## [1.2.2] - 2026-08-24

### Changed

- Centered the television and crosshair artwork by measuring and equalizing its
  vertical margins at every generated icon size.

## [1.2.1] - 2026-08-24

### Changed

- Replaced the extension icon with a television-and-crosshair design that
  remains legible from 16px through 128px.
- Refined the icon with a classic green Counter-Strike crosshair, full-screen
  span, television proportions, and rabbit-ear antennae.
- Kept the Realized Tools artwork as the maker mark used by injected panels.

## [1.2.0] - 2026-08-20

### Added

- Added player following from HLTV profiles, including separate controls for
  team-match alerts and personal-stream alerts.
- Added player profile panels and a followed-player section in the popup.
- Added personal-stream detection using HLTV's live-stream sidebar.
- Added Realized Tools branding, store listing assets, a privacy policy, CI,
  and uploadable extension artifacts for green builds.

### Fixed

- Corrected inherited-setting counts in the popup.
- Restored loading and rendering of followed players during popup startup.
- Deduplicated stream alerts using delivery history.
- Anchored player panels beneath the HLTV header card.

### Changed

- Renamed the product to Player & Match Tracker for HLTV for store listing and
  trademark clarity.

## [1.1.0] - 2026-08-20

### Added

- Added automatic stream selection and popup playback for live matches.
- Added per-match and per-team alert, lead-time, platform, and language rules.
- Added a test-alert action and match-page stream previews.
- Added team following directly from HLTV team profiles.

### Changed

- Made teams, rather than individual matches, the primary unit of following.
- Added global-to-team-to-match settings inheritance and migration from the
  original settings format.
- Introduced the Realized Tools name and visual identity.

## [1.0.0] - 2026-08-19

### Added

- Added the Manifest V3 Chrome and Edge extension, popup, service worker, and
  content-script integration.
- Added HLTV match parsing, team matching, match-status classification, alert
  deduplication, on-page toasts, and desktop notifications.
- Added stream extraction and preference-based selection.
- Added validation, tests, icon generation, packaging, documentation, and the
  initial project brief.

[1.2.2]: https://github.com/realizedgamingtools/HLTVPlayerAndMatchTracker/commits/0c6ed4540cc482271fdecf9ff13991e5344ce8aa
[1.2.1]: https://github.com/realizedgamingtools/HLTVPlayerAndMatchTracker/commits/02a6717d2199e3450823af2d0d7d3d892c6fb4f1
[1.2.0]: https://github.com/realizedgamingtools/HLTVPlayerAndMatchTracker/commits/26e2feb82bc1a2d5f14c37ba7b785cf4181abaac
[1.1.0]: https://github.com/realizedgamingtools/HLTVPlayerAndMatchTracker/commits/be2333ad4a0f7a7493c4f0f9ac9e620dff663a2f
[1.0.0]: https://github.com/realizedgamingtools/HLTVPlayerAndMatchTracker/commits/295b1c3935adf5ecff9e735e49c8829625bd48af
