/**
 * Stream extraction and selection.
 *
 * HLTV match pages list every broadcast of a match: the streamer's name, the
 * platform, a country flag standing in for language, and a live viewer count.
 * This module turns that block into normalized stream objects and picks the
 * one that best fits a user's preferences.
 *
 * Selection deliberately degrades rather than failing: if nothing matches the
 * preferred platform or language, the best available stream is returned with
 * the fallback recorded, so the UI can say "no Russian Twitch stream, opening
 * the biggest English one" instead of silently doing something unexpected.
 *
 * A note on embedding. Each stream carries HLTV's own player URL in
 * `data-stream-embed`, and for Twitch that URL ends in `parent=www.hltv.org`.
 * Twitch validates that parameter against the embedding page's origin and
 * rejects `chrome-extension://` origins outright, so the extension cannot
 * iframe these players. `watchUrl` -- the real page on the platform -- is what
 * gets opened in a popup window instead. `embedUrl` is retained only as source
 * data, never loaded.
 *
 * Verified against live HLTV markup on 2026-08-19: 27 external streams on one
 * match across Twitch, YouTube and Kick, in 11 languages.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;
  const { normalizeText, normalizeTeamName } = HTA.normalize;

  /** Map a watch URL's host onto a platform id. */
  function platformOf(url) {
    if (typeof url !== 'string') return 'other';
    const host = (/^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url) || [])[1] || '';
    if (/(^|\.)twitch\.tv$/i.test(host)) return 'twitch';
    if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) return 'youtube';
    if (/(^|\.)kick\.com$/i.test(host)) return 'kick';
    if (/(^|\.)hltv\.org$/i.test(host)) return 'hltv';
    return 'other';
  }

  function absoluteUrl(href) {
    if (typeof href !== 'string' || href === '') return null;
    return href.startsWith('http') ? href : `https://www.hltv.org${href}`;
  }

  /** Viewer counts render as "-" on layouts that hide the number. */
  function viewersOf(text) {
    const digits = String(text || '').replace(/[^\d]/g, '');
    return digits === '' ? null : Number(digits);
  }

  /**
   * Parse the `.streams` block of a match page.
   * @returns {Array} normalized stream objects, richest first is NOT guaranteed
   */
  function parseStreams(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];
    const streams = [];

    for (const box of rootEl.querySelectorAll('.stream-box')) {
      const isHltvLive =
        box.classList && typeof box.classList.contains === 'function'
          ? box.classList.contains('hltv-live')
          : false;

      if (isHltvLive) {
        // HLTV's own player. Always present, no viewer count, no language.
        const href = box.getAttribute && box.getAttribute('href');
        const url = absoluteUrl(href);
        if (!url) continue;
        streams.push({
          name: normalizeText(box.textContent) || 'HLTV Live',
          platform: 'hltv',
          country: null,
          watchUrl: url,
          embedUrl: null,
          viewers: null
        });
        continue;
      }

      const embed = box.querySelector('.stream-box-embed');
      const external = box.querySelector('.external-stream a[href]');
      const watchUrl = external && external.getAttribute('href');
      if (!watchUrl) continue;

      const flag = box.querySelector('.stream-flag');
      streams.push({
        name: normalizeText(embed && embed.textContent),
        platform: platformOf(watchUrl),
        country: (flag && flag.getAttribute('title')) || null,
        watchUrl,
        embedUrl: (embed && embed.getAttribute('data-stream-embed')) || null,
        viewers: viewersOf(box.querySelector('.viewers') && box.querySelector('.viewers').textContent)
      });
    }

    return streams;
  }

  /** Distinct platforms present, in the project's canonical order. */
  function platformsIn(streams) {
    const present = new Set((streams || []).map((s) => s.platform));
    return C.STREAM_PLATFORMS.filter((p) => present.has(p));
  }

  /** Distinct languages/countries present, alphabetical. */
  function countriesIn(streams) {
    const present = new Set(
      (streams || []).map((s) => s.country).filter((c) => typeof c === 'string' && c !== '')
    );
    return Array.from(present).sort((a, b) => a.localeCompare(b));
  }

  /** Bigger audience first; unknown counts sort last. */
  function byAudience(a, b) {
    const av = typeof a.viewers === 'number' ? a.viewers : -1;
    const bv = typeof b.viewers === 'number' ? b.viewers : -1;
    if (av !== bv) return bv - av;
    const ap = C.STREAM_PLATFORMS.indexOf(a.platform);
    const bp = C.STREAM_PLATFORMS.indexOf(b.platform);
    if (ap !== bp) return (ap < 0 ? 99 : ap) - (bp < 0 ? 99 : bp);
    return String(a.name).localeCompare(String(b.name));
  }

  /**
   * Choose the stream to open.
   *
   * @param {Array} streams
   * @param {{streamPlatform?: string, streamFallbackPlatform?: string, streamCountry?: string}} prefs
   * @returns {{stream: object|null, fellBack: {platform: boolean, country: boolean}}}
   */
  function pickStream(streams, prefs) {
    const fellBack = { platform: false, country: false };
    const all = Array.isArray(streams) ? streams.filter(Boolean) : [];
    if (all.length === 0) return { stream: null, fellBack };

    const wantPlatform = (prefs && prefs.streamPlatform) || C.ANY;
    const fallbackPlatform = (prefs && prefs.streamFallbackPlatform) || C.ANY;
    const wantCountry = (prefs && prefs.streamCountry) || C.ANY;

    let pool = all;

    if (wantPlatform !== C.ANY) {
      const onPlatform = pool.filter((s) => s.platform === wantPlatform);
      // Preference, not a filter: an unavailable platform must not mean no
      // stream at all, or a Kick-only match would open nothing.
      if (onPlatform.length > 0) pool = onPlatform;
      else {
        fellBack.platform = true;
        const onFallback =
          fallbackPlatform !== C.ANY && fallbackPlatform !== wantPlatform
            ? pool.filter((s) => s.platform === fallbackPlatform)
            : [];
        if (onFallback.length > 0) pool = onFallback;
      }
    }

    if (wantCountry !== C.ANY) {
      const inCountry = pool.filter(
        (s) => normalizeTeamName(s.country) === normalizeTeamName(wantCountry)
      );
      if (inCountry.length > 0) pool = inCountry;
      else fellBack.country = true;
    }

    return { stream: pool.slice().sort(byAudience)[0] || null, fellBack };
  }

  /**
   * The URL to open for a match, with a chain of honest fallbacks:
   *   preferred stream -> HLTV's own player -> the match page itself.
   *
   * The last two matter because an alert usually fires while the user is on the
   * matches list, which carries no stream data at all.
   */
  function resolveStreamUrl({ streams, prefs, matchId, matchUrl }) {
    const picked = pickStream(streams, prefs);
    if (picked.stream) {
      return { url: picked.stream.watchUrl, stream: picked.stream, fellBack: picked.fellBack, source: 'stream' };
    }
    if (matchId) {
      return {
        url: `https://www.hltv.org/live?matchId=${encodeURIComponent(matchId)}`,
        stream: null,
        fellBack: picked.fellBack,
        source: 'hltv-live'
      };
    }
    if (matchUrl) {
      return { url: matchUrl, stream: null, fellBack: picked.fellBack, source: 'match-page' };
    }
    return { url: null, stream: null, fellBack: picked.fellBack, source: 'none' };
  }

  HTA.streams = {
    parseStreams,
    pickStream,
    resolveStreamUrl,
    platformsIn,
    countriesIn,
    platformOf
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
