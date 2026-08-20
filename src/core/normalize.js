/**
 * Text normalization.
 *
 * HLTV renders team names with inconsistent casing, padding and the odd
 * non-breaking space or diacritic. Every comparison in the extension runs
 * through normalizeTeamName() so "Natus  Vincere ", "natus vincere" and
 * "Natus Vincere" collapse to one key.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});

  /** Non-breaking space, zero-width joiner, narrow nbsp. */
  const INVISIBLE_SPACE = /[  ​ ]/g;
  /** Unicode combining marks, left behind by NFD decomposition. */
  const COMBINING_MARKS = /[̀-ͯ]/g;

  /** Collapse whitespace (including nbsp) and trim. */
  function normalizeText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(INVISIBLE_SPACE, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Comparison key for a team name: normalized text, stripped of combining
   * diacritics, lowercased. Display labels keep their original form.
   */
  function normalizeTeamName(value) {
    return normalizeText(value)
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .toLowerCase();
  }

  /** True when both names refer to the same team. */
  function sameTeam(a, b) {
    const keyA = normalizeTeamName(a);
    return keyA !== '' && keyA === normalizeTeamName(b);
  }

  HTA.normalize = { normalizeText, normalizeTeamName, sameTeam };
})(typeof globalThis !== 'undefined' ? globalThis : self);
