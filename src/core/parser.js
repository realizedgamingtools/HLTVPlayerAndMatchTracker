/**
 * HLTV source adapter.
 *
 * Every HLTV-specific selector in the extension lives in this file. Nothing
 * downstream of parseMatches() knows what HLTV markup looks like -- it sees
 * only normalized match candidates. When HLTV changes its markup, this file
 * and test/fixtures are the only things that should need to change; bump
 * constants.SOURCE_VERSION when they do.
 *
 * HLTV renders matches with two different layouts:
 *
 *   matches-list  /matches and event pages. A `.match-wrapper` per match,
 *                 carrying stable ids as attributes.
 *   front-page    The `.hotmatch-box` strip on the home page, which uses
 *                 older markup and a different live flag.
 *
 * Both produce the same match candidate:
 *
 *   { id, url, team1, team2, team1Id, team2Id, event, eventId, format,
 *     startTime, isLive, lan, sourceVersion, layout }
 *
 * Verified against live HLTV markup on 2026-08-19. Note that `.matchLive` is
 * NOT a live indicator on current HLTV -- it is a star-rating class
 * (`div.match-rating.matchLive`) applied to scheduled matches. Live state
 * comes from the `live` / `filteraslive` attributes instead.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;
  const { normalizeText } = HTA.normalize;

  const MATCH_HREF = /^(?:https?:\/\/(?:www\.)?hltv\.org)?\/matches\/(\d+)(?:\/|$)/;

  function textOf(el) {
    return el ? normalizeText(el.textContent) : '';
  }

  function attr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return null;
    const value = el.getAttribute(name);
    return value === null ? null : normalizeText(value);
  }

  /** Team id attributes are present but empty on TBD placeholder cards. */
  function teamId(el, name) {
    const value = attr(el, name);
    return value ? value : null;
  }

  /** The canonical /matches/<id>/<slug> link on or under this card. */
  function findMatchLink(cardEl) {
    const own = attr(cardEl, 'href');
    if (own && MATCH_HREF.test(own)) return own;
    for (const anchor of cardEl.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      if (href && MATCH_HREF.test(href)) return href;
    }
    return null;
  }

  function absoluteUrl(href) {
    return href.startsWith('http') ? href : `https://www.hltv.org${href}`;
  }

  /**
   * Epoch milliseconds from a data-unix attribute.
   * HLTV uses millisecond epochs; a seconds-epoch is tolerated defensively.
   */
  function unixFrom(el) {
    if (!el) return null;
    const value = Number(el.getAttribute('data-unix'));
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1e12 ? value * 1000 : value;
  }

  /** A time cell reading exactly "LIVE" instead of a clock time. */
  function timeCellSaysLive(cardEl) {
    for (const selector of ['.match-time', '.middleExtra', '.matchTime']) {
      const text = textOf(cardEl.querySelector(selector));
      if (text.toUpperCase() === 'LIVE') return true;
    }
    return false;
  }

  /* -------------------------------------------------- layout: matches list */

  function extractFromMatchWrapper(cardEl) {
    const href = findMatchLink(cardEl);
    if (!href) return null;

    // Placeholder cards ("3rd Place Decider Match") carry a link and a time but
    // no named teams, and render `.match-no-info` instead. Not alertable.
    const names = Array.from(cardEl.querySelectorAll('.match-teamname')).map(textOf).filter(Boolean);
    if (names.length < 2) return null;

    const eventEl = cardEl.querySelector('.match-event');
    const idFromHref = MATCH_HREF.exec(href);

    return {
      id: attr(cardEl, 'data-match-id') || (idFromHref && idFromHref[1]) || href,
      url: absoluteUrl(href),
      team1: names[0],
      team2: names[1],
      team1Id: teamId(cardEl, 'team1'),
      team2Id: teamId(cardEl, 'team2'),
      event: attr(eventEl, 'data-event-headline') || textOf(cardEl.querySelector('.match-stage')),
      eventId: attr(cardEl, 'data-event-id'),
      format: textOf(cardEl.querySelector('.match-meta')),
      startTime: unixFrom(cardEl.querySelector('[data-unix]')),
      isLive: attr(cardEl, 'live') === 'true' || timeCellSaysLive(cardEl),
      lan: attr(cardEl, 'lan') === 'true',
      sourceVersion: C.SOURCE_VERSION,
      layout: 'matches-list'
    };
  }

  /* --------------------------------------------------- layout: front page */

  function extractFromHotmatchBox(cardEl) {
    const href = findMatchLink(cardEl);
    if (!href) return null;

    const names = Array.from(cardEl.querySelectorAll('.teamrow .team')).map(textOf).filter(Boolean);
    if (names.length < 2) return null;

    const teamBox = cardEl.querySelector('.teambox') || cardEl;
    const idFromHref = MATCH_HREF.exec(href);

    return {
      id: (idFromHref && idFromHref[1]) || href,
      url: absoluteUrl(href),
      team1: names[0],
      team2: names[1],
      team1Id: teamId(teamBox, 'team1'),
      team2Id: teamId(teamBox, 'team2'),
      // The front-page card names its event only in the anchor's title.
      event: attr(cardEl, 'title') || '',
      eventId: null,
      format: '',
      startTime: unixFrom(cardEl.querySelector('[data-unix]')),
      isLive: attr(teamBox, 'filteraslive') === 'true' || timeCellSaysLive(cardEl),
      lan: attr(teamBox, 'lan') === 'true',
      sourceVersion: C.SOURCE_VERSION,
      layout: 'front-page'
    };
  }

  const LAYOUTS = [
    { selector: '.match-wrapper', extract: extractFromMatchWrapper },
    { selector: '.hotmatch-box', extract: extractFromHotmatchBox }
  ];

  /** Parse a single card, trying each layout. Exposed for tests. */
  function extractMatch(cardEl) {
    if (!cardEl || typeof cardEl.querySelector !== 'function') return null;
    for (const layout of LAYOUTS) {
      const match = layout.extract(cardEl);
      if (match) return match;
    }
    return null;
  }

  /**
   * Scan a document (or any element) for match candidates.
   *
   * @returns {{matches: Array, cardsSeen: number, parsedAt: number, healthy: boolean}}
   *   `healthy` is false when cards were present but none parsed -- the signal
   *   the project brief calls "fail visibly on empty parses" rather than
   *   silently reporting zero matches. Most cards on /matches are legitimately
   *   unparseable TBD placeholders, so this only trips when *nothing* parses.
   */
  function parseMatches(rootEl, now) {
    const parsedAt = typeof now === 'number' ? now : Date.now();
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') {
      return { matches: [], cardsSeen: 0, parsedAt, healthy: false };
    }

    const byId = new Map();
    let cardsSeen = 0;

    for (const layout of LAYOUTS) {
      for (const card of rootEl.querySelectorAll(layout.selector)) {
        cardsSeen += 1;
        const match = layout.extract(card);
        if (!match) continue;
        // The same match can appear in more than one layout on one page; keep
        // the richer record, and never let a stale copy clear a live flag.
        const existing = byId.get(match.id);
        if (!existing || (!existing.isLive && match.isLive)) byId.set(match.id, match);
      }
    }

    const matches = Array.from(byId.values());
    return {
      matches,
      cardsSeen,
      parsedAt,
      healthy: cardsSeen === 0 || matches.length > 0
    };
  }

  HTA.parser = { parseMatches, extractMatch, findMatchLink, unixFrom, LAYOUTS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
