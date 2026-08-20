/**
 * Rule resolution.
 *
 * A user configures most behaviour once, globally, then overrides it for the
 * occasional match they care about more (or less) than usual. Every per-match
 * field is nullable and null means "inherit" — so a rule that only pins a
 * stream language keeps following the global lead time, and changing the
 * global lead time still moves that match.
 *
 * Pure: no storage, no DOM. The caller loads settings and rules and passes
 * them in.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;

  /** Fields a per-match rule may override. */
  const OVERRIDABLE = [
    'enabled',
    'leadTimeMinutes',
    'openStream',
    'streamPlatform',
    'streamCountry'
  ];

  function isSet(value) {
    return value !== null && value !== undefined;
  }

  /**
   * Merge a per-match rule over the global settings.
   *
   * @param {object} settings global settings
   * @param {object} matchRules map of matchId -> rule
   * @param {string} matchId
   * @returns {object} effective config, plus `overrides` naming the fields the
   *   match rule actually set (so the UI can show what is customised)
   */
  function resolveMatchRule(settings, matchRules, matchId) {
    const config = Object.assign(HTA.defaultSettings(), settings || {});
    const rule = (matchRules && matchId && matchRules[matchId]) || {};

    // `enabled` is the only field whose global counterpart is named differently.
    const effective = {
      enabled: config.alertsEnabled,
      leadTimeMinutes: config.leadTimeMinutes,
      openStream: config.openStream,
      streamPlatform: config.streamPlatform,
      streamCountry: config.streamCountry
    };
    const overrides = [];

    for (const key of OVERRIDABLE) {
      if (isSet(rule[key])) {
        effective[key] = rule[key];
        overrides.push(key);
      }
    }

    effective.overrides = overrides;
    effective.hasOverrides = overrides.length > 0;
    return effective;
  }

  /**
   * Apply an effective rule to an alert produced by the alert core, deciding
   * whether a stream popup should accompany it.
   *
   * Only live alerts open a stream. Opening a player fifteen minutes before
   * anyone is playing is not what "watch this match" means, and it would sit
   * on a countdown screen burning bandwidth.
   */
  function shouldOpenStream(alert, effective) {
    if (!alert || !effective) return false;
    if (effective.openStream !== true) return false;
    return alert.status === C.STATUS_LIVE;
  }

  /** Write an override, dropping keys set back to inherit. */
  function setMatchRule(matchRules, matchId, patch) {
    const rules = Object.assign({}, matchRules);
    const existing = Object.assign(HTA.defaultMatchRule(), rules[matchId]);
    const updated = Object.assign(existing, patch || {});

    // A rule that overrides nothing is not worth storing, and leaving it behind
    // would make the popup's "customised matches" list fill up with noise.
    const meaningful = Object.entries(updated).some(([, value]) => isSet(value));
    if (meaningful) rules[matchId] = updated;
    else delete rules[matchId];

    return rules;
  }

  function clearMatchRule(matchRules, matchId) {
    const rules = Object.assign({}, matchRules);
    delete rules[matchId];
    return rules;
  }

  HTA.rules = { resolveMatchRule, shouldOpenStream, setMatchRule, clearMatchRule, OVERRIDABLE };
})(typeof globalThis !== 'undefined' ? globalThis : self);
