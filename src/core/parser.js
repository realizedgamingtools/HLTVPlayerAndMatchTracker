/**
 * HLTV source adapter.
 *
 * Every HLTV-specific selector in the extension lives in this file. Nothing
 * downstream of parseMatches() knows what HLTV's markup looks like — it sees
 * only normalized match candidates. When HLTV changes its markup, this file
 * and its fixtures are the only things that should need to change; bump
 * constants.SOURCE_VERSION when they do.
 *
 * Output shape (a match candidate):
 *   { id, url, team1, team2, event, format, startTime, isLive, sourceVersion }
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;
  const { normalizeText } = HTA.normalize;

  /** Containers that wrap a single match across HLTV's various layouts. */
  const CARD_SELECTORS = [
    '.upcomingMatch',
    '.liveMatch',
    '.match-wrapper',
    '.matchEventContainer .match',
    '.hotmatch-box .match'
  ];

  /** Team-name nodes, most specific first. */
  const TEAM_NAME_SELECTORS = ['.matchTeamName', '.team-name', '.matchTeam .team', '.teamName'];

  /** Event-name nodes. */
  const EVENT_SELECTORS = ['.matchEventName', '.matchEvent .text-ellipsis', '.matchEvent', '.event-name'];

  /** Best-of / format label. */
  const META_SELECTORS = ['.matchMeta', '.match-meta'];

  /** Explicit live markers. */
  const LIVE_SELECTORS = ['.matchLive', '.matchLiveSpan', '.live-match-indicator'];

  const MATCH_HREF = /^\/matches\/(\d+)(?:\/|$)/;

  function textOf(el) {
    return el ? normalizeText(el.textContent) : '';
  }

  function firstText(cardEl, selectors) {
    for (const selector of selectors) {
      const found = cardEl.querySelector(selector);
      const text = textOf(found);
      if (text) return text;
    }
    return '';
  }

  /** The canonical /matches/<id>/<slug> link for this card. */
  function findMatchLink(cardEl) {
    if (typeof cardEl.getAttribute === 'function') {
      const own = cardEl.getAttribute('href');
      if (own && MATCH_HREF.test(own)) return own;
    }
    const anchors = cardEl.querySelectorAll('a[href]');
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href');
      if (href && MATCH_HREF.test(href)) return href;
    }
    return null;
  }

  /** Team display names, in card order. */
  function extractTeams(cardEl) {
    for (const selector of TEAM_NAME_SELECTORS) {
      const nodes = Array.from(cardEl.querySelectorAll(selector));
      const names = nodes.map(textOf).filter(Boolean);
      if (names.length >= 2) return names.slice(0, 2);
    }
    return [];
  }

  /**
   * Scheduled start, epoch ms.
   * HLTV puts a millisecond epoch in data-unix on the time node.
   */
  function extractStartTime(cardEl) {
    const node = cardEl.querySelector('[data-unix]');
    if (!node) return null;
    const raw = node.getAttribute('data-unix');
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    // Tolerate a seconds-epoch, which HLTV has used on some pages.
    return value < 1e12 ? value * 1000 : value;
  }

  /** Live detection: explicit marker element, or a LIVE label on the time node. */
  function isLiveCard(cardEl) {
    if (cardEl.classList && typeof cardEl.classList.contains === 'function') {
      if (cardEl.classList.contains('liveMatch')) return true;
    }
    for (const selector of LIVE_SELECTORS) {
      if (cardEl.querySelector(selector)) return true;
    }
    const timeText = firstText(cardEl, ['.matchTime', '.match-time', '.time']);
    return timeText.toUpperCase() === 'LIVE';
  }

  /** Parse one card into a match candidate, or null if it is not usable. */
  function extractMatch(cardEl) {
    if (!cardEl || typeof cardEl.querySelector !== 'function') return null;

    const href = findMatchLink(cardEl);
    const teams = extractTeams(cardEl);
    // A card with no match link or fewer than two named teams is a TBD slot,
    // an ad, or markup we no longer understand. Either way it is not alertable.
    if (!href || teams.length < 2) return null;

    const idMatch = MATCH_HREF.exec(href);
    return {
      id: idMatch ? idMatch[1] : href,
      url: href.startsWith('http') ? href : `https://www.hltv.org${href}`,
      team1: teams[0],
      team2: teams[1],
      event: firstText(cardEl, EVENT_SELECTORS),
      format: firstText(cardEl, META_SELECTORS),
      startTime: extractStartTime(cardEl),
      isLive: isLiveCard(cardEl),
      sourceVersion: C.SOURCE_VERSION
    };
  }

  /**
   * Scan a document (or any element) for match candidates.
   *
   * @returns {{matches: Array, cardsSeen: number, parsedAt: number, healthy: boolean}}
   *   `healthy` is false when cards were present but none parsed — the signal
   *   the brief calls "fail visibly on empty parses" rather than silently
   *   reporting zero matches.
   */
  function parseMatches(rootEl, now) {
    const parsedAt = typeof now === 'number' ? now : Date.now();
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') {
      return { matches: [], cardsSeen: 0, parsedAt, healthy: false };
    }

    const cards = [];
    for (const selector of CARD_SELECTORS) {
      for (const el of rootEl.querySelectorAll(selector)) cards.push(el);
    }

    const byId = new Map();
    for (const card of cards) {
      const match = extractMatch(card);
      if (!match) continue;
      // The same match appears in several places on the front page; keep the
      // richest copy (a live card carries score/state an upcoming card lacks).
      const existing = byId.get(match.id);
      if (!existing || (!existing.isLive && match.isLive)) byId.set(match.id, match);
    }

    const matches = Array.from(byId.values());
    return {
      matches,
      cardsSeen: cards.length,
      parsedAt,
      healthy: cards.length === 0 || matches.length > 0
    };
  }

  HTA.parser = {
    parseMatches,
    extractMatch,
    extractTeams,
    extractStartTime,
    isLiveCard,
    findMatchLink,
    CARD_SELECTORS
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
