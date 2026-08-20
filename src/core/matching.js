/**
 * Followed-team matching.
 *
 * v1 follows teams by exact name (case- and diacritic-insensitive). Substring
 * matching is deliberately not used: "Liquid" would otherwise fire on "Team
 * Liquid Academy", and "NAVI" on "NAVI Junior". Phase 1 replaces this with
 * stable HLTV team IDs; the interface here is what that swap has to preserve.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const { normalizeTeamName } = HTA.normalize;

  /** Build a lookup Set of comparison keys from the user's followed list. */
  function buildTeamIndex(followedTeams) {
    const index = new Set();
    if (!Array.isArray(followedTeams)) return index;
    for (const team of followedTeams) {
      const key = normalizeTeamName(typeof team === 'string' ? team : team && team.name);
      if (key) index.add(key);
    }
    return index;
  }

  /**
   * Which of a match's two teams the user follows.
   * @returns {string[]} display labels, in the order they appear on the card
   */
  function matchedTeams(match, teamIndex) {
    if (!match || !teamIndex || teamIndex.size === 0) return [];
    const candidates = [match.team1, match.team2].filter(
      (name) => typeof name === 'string' && name.trim() !== ''
    );
    const hits = [];
    for (const name of candidates) {
      if (teamIndex.has(normalizeTeamName(name))) hits.push(name);
    }
    return hits;
  }

  HTA.matching = { buildTeamIndex, matchedTeams };
})(typeof globalThis !== 'undefined' ? globalThis : self);
