/**
 * Followed players.
 *
 * A player is followed from their HLTV profile, which supplies a stable id,
 * nickname, real name, current team, and the personal channels listed in their
 * social links. Two independent things can be alerted on:
 *
 *   - their team playing a match   (rides the existing match pipeline)
 *   - their own stream going live  (rides the live-streams sidebar)
 *
 * They are separate switches because they are separate interests: plenty of
 * people want to know when s1mple is streaming without being told about every
 * BC.Game fixture, and vice versa.
 *
 * Pure: no storage, no DOM.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const { normalizeText, normalizeTeamName } = HTA.normalize;

  function playerKey(player) {
    if (!player) return null;
    if (player.id !== null && player.id !== undefined && String(player.id) !== '') {
      return `id:${player.id}`;
    }
    const normalized = normalizeTeamName(player.nickname);
    return normalized ? `nick:${normalized}` : null;
  }

  function findPlayer(followedPlayers, player) {
    const players = followedPlayers || {};
    const key = playerKey(player);
    if (key && players[key]) return { key, player: players[key] };

    const normalized = normalizeTeamName(player && player.nickname);
    if (!normalized) return null;
    for (const [existingKey, existing] of Object.entries(players)) {
      if (normalizeTeamName(existing.nickname) === normalized) {
        return { key: existingKey, player: existing };
      }
    }
    return null;
  }

  function isFollowed(followedPlayers, player) {
    return findPlayer(followedPlayers, player) !== null;
  }

  /**
   * Normalize the social links scraped from a profile into channel records.
   *
   * Only broadcast platforms are kept; a player's Twitter and Instagram are of
   * no use for knowing whether they are live.
   */
  function toChannels(urls) {
    const channels = [];
    const seen = new Set();
    for (const url of Array.isArray(urls) ? urls : []) {
      const identity = HTA.streamers.channelFromUrl(url);
      if (!identity) continue;
      const key = HTA.streamers.channelKey(identity.platform, identity.channel);
      if (seen.has(key)) continue;
      seen.add(key);
      channels.push({ platform: identity.platform, channel: identity.channel, url });
    }
    return channels;
  }

  /**
   * Follow a player, or refresh an existing record with newly learned details.
   *
   * A player changes team, and a profile visit is the moment we can notice, so
   * team and channels are refreshed on every follow rather than only on first
   * capture. The user's own alert preferences are preserved.
   */
  function followPlayer(followedPlayers, fields, now) {
    const players = Object.assign({}, followedPlayers);
    const existing = findPlayer(players, fields);

    const learned = {
      id: fields.id !== null && fields.id !== undefined ? String(fields.id) : null,
      nickname: normalizeText(fields.nickname),
      realname: normalizeText(fields.realname) || null,
      slug: fields.slug || null,
      teamId: fields.teamId !== null && fields.teamId !== undefined ? String(fields.teamId) : null,
      teamName: normalizeText(fields.teamName) || null,
      channels: toChannels(fields.channelUrls)
    };

    if (existing) {
      const merged = Object.assign({}, existing.player, {
        id: learned.id || existing.player.id,
        nickname: learned.nickname || existing.player.nickname,
        realname: learned.realname || existing.player.realname,
        slug: learned.slug || existing.player.slug,
        // Team and channels are refreshed, not merged: a stale former team
        // would keep firing match alerts for a roster the player has left.
        teamId: learned.teamId,
        teamName: learned.teamName,
        channels: learned.channels.length > 0 ? learned.channels : existing.player.channels,
        followedAt: existing.player.followedAt || now
      });
      const newKey = playerKey(merged);
      if (newKey !== existing.key) delete players[existing.key];
      players[newKey] = merged;
      return players;
    }

    const record = HTA.defaultFollowedPlayer(Object.assign({ followedAt: now }, learned));
    const key = playerKey(record);
    if (!key) return players;
    players[key] = record;
    return players;
  }

  function unfollowPlayer(followedPlayers, player) {
    const players = Object.assign({}, followedPlayers);
    const existing = findPlayer(players, player);
    if (existing) delete players[existing.key];
    return players;
  }

  function setPlayerRule(followedPlayers, player, patch) {
    const players = Object.assign({}, followedPlayers);
    const existing = findPlayer(players, player);
    if (!existing) return players;
    players[existing.key] = Object.assign({}, existing.player, patch || {});
    return players;
  }

  function listPlayers(followedPlayers) {
    return Object.values(followedPlayers || {}).sort((a, b) => {
      const at = typeof a.followedAt === 'number' ? a.followedAt : 0;
      const bt = typeof b.followedAt === 'number' ? b.followedAt : 0;
      if (at !== bt) return bt - at;
      return String(a.nickname).localeCompare(String(b.nickname));
    });
  }

  /** Team names to watch because a followed player plays for them. */
  function teamNamesToWatch(followedPlayers) {
    const names = [];
    for (const player of listPlayers(followedPlayers)) {
      if (player.alertOnMatch === false) continue;
      if (player.teamName) names.push(player.teamName);
    }
    return names;
  }

  /**
   * Followed players whose personal channel just came online.
   *
   * @param {object} followedPlayers
   * @param {Set<string>} freshKeys channel keys that just went live
   * @param {Array} liveStreams the parsed live feed, for stream detail
   */
  function playersGoingLive(followedPlayers, freshKeys, liveStreams) {
    const going = [];
    for (const player of listPlayers(followedPlayers)) {
      if (player.alertOnStream !== true) continue;
      for (const channel of player.channels || []) {
        const key = HTA.streamers.channelKey(channel.platform, channel.channel);
        if (!key || !freshKeys.has(key)) continue;
        going.push({
          player,
          channel,
          stream: HTA.streamers.findLive(liveStreams, channel.platform, channel.channel)
        });
        break; // one alert per player, even if they somehow multicast
      }
    }
    return going;
  }

  HTA.players = {
    playerKey,
    findPlayer,
    isFollowed,
    toChannels,
    followPlayer,
    unfollowPlayer,
    setPlayerRule,
    listPlayers,
    teamNamesToWatch,
    playersGoingLive
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
