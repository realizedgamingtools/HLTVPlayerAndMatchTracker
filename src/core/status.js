/**
 * Match status classification.
 *
 * Turns a normalized match plus "now" into one of four statuses. Only `live`
 * and `starting-soon` are alertable in v1; `scheduled` and `past` exist so the
 * popup and future dashboard can render a match without re-deriving state.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;

  /**
   * @param {{isLive?: boolean, startTime?: number|null}} match
   * @param {number} now epoch ms
   * @param {number} leadTimeMinutes how far ahead "starting soon" reaches
   * @returns {string} one of C.STATUS_*
   */
  function classifyMatch(match, now, leadTimeMinutes) {
    if (!match || typeof match !== 'object') return C.STATUS_PAST;
    if (match.isLive === true) return C.STATUS_LIVE;

    const startTime = match.startTime;
    if (typeof startTime !== 'number' || !Number.isFinite(startTime)) {
      return C.STATUS_SCHEDULED;
    }

    const msUntil = startTime - now;
    const leadMs = Math.max(0, Number(leadTimeMinutes) || 0) * 60 * 1000;

    // A start time that has passed without a live marker is stale data, not an
    // alert: HLTV leaves delayed matches sitting on the schedule for a while.
    if (msUntil <= 0) return C.STATUS_PAST;
    if (msUntil <= leadMs) return C.STATUS_STARTING_SOON;
    return C.STATUS_SCHEDULED;
  }

  /** Statuses that may produce a notification. */
  function isAlertable(status) {
    return status === C.STATUS_LIVE || status === C.STATUS_STARTING_SOON;
  }

  /** Whole minutes until start, or null when unknown. */
  function minutesUntil(match, now) {
    if (!match || typeof match.startTime !== 'number') return null;
    if (!Number.isFinite(match.startTime)) return null;
    return Math.round((match.startTime - now) / 60000);
  }

  HTA.status = { classifyMatch, isAlertable, minutesUntil };
})(typeof globalThis !== 'undefined' ? globalThis : self);
