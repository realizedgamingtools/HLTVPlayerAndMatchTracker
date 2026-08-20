/**
 * Alert core.
 *
 * Pure logic: given parsed matches, user settings, the current time and the
 * delivery history, decide which alerts to fire. No DOM, no chrome.* calls —
 * that keeps this testable in Node and reusable by the Phase 3 background
 * scheduler when scanning stops depending on an open tab.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;
  const { normalizeTeamName } = HTA.normalize;
  const { classifyMatch, isAlertable, minutesUntil } = HTA.status;
  const { buildTeamIndex, matchedTeams } = HTA.matching;

  /**
   * Stable identity for one delivered alert.
   *
   * Keyed on match + team + status so a match that goes from starting-soon to
   * live alerts twice (intended), but a page that renders the same card in two
   * places, or a reload, or a service-worker restart, alerts once.
   */
  function dedupeKey(match, teamName, status) {
    const matchId = (match && match.id) || (match && match.url) || 'unknown';
    return [matchId, normalizeTeamName(teamName), status].join('|');
  }

  /** Human-readable alert copy. */
  function buildMessage(match, teamName, status, now) {
    const opponent = HTA.normalize.sameTeam(match.team1, teamName)
      ? match.team2
      : match.team1;
    const vs = opponent ? ` vs ${opponent}` : '';
    const event = match.event ? ` — ${match.event}` : '';

    if (status === C.STATUS_LIVE) {
      return { title: `${teamName} is LIVE`, body: `${teamName}${vs}${event}` };
    }
    const mins = minutesUntil(match, now);
    const when = mins === null ? 'soon' : mins <= 1 ? 'in under a minute' : `in ${mins} min`;
    return {
      title: `${teamName} plays ${when}`,
      body: `${teamName}${vs}${event}`
    };
  }

  /** Drop delivery records past the retention window. */
  function pruneHistory(sentAlerts, now) {
    const pruned = {};
    if (!sentAlerts || typeof sentAlerts !== 'object') return pruned;
    for (const [key, sentAt] of Object.entries(sentAlerts)) {
      if (typeof sentAt === 'number' && now - sentAt < C.ALERT_HISTORY_TTL_MS) {
        pruned[key] = sentAt;
      }
    }
    return pruned;
  }

  /**
   * @param {object} input
   * @param {Array} input.matches parsed match candidates
   * @param {object} input.settings global user settings
   * @param {object} input.followedTeams followed-team records, keyed
   * @param {object} input.matchRules per-match overrides, keyed by match id
   * @param {number} input.now epoch ms
   * @param {object} input.sentAlerts dedupeKey -> epoch ms
   * @returns {{alerts: Array, sentAlerts: object, skipped: object}}
   */
  function generateAlerts({ matches, settings, followedTeams, matchRules, now, sentAlerts }) {
    const history = pruneHistory(sentAlerts, now);
    const skipped = { disabled: 0, muted: 0, noTeams: 0, notAlertable: 0, duplicate: 0 };

    const config = Object.assign(HTA.defaultSettings(), settings || {});

    if (!config.alertsEnabled) {
      skipped.disabled = Array.isArray(matches) ? matches.length : 0;
      return { alerts: [], sentAlerts: history, skipped };
    }

    // Team records are the source of truth; settings.teams is the v1 shape and
    // is only consulted when nothing has been migrated yet.
    const teams = followedTeams && Object.keys(followedTeams).length > 0 ? followedTeams : null;
    const names = teams ? HTA.teams.teamNames(teams) : config.teams;

    const teamIndex = buildTeamIndex(names);
    if (teamIndex.size === 0) {
      skipped.noTeams = Array.isArray(matches) ? matches.length : 0;
      return { alerts: [], sentAlerts: history, skipped };
    }

    const alerts = [];
    const nextHistory = Object.assign({}, history);
    const seenThisRun = new Set();

    for (const match of Array.isArray(matches) ? matches : []) {
      const hits = matchedTeams(match, teamIndex);
      if (hits.length === 0) continue;

      const matchRule = (matchRules && match && match.id && matchRules[match.id]) || null;

      for (const teamName of hits) {
        // Resolution happens per matched team, not per match: two followed
        // teams playing each other can want different lead times, and a
        // per-team lead time changes what counts as starting-soon for that
        // team alone.
        const teamRecord = teams ? HTA.teams.teamByName(teams, teamName) : null;
        const effective = HTA.rules.resolveRule(config, { team: teamRecord, match: matchRule });

        // Global alertsEnabled short-circuited above, so reaching here with
        // enabled false means this team or match was muted individually.
        if (!effective.enabled) {
          skipped.muted += 1;
          continue;
        }

        const status = classifyMatch(match, now, effective.leadTimeMinutes);
        if (!isAlertable(status)) {
          skipped.notAlertable += 1;
          continue;
        }

        // Opening a stream counts as delivery, so it keeps an alert alive even
        // with both notification channels off. With nothing to deliver on, the
        // alert is not recorded either -- otherwise re-enabling a channel would
        // find the dedupe key already burned.
        const channels = {
          page: config.pageAlerts === true,
          desktop: config.desktopAlerts === true,
          stream: HTA.rules.shouldOpenStream({ status }, effective)
        };
        if (!channels.page && !channels.desktop && !channels.stream) {
          skipped.disabled += 1;
          continue;
        }

        const key = dedupeKey(match, teamName, status);
        if (key in nextHistory || seenThisRun.has(key)) {
          skipped.duplicate += 1;
          continue;
        }
        seenThisRun.add(key);
        nextHistory[key] = now;
        alerts.push({
          key,
          match,
          team: teamName,
          teamId: teamRecord ? teamRecord.id : null,
          status,
          minutesUntil: minutesUntil(match, now),
          channels,
          effective,
          ...buildMessage(match, teamName, status, now)
        });
      }
    }

    return { alerts, sentAlerts: nextHistory, skipped };
  }

  HTA.alerts = { dedupeKey, generateAlerts, pruneHistory, buildMessage };
})(typeof globalThis !== 'undefined' ? globalThis : self);
