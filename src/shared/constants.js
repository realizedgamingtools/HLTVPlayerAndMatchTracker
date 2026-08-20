/**
 * Shared constants for Realized HLTV Extension.
 *
 * Loaded as a classic script in the content script world, imported via
 * importScripts() in the service worker, and executed directly by the Node
 * test runner. Everything hangs off a single global namespace so the same
 * file works in all three environments with no build step.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});

  HTA.constants = {
    /** Bumped whenever the HLTV adapter's selectors change. */
    SOURCE_VERSION: 'hltv-2026-08',

    /** How often the content script rescans an open HLTV page. */
    SCAN_INTERVAL_MS: 30 * 1000,

    /** Delivery history older than this is pruned on write. */
    ALERT_HISTORY_TTL_MS: 7 * 24 * 60 * 60 * 1000,

    /**
     * Lead times offered in the UI, in minutes.
     * 0 means "only once it is actually live": with a zero lead window nothing
     * is ever classified starting-soon, so only the live alert fires.
     */
    LEAD_TIME_CHOICES: [0, 5, 10, 15, 30, 60],

    /** Sentinel for "no preference" in stream selection. */
    ANY: 'any',

    /** Stream platforms, in tie-break priority order. */
    STREAM_PLATFORMS: ['twitch', 'youtube', 'kick', 'hltv'],

    /**
     * Display names. Capitalising the id gives "Youtube" and "Hltv", which
     * look like typos, so the labels are spelled out rather than derived.
     */
    PLATFORM_LABELS: {
      twitch: 'Twitch',
      youtube: 'YouTube',
      kick: 'Kick',
      hltv: 'HLTV Live'
    },

    /** Size of the stream popup window. */
    STREAM_POPUP_WIDTH: 1000,
    STREAM_POPUP_HEIGHT: 620,

    /** Storage keys. Preferences sync, delivery state stays local. */
    SYNC_KEY_SETTINGS: 'settings',
    SYNC_KEY_FOLLOWED_TEAMS: 'followedTeams',
    SYNC_KEY_FOLLOWED_PLAYERS: 'followedPlayers',
    SYNC_KEY_MATCH_RULES: 'matchRules',
    LOCAL_KEY_SENT_ALERTS: 'sentAlerts',
    LOCAL_KEY_LAST_SCAN: 'lastScan',
    LOCAL_KEY_STREAM_SNAPSHOTS: 'streamSnapshots',
    LOCAL_KEY_LIVE_CHANNELS: 'liveChannels',
    SESSION_KEY_NOTIFICATION_TARGETS: 'notificationTargets',

    /** Alert statuses emitted by the alert core. */
    STATUS_LIVE: 'live',
    STATUS_STARTING_SOON: 'starting-soon',
    STATUS_SCHEDULED: 'scheduled',
    STATUS_PAST: 'past',

    /** A followed player's own channel coming online. */
    STATUS_STREAM_LIVE: 'stream-live',

    /** Runtime message types. */
    MSG_DESKTOP_NOTIFY: 'hta:desktop-notify',
    MSG_MANUAL_SCAN: 'hta:manual-scan',
    MSG_SCAN_RESULT: 'hta:scan-result',
    MSG_OPEN_STREAM: 'hta:open-stream',
    MSG_TEST_ALERT: 'hta:test-alert',
    MSG_TEAMS_CHANGED: 'hta:teams-changed'
  };

  HTA.defaultSettings = function defaultSettings() {
    return {
      teams: [],
      alertsEnabled: true,
      leadTimeMinutes: 15,
      pageAlerts: true,
      desktopAlerts: true,
      // Stream popup defaults. Per-match rules override these; see core/rules.js.
      openStream: false,
      streamPlatform: 'any',
      streamCountry: 'any'
    };
  };

  /**
   * Overridable alert fields. Null means "inherit from the scope above".
   *
   * The same shape is used at team and match scope, which is what makes the
   * global -> team -> match chain in core/rules.js uniform.
   */
  function emptyOverride() {
    return {
      enabled: null,
      leadTimeMinutes: null,
      openStream: null,
      streamPlatform: null,
      streamCountry: null
    };
  }

  HTA.defaultMatchRule = emptyOverride;
  HTA.defaultTeamRule = emptyOverride;

  /**
   * A followed player.
   *
   * `alertOnMatch` and `alertOnStream` are separate interests, not one switch:
   * wanting to know when someone streams is not the same as wanting every
   * fixture their team plays. Both start on -- following a player is itself
   * the opt-in -- and either can be switched off from their profile.
   */
  HTA.defaultFollowedPlayer = function defaultFollowedPlayer(fields) {
    return Object.assign(
      {
        id: null,
        nickname: '',
        realname: null,
        slug: null,
        teamId: null,
        teamName: null,
        channels: [],
        followedAt: null,
        alertOnMatch: true,
        alertOnStream: true,
        openStreamOnLive: null
      },
      emptyOverride(),
      fields || {}
    );
  };

  /**
   * A followed team.
   *
   * Identity is the HLTV team id when we have it -- which we do whenever the
   * user followed from a team page. Teams added by name from the popup have no
   * id until the user visits their profile, so they are keyed by normalized
   * name and upgraded in place later. `name` stays the display label and the
   * thing match cards are matched against.
   */
  HTA.defaultFollowedTeam = function defaultFollowedTeam(fields) {
    return Object.assign(
      {
        id: null,
        name: '',
        slug: null,
        followedAt: null
      },
      emptyOverride(),
      fields || {}
    );
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
