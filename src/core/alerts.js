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
   * @param {object} input.settings user settings
   * @param {number} input.now epoch ms
   * @param {object} input.sentAlerts dedupeKey -> epoch ms
   * @returns {{alerts: Array, sentAlerts: object, skipped: object}}
   */
  function generateAlerts({ matches, settings, now, sentAlerts }) {
    const history = pruneHistory(sentAlerts, now);
    const skipped = { disabled: 0, noTeams: 0, notAlertable: 0, duplicate: 0 };

    const config = Object.assign(HTA.defaultSettings(), settings || {});

    if (!config.alertsEnabled) {
      skipped.disabled = Array.isArray(matches) ? matches.length : 0;
      return { alerts: [], sentAlerts: history, skipped };
    }

    const teamIndex = buildTeamIndex(config.teams);
    if (teamIndex.size === 0) {
      skipped.noTeams = Array.isArray(matches) ? matches.length : 0;
      return { alerts: [], sentAlerts: history, skipped };
    }

    // Nothing to deliver on: both channels off means no alert should be
    // recorded either, or re-enabling a channel would find the key burned.
    if (!config.pageAlerts && !config.desktopAlerts) {
      skipped.disabled = Array.isArray(matches) ? matches.length : 0;
      return { alerts: [], sentAlerts: history, skipped };
    }

    const alerts = [];
    const nextHistory = Object.assign({}, history);
    const seenThisRun = new Set();

    for (const match of Array.isArray(matches) ? matches : []) {
      const status = classifyMatch(match, now, config.leadTimeMinutes);
      const hits = matchedTeams(match, teamIndex);
      if (hits.length === 0) continue;
      if (!isAlertable(status)) {
        skipped.notAlertable += 1;
        continue;
      }

      for (const teamName of hits) {
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
          status,
          minutesUntil: minutesUntil(match, now),
          channels: {
            page: config.pageAlerts === true,
            desktop: config.desktopAlerts === true
          },
          ...buildMessage(match, teamName, status, now)
        });
      }
    }

    return { alerts, sentAlerts: nextHistory, skipped };
  }

  HTA.alerts = { dedupeKey, generateAlerts, pruneHistory, buildMessage };
})(typeof globalThis !== 'undefined' ? globalThis : self);
