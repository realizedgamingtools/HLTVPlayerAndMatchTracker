/**
 * Live streamer feed.
 *
 * Every HLTV page carries a "Top streams" sidebar listing who is broadcasting
 * right now — verified on 2026-08-20 across the front page, /matches, /results,
 * a team page and a player page, each carrying ~160 entries split into
 * CASTER, STREAMER and ORGANIZER.
 *
 * That is what makes personal-stream alerts possible without a Twitch API key,
 * an OAuth flow, or host permission for any domain but HLTV: the same open tab
 * that already scans for matches also tells us which players are live.
 *
 * Matching is on the channel, never the display label. HLTV shows "chopper"
 * for a channel actually called `chopperinho`, so label matching would both
 * miss real streams and risk matching the wrong person.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const { normalizeText } = HTA.normalize;

  /** Channel identity from a player URL or an HLTV embed URL. */
  function channelFromUrl(url) {
    if (typeof url !== 'string' || url === '') return null;

    // Twitch, both the watch page and the embed form.
    const twitchEmbed = /player\.twitch\.tv\/\?[^#]*\bchannel=([^&#/]+)/i.exec(url);
    if (twitchEmbed) return { platform: 'twitch', channel: twitchEmbed[1].toLowerCase() };
    const twitchPage = /^https?:\/\/(?:www\.)?twitch\.tv\/([^/?#]+)/i.exec(url);
    if (twitchPage && !/^(videos|directory|settings)$/i.test(twitchPage[1])) {
      return { platform: 'twitch', channel: twitchPage[1].toLowerCase() };
    }

    // Kick, likewise.
    const kickEmbed = /player\.kick\.com\/([^/?#]+)/i.exec(url);
    if (kickEmbed) return { platform: 'kick', channel: kickEmbed[1].toLowerCase() };
    const kickPage = /^https?:\/\/(?:www\.)?kick\.com\/([^/?#]+)/i.exec(url);
    if (kickPage) return { platform: 'kick', channel: kickPage[1].toLowerCase() };

    // YouTube identifies a live broadcast by video id, which changes every
    // stream, so a channel handle is the only stable identity available.
    const ytHandle = /^https?:\/\/(?:www\.)?youtube\.com\/@([^/?#]+)/i.exec(url);
    if (ytHandle) return { platform: 'youtube', channel: ytHandle[1].toLowerCase() };
    const ytUser = /^https?:\/\/(?:www\.)?youtube\.com\/(?:user|c)\/([^/?#]+)/i.exec(url);
    if (ytUser) return { platform: 'youtube', channel: ytUser[1].toLowerCase() };

    return null;
  }

  function viewersOf(value) {
    const digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
    return digits === '' ? null : Number(digits);
  }

  /**
   * Parse the live-streams sidebar.
   *
   * @returns {Array<{channel, platform, title, viewers, type, country}>}
   */
  function parseLiveStreams(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];
    const live = [];

    for (const node of rootEl.querySelectorAll('.streams-stream')) {
      const embed = node.getAttribute('data-frontpage-stream-embed-src');
      const identity = channelFromUrl(embed);
      if (!identity) continue;

      live.push({
        channel: identity.channel,
        platform: identity.platform,
        title: normalizeText(node.getAttribute('data-frontpage-stream-title')),
        viewers: viewersOf(node.getAttribute('data-frontpage-stream-viewers')),
        type: (node.getAttribute('data-frontpage-stream-type') || '').toUpperCase() || null,
        country: node.getAttribute('data-frontpage-stream-flag-name') || null
      });
    }

    return live;
  }

  /** Stable key for one broadcaster. */
  function channelKey(platform, channel) {
    if (!platform || !channel) return null;
    return `${platform}:${String(channel).toLowerCase()}`;
  }

  /** Set of channel keys currently live. */
  function liveChannelKeys(liveStreams) {
    const keys = new Set();
    for (const s of liveStreams || []) {
      const key = channelKey(s.platform, s.channel);
      if (key) keys.add(key);
    }
    return keys;
  }

  /**
   * Which of the given channel keys have just come online.
   *
   * A stream stays live for hours, so "is live" is the wrong trigger — it would
   * re-fire on every scan. The alert belongs to the offline -> live transition,
   * which needs the previous scan's live set to detect.
   *
   * An unknown previous set (first scan after install or a browser restart)
   * deliberately yields nothing: everything would look newly live, and opening
   * a pile of stream windows on startup is the worst possible first impression.
   */
  function newlyLive(previousKeys, currentKeys) {
    if (!previousKeys) return new Set();
    const fresh = new Set();
    for (const key of currentKeys) {
      if (!previousKeys.has(key)) fresh.add(key);
    }
    return fresh;
  }

  /** Find the live entry for a channel key. */
  function findLive(liveStreams, platform, channel) {
    const wanted = channelKey(platform, channel);
    if (!wanted) return null;
    for (const s of liveStreams || []) {
      if (channelKey(s.platform, s.channel) === wanted) return s;
    }
    return null;
  }

  /** Watch URL for a live entry, for the popup window. */
  function watchUrl(stream) {
    if (!stream || !stream.channel) return null;
    if (stream.platform === 'twitch') return `https://www.twitch.tv/${stream.channel}`;
    if (stream.platform === 'kick') return `https://kick.com/${stream.channel}`;
    if (stream.platform === 'youtube') return `https://www.youtube.com/@${stream.channel}/live`;
    return null;
  }

  HTA.streamers = {
    channelFromUrl,
    parseLiveStreams,
    channelKey,
    liveChannelKeys,
    newlyLive,
    findLive,
    watchUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
