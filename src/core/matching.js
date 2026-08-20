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

  /** Add a team to the followed list, rejecting blanks and duplicates. */
  function addTeam(followedTeams, rawName) {
    const list = Array.isArray(followedTeams) ? followedTeams.slice() : [];
    const display = HTA.normalize.normalizeText(rawName);
    if (!display) return { teams: list, added: false, reason: 'empty' };
    const key = normalizeTeamName(display);
    if (list.some((existing) => normalizeTeamName(existing) === key)) {
      return { teams: list, added: false, reason: 'duplicate' };
    }
    list.push(display);
    list.sort((a, b) => normalizeTeamName(a).localeCompare(normalizeTeamName(b)));
    return { teams: list, added: true, reason: null };
  }

  /** Remove a team by name. */
  function removeTeam(followedTeams, rawName) {
    const key = normalizeTeamName(rawName);
    const list = Array.isArray(followedTeams) ? followedTeams : [];
    return list.filter((existing) => normalizeTeamName(existing) !== key);
  }

  HTA.matching = { buildTeamIndex, matchedTeams, addTeam, removeTeam };
})(typeof globalThis !== 'undefined' ? globalThis : self);
