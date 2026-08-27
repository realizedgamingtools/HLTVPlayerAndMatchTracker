/**
 * Followed teams.
 *
 * A followed team is a record, not a bare string. Following from a team page
 * captures HLTV's stable team id, the canonical name and the slug; following
 * by name from the popup captures only the name, and the record is upgraded in
 * place the first time the user visits that team's profile.
 *
 * Matching still happens on names, because match cards carry names and not ids.
 * The id is what gives a team a durable identity across renames and what lets
 * per-team settings survive the user retyping a name differently.
 *
 * Pure: no storage, no DOM.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const { normalizeTeamName, normalizeText } = HTA.normalize;

  /**
   * Storage key for a team.
   *
   * Ids are preferred and namespaced so a team id can never collide with a
   * name-derived key.
   */
  function teamKey(team) {
    if (!team) return null;
    if (team.id !== null && team.id !== undefined && String(team.id) !== '') {
      return `id:${team.id}`;
    }
    const normalized = normalizeTeamName(team.name);
    return normalized ? `name:${normalized}` : null;
  }

  /** Find an existing record for a team, by id first and then by name. */
  function findTeam(followedTeams, team) {
    const teams = followedTeams || {};
    const key = teamKey(team);
    if (key && teams[key]) return { key, team: teams[key] };

    // A team followed by name from the popup has no id yet, so a later follow
    // from its profile page must find and upgrade it rather than duplicate it.
    const normalized = normalizeTeamName(team && team.name);
    if (!normalized) return null;
    for (const [existingKey, existing] of Object.entries(teams)) {
      if (normalizeTeamName(existing.name) === normalized) {
        return { key: existingKey, team: existing };
      }
    }
    return null;
  }

  function isFollowed(followedTeams, team) {
    return findTeam(followedTeams, team) !== null;
  }

  /**
   * Follow a team, or upgrade an existing record with newly learned identity.
   *
   * Upgrading matters: a user who typed "Vitality" into the popup and later
   * opens Vitality's profile should end up with one record carrying the id and
   * their existing settings, not two records competing.
   */
  function followTeam(followedTeams, fields, now) {
    const teams = Object.assign({}, followedTeams);
    const existing = findTeam(teams, fields);

    if (existing) {
      const merged = Object.assign({}, existing.team, {
        // Never let a name-only follow blank out identity we already have.
        id: fields.id !== null && fields.id !== undefined ? String(fields.id) : existing.team.id,
        // Display name is normalized on the way in, so padding typed into the
        // popup never reaches the UI. Matching already ignores it either way.
        name: normalizeText(fields.name) || existing.team.name,
        slug: fields.slug || existing.team.slug,
        followedAt: existing.team.followedAt || now
      });
      const newKey = teamKey(merged);
      if (newKey !== existing.key) delete teams[existing.key];
      teams[newKey] = merged;
      return teams;
    }

    const record = HTA.defaultFollowedTeam({
      id: fields.id !== null && fields.id !== undefined ? String(fields.id) : null,
      name: normalizeText(fields.name),
      slug: fields.slug || null,
      followedAt: now
    });
    const key = teamKey(record);
    if (!key) return teams;
    teams[key] = record;
    return teams;
  }

  function unfollowTeam(followedTeams, team) {
    const teams = Object.assign({}, followedTeams);
    const existing = findTeam(teams, team);
    if (existing) delete teams[existing.key];
    return teams;
  }

  /** Patch a team's alert overrides. */
  function setTeamRule(followedTeams, team, patch) {
    const teams = Object.assign({}, followedTeams);
    const existing = findTeam(teams, team);
    if (!existing) return teams;
    teams[existing.key] = Object.assign({}, existing.team, patch || {});
    return teams;
  }

  /** Display order: most recently followed first, then alphabetical. */
  function listTeams(followedTeams) {
    return Object.values(followedTeams || {}).sort((a, b) => {
      const at = typeof a.followedAt === 'number' ? a.followedAt : 0;
      const bt = typeof b.followedAt === 'number' ? b.followedAt : 0;
      if (at !== bt) return bt - at;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  /** Just the names, for the name-based match index. */
  function teamNames(followedTeams) {
    return listTeams(followedTeams)
      .map((t) => t.name)
      .filter(Boolean);
  }

  /** Direct HLTV profile URL when the stable id is known. */
  function profileUrl(team) {
    if (!team || team.id === null || team.id === undefined || String(team.id) === '') {
      return null;
    }
    const slug = team.slug || normalizeTeamName(team.name).replace(/\s+/g, '-');
    return `https://www.hltv.org/team/${encodeURIComponent(team.id)}/${encodeURIComponent(slug || 'team')}`;
  }

  /** The record whose name matches a parsed match card's team label. */
  function teamByName(followedTeams, name) {
    const normalized = normalizeTeamName(name);
    if (!normalized) return null;
    for (const team of Object.values(followedTeams || {})) {
      if (normalizeTeamName(team.name) === normalized) return team;
    }
    return null;
  }

  /**
   * Migrate the v1 name-only list into team records.
   *
   * v1 stored `settings.teams` as an array of strings. Those follows must
   * survive the upgrade, so each becomes a name-keyed record that gains an id
   * the first time its profile is visited.
   */
  function migrateFromNames(names, followedTeams, now) {
    let teams = Object.assign({}, followedTeams);
    for (const name of Array.isArray(names) ? names : []) {
      if (!normalizeTeamName(name)) continue;
      teams = followTeam(teams, { name }, now);
    }
    return teams;
  }

  HTA.teams = {
    teamKey,
    findTeam,
    isFollowed,
    followTeam,
    unfollowTeam,
    setTeamRule,
    listTeams,
    teamNames,
    profileUrl,
    teamByName,
    migrateFromNames
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
