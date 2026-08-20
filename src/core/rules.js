/**
 * Rule resolution.
 *
 * Settings resolve down a chain of three scopes:
 *
 *   global defaults  ->  per-team  ->  per-match
 *
 * A user configures most behaviour once, globally, then adjusts a team they
 * care about more than the rest, then occasionally a single match. Every
 * override field is nullable and null means "inherit from the scope above", so
 * pinning a stream language for one team keeps its lead time following the
 * global setting, and changing the global still moves everything that has not
 * been pinned.
 *
 * Team scope is the one users actually reach for -- they follow a team, not a
 * fixture list -- so it sits between the other two rather than replacing them.
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
   * Resolve the effective config for a match.
   *
   * @param {object} settings global settings
   * @param {object} scopes
   * @param {object} [scopes.team] the followed-team record, if any
   * @param {object} [scopes.match] the per-match override, if any
   * @returns {object} effective config, plus `overrides` mapping each
   *   customised field to the scope that set it, so the UI can show not just
   *   that something is customised but where it came from
   */
  function resolveRule(settings, scopes) {
    const config = Object.assign(HTA.defaultSettings(), settings || {});
    const { team, match } = scopes || {};

    // `enabled` is the only field whose global counterpart is named differently.
    const effective = {
      enabled: config.alertsEnabled,
      leadTimeMinutes: config.leadTimeMinutes,
      openStream: config.openStream,
      streamPlatform: config.streamPlatform,
      streamCountry: config.streamCountry
    };
    const overrides = {};

    // Later scopes win, so apply them in order.
    for (const [scopeName, scope] of [['team', team], ['match', match]]) {
      if (!scope) continue;
      for (const key of OVERRIDABLE) {
        if (isSet(scope[key])) {
          effective[key] = scope[key];
          overrides[key] = scopeName;
        }
      }
    }

    effective.overrides = overrides;
    effective.overriddenFields = Object.keys(overrides);
    effective.hasOverrides = effective.overriddenFields.length > 0;
    return effective;
  }

  /** Back-compat shim for callers that only know about match scope. */
  function resolveMatchRule(settings, matchRules, matchId) {
    const match = (matchRules && matchId && matchRules[matchId]) || null;
    return resolveRule(settings, { match });
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

  HTA.rules = {
    resolveRule,
    resolveMatchRule,
    shouldOpenStream,
    setMatchRule,
    clearMatchRule,
    OVERRIDABLE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
