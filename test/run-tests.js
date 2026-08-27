/**
 * Dependency-free test runner for Player & Match Tracker for HLTV.
 *
 *   node test/run-tests.js
 *
 * Core modules are plain scripts that attach to globalThis, so they load here
 * the same way they load in the content script world -- no build step, no shim.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./stub-dom');

const ROOT = path.join(__dirname, '..');

// Load order mirrors the manifest: dependencies before dependents.
const MODULES = [
  'src/shared/constants.js',
  'src/core/normalize.js',
  'src/core/status.js',
  'src/core/matching.js',
  'src/core/teams.js',
  'src/core/streamers.js',
  'src/core/players.js',
  'src/core/rules.js',
  'src/core/alerts.js',
  'src/core/parser.js',
  'src/core/streams.js'
];

for (const relative of MODULES) {
  const file = path.join(ROOT, relative);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

const HTA = globalThis.HTA;
const C = HTA.constants;

/* ---------------------------------------------------------------- harness */

let assertions = 0;
const results = [];

function assert(condition, label) {
  assertions += 1;
  if (!condition) throw new Error(`assertion failed: ${label}`);
}

function assertEqual(actual, expected, label) {
  assert(
    Object.is(actual, expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

/* ------------------------------------------------------------- 1. normalize */

test('normalization collapses casing, padding and diacritics', () => {
  const { normalizeText, normalizeTeamName, sameTeam } = HTA.normalize;

  assertEqual(normalizeText('  Team   Spirit  '), 'Team Spirit', 'collapses whitespace');
  assertEqual(normalizeText('Natus Vincere'), 'Natus Vincere', 'converts nbsp');
  assertEqual(normalizeText(undefined), '', 'non-string input is empty');

  assertEqual(normalizeTeamName('  FaZe  CLAN '), 'faze clan', 'lowercases and trims');
  assertEqual(normalizeTeamName('MOUŹ'), 'mouz', 'strips diacritics');

  assert(sameTeam('vitality', ' Vitality '), 'same team across casing');
  assert(!sameTeam('Vitality', 'Team Vitality'), 'different names stay distinct');
  assert(!sameTeam('', ''), 'blank never matches blank');
});

/* -------------------------------------------------------------- 2. matching */

test('team matching is exact, not substring', () => {
  const { buildTeamIndex, matchedTeams } = HTA.matching;

  const index = buildTeamIndex(['Natus Vincere', '  vitality  ']);
  assertEqual(index.size, 2, 'index holds both teams');

  const followed = matchedTeams({ team1: 'Vitality', team2: 'FaZe' }, index);
  assertEqual(followed.length, 1, 'one followed team on the card');
  assertEqual(followed[0], 'Vitality', 'returns the display label');

  // The reason v1 does not substring-match.
  assertEqual(
    matchedTeams({ team1: 'Natus Vincere Junior', team2: 'FaZe' }, index).length,
    0,
    'academy roster does not match parent org'
  );

  assertEqual(matchedTeams({ team1: 'G2', team2: 'MOUZ' }, index).length, 0, 'unfollowed match');
  assertEqual(matchedTeams({ team1: 'G2', team2: 'MOUZ' }, new Set()).length, 0, 'empty index');

  // The index is built from followed-team records, so the two stay in step.
  const records = HTA.teams.followTeam({}, { id: '4608', name: 'Natus Vincere' }, 1);
  const fromRecords = buildTeamIndex(HTA.teams.teamNames(records));
  assertEqual(
    matchedTeams({ team1: 'Natus Vincere', team2: 'FaZe' }, fromRecords).length,
    1,
    'index built from team records matches the same way'
  );
});

/* ---------------------------------------------------------------- 3. status */

test('status classification separates live, soon, scheduled and past', () => {
  const { classifyMatch, isAlertable, minutesUntil } = HTA.status;
  const now = 1700000000000;
  const minutes = (n) => now + n * 60 * 1000;

  assertEqual(classifyMatch({ isLive: true }, now, 15), C.STATUS_LIVE, 'live flag wins');
  assertEqual(
    classifyMatch({ isLive: true, startTime: minutes(90) }, now, 15),
    C.STATUS_LIVE,
    'live wins over a future start time'
  );
  assertEqual(
    classifyMatch({ startTime: minutes(10) }, now, 15),
    C.STATUS_STARTING_SOON,
    'inside the lead window'
  );
  assertEqual(
    classifyMatch({ startTime: minutes(15) }, now, 15),
    C.STATUS_STARTING_SOON,
    'lead window boundary is inclusive'
  );
  assertEqual(
    classifyMatch({ startTime: minutes(45) }, now, 15),
    C.STATUS_SCHEDULED,
    'beyond the lead window'
  );
  assertEqual(
    classifyMatch({ startTime: minutes(-5) }, now, 15),
    C.STATUS_PAST,
    'a passed start with no live marker is stale, not an alert'
  );
  assertEqual(classifyMatch({ startTime: null }, now, 15), C.STATUS_SCHEDULED, 'unknown start time');
  assertEqual(classifyMatch(null, now, 15), C.STATUS_PAST, 'garbage input does not alert');

  assert(isAlertable(C.STATUS_LIVE) && isAlertable(C.STATUS_STARTING_SOON), 'alertable statuses');
  assert(!isAlertable(C.STATUS_SCHEDULED) && !isAlertable(C.STATUS_PAST), 'quiet statuses');

  assertEqual(minutesUntil({ startTime: minutes(12) }, now), 12, 'minutes until start');
  assertEqual(minutesUntil({}, now), null, 'unknown start time yields null');
});

/* -------------------------------------------------- 4. alert generation */

test('alert generation fires once per match, team and status', () => {
  const now = 1700000000000;
  const settings = {
    teams: ['Vitality', 'Natus Vincere'],
    alertsEnabled: true,
    leadTimeMinutes: 15,
    pageAlerts: true,
    desktopAlerts: true
  };
  const matches = [
    { id: '1', url: '/matches/1/a', team1: 'Vitality', team2: 'FaZe', event: 'BLAST', isLive: true },
    {
      id: '2',
      url: '/matches/2/b',
      team1: 'Natus Vincere',
      team2: 'Team Spirit',
      event: 'IEM Cologne',
      startTime: now + 10 * 60 * 1000
    },
    { id: '3', url: '/matches/3/c', team1: 'G2', team2: 'MOUZ', startTime: now + 5 * 60 * 1000 }
  ];

  const first = HTA.alerts.generateAlerts({ matches, settings, now, sentAlerts: {} });
  assertEqual(first.alerts.length, 2, 'one alert per followed team');

  const live = first.alerts.find((a) => a.status === C.STATUS_LIVE);
  assertEqual(live.team, 'Vitality', 'live alert names the followed team');
  assertEqual(live.title, 'Vitality is LIVE', 'live title');
  assertEqual(live.body, 'Vitality vs FaZe — BLAST', 'live body names the opponent');

  const soon = first.alerts.find((a) => a.status === C.STATUS_STARTING_SOON);
  assertEqual(soon.title, 'Natus Vincere plays in 10 min', 'lead-time title');
  assert(soon.channels.page && soon.channels.desktop, 'both channels requested');

  // Deduplication: replaying the same scan delivers nothing new.
  const second = HTA.alerts.generateAlerts({
    matches,
    settings,
    now: now + 1000,
    sentAlerts: first.sentAlerts
  });
  assertEqual(second.alerts.length, 0, 'no duplicate alerts on rescan');
  assertEqual(second.skipped.duplicate, 2, 'both suppressions counted');

  // The same match rendered twice on one page still alerts once.
  const doubled = HTA.alerts.generateAlerts({
    matches: [matches[0], matches[0]],
    settings,
    now,
    sentAlerts: {}
  });
  assertEqual(doubled.alerts.length, 1, 'duplicate cards collapse within a scan');

  // A match that moves from starting-soon to live is a genuinely new alert.
  const wentLive = HTA.alerts.generateAlerts({
    matches: [Object.assign({}, matches[1], { isLive: true })],
    settings,
    now,
    sentAlerts: first.sentAlerts
  });
  assertEqual(wentLive.alerts.length, 1, 'status transition alerts again');
  assertEqual(wentLive.alerts[0].status, C.STATUS_LIVE, 'the new alert is the live one');

  // Retention window.
  const stale = { 'old|team|live': now - C.ALERT_HISTORY_TTL_MS - 1, 'fresh|team|live': now - 1000 };
  const pruned = HTA.alerts.pruneHistory(stale, now);
  assert(!('old|team|live' in pruned), 'expired delivery record pruned');
  assert('fresh|team|live' in pruned, 'recent delivery record retained');
});

/* --------------------------------------------- 5. disabled / empty states */

test('disabled and empty states stay silent without burning dedupe keys', () => {
  const now = 1700000000000;
  const matches = [{ id: '1', url: '/matches/1/a', team1: 'Vitality', team2: 'FaZe', isLive: true }];
  const base = {
    teams: ['Vitality'],
    alertsEnabled: true,
    leadTimeMinutes: 15,
    pageAlerts: true,
    desktopAlerts: true
  };
  const withSettings = (overrides) => Object.assign({}, base, overrides);

  const off = HTA.alerts.generateAlerts({
    matches,
    settings: withSettings({ alertsEnabled: false }),
    now,
    sentAlerts: {}
  });
  assertEqual(off.alerts.length, 0, 'alerts disabled');
  assertEqual(Object.keys(off.sentAlerts).length, 0, 'nothing recorded while disabled');

  const noTeams = HTA.alerts.generateAlerts({
    matches,
    settings: withSettings({ teams: [] }),
    now,
    sentAlerts: {}
  });
  assertEqual(noTeams.alerts.length, 0, 'no followed teams');
  assertEqual(noTeams.skipped.noTeams, 1, 'skip reason recorded');

  // Both channels off must not record a delivery, or re-enabling a channel
  // would find the dedupe key already burned and stay silent forever.
  const noChannels = HTA.alerts.generateAlerts({
    matches,
    settings: withSettings({ pageAlerts: false, desktopAlerts: false }),
    now,
    sentAlerts: {}
  });
  assertEqual(noChannels.alerts.length, 0, 'no delivery channel enabled');
  assertEqual(Object.keys(noChannels.sentAlerts).length, 0, 'dedupe key not burned');

  const reEnabled = HTA.alerts.generateAlerts({
    matches,
    settings: base,
    now,
    sentAlerts: noChannels.sentAlerts
  });
  assertEqual(reEnabled.alerts.length, 1, 're-enabling a channel still alerts');

  const empty = HTA.alerts.generateAlerts({ matches: [], settings: base, now, sentAlerts: {} });
  assertEqual(empty.alerts.length, 0, 'empty match list');

  const junk = HTA.alerts.generateAlerts({
    matches: null,
    settings: base,
    now,
    sentAlerts: null
  });
  assertEqual(junk.alerts.length, 0, 'null inputs do not throw');
});

/* ------------------------------------------------- 6. live-card parsing */

test('parses real HLTV markup from both layouts', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'matches-page.html'), 'utf8');
  const doc = parseHTML(html);
  const now = 1787223600000;

  const result = HTA.parser.parseMatches(doc, now);
  assertEqual(result.cardsSeen, 4, 'three match-wrappers plus one hotmatch-box');
  assertEqual(result.matches.length, 3, 'TBD placeholder is skipped');
  assert(result.healthy, 'parse reports healthy');

  // -- matches-list layout, scheduled --------------------------------------
  const scheduled = result.matches.find((m) => m.id === '2396603');
  assertEqual(scheduled.team1, 'Natus Vincere', 'team 1 name');
  assertEqual(scheduled.team2, 'Legacy', 'team 2 name');
  assertEqual(scheduled.team1Id, '4608', 'stable team 1 id captured');
  assertEqual(scheduled.team2Id, '12468', 'stable team 2 id captured');
  assertEqual(scheduled.eventId, '8261', 'stable event id captured');
  assertEqual(scheduled.event, 'Esports World Cup 2026', 'event headline');
  assertEqual(scheduled.format, 'bo3', 'best-of format');
  assertEqual(scheduled.lan, true, 'LAN flag');
  assertEqual(scheduled.startTime, 1787223600000, 'data-unix parsed as epoch ms');
  assertEqual(scheduled.layout, 'matches-list', 'layout recorded');
  assertEqual(
    scheduled.url,
    'https://www.hltv.org/matches/2396603/natus-vincere-vs-legacy-esports-world-cup-2026',
    'relative href resolved to an absolute URL'
  );
  assertEqual(scheduled.sourceVersion, C.SOURCE_VERSION, 'source version stamped');

  // The regression this fixture exists to prevent: `.matchLive` is a star
  // rating class on current HLTV and appears on scheduled matches. Treating
  // it as a live marker would fire a live alert for every rated match.
  assertEqual(scheduled.isLive, false, 'star-rating .matchLive is not a live signal');

  // -- matches-list layout, live -------------------------------------------
  const live = result.matches.find((m) => m.id === '2396604');
  assertEqual(live.isLive, true, 'live attribute detected');
  assertEqual(live.team1, 'FaZe', 'live card team 1');
  assertEqual(live.startTime, null, 'live card has no data-unix');

  // -- front-page layout ----------------------------------------------------
  const front = result.matches.find((m) => m.id === '2396651');
  assertEqual(front.layout, 'front-page', 'hotmatch-box uses the other layout');
  assertEqual(front.team1, 'G2 Ares', 'front-page team 1');
  assertEqual(front.team2, 'Bebop', 'front-page team 2');
  assertEqual(front.team1Id, '12889', 'front-page team id from .teambox');
  assertEqual(front.event, 'CCT 2026 Europe Series 7', 'event from anchor title');
  assertEqual(front.isLive, false, 'filteraslive="false" is not live');
  assertEqual(front.startTime, 1787212800000, 'front-page start time');

  assert(!result.matches.some((m) => m.id === '2396921'), 'TBD match excluded');

  // -- end to end: parsed markup drives real alerts -------------------------
  const alerts = HTA.alerts.generateAlerts({
    matches: result.matches,
    settings: {
      teams: ['FaZe', 'natus vincere'],
      alertsEnabled: true,
      leadTimeMinutes: 15,
      pageAlerts: true,
      desktopAlerts: true
    },
    now: now - 10 * 60 * 1000,
    sentAlerts: {}
  });
  assertEqual(alerts.alerts.length, 2, 'one live alert and one starting-soon alert');
  assert(
    alerts.alerts.some((a) => a.status === C.STATUS_LIVE && a.team === 'FaZe'),
    'live alert for the live match'
  );
  assert(
    alerts.alerts.some((a) => a.title === 'Natus Vincere plays in 10 min'),
    'lead-time alert for the scheduled match'
  );

  // An empty parse against a page that clearly had cards must flag unhealthy.
  const broken = parseHTML('<div class="match-wrapper"><span>markup changed</span></div>');
  const brokenResult = HTA.parser.parseMatches(broken, now);
  assertEqual(brokenResult.matches.length, 0, 'unparseable card yields no matches');
  assert(!brokenResult.healthy, 'parse failure is visible, not a silent zero');
});

/* --------------------------------------------------- 7. stream extraction */

test('parses real HLTV stream markup and picks by preference', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'match-page-streams.html'), 'utf8');
  const streams = HTA.streams.parseStreams(parseHTML(html));

  assertEqual(streams.length, 5, 'HLTV player plus four external streams');

  const hltv = streams.find((s) => s.platform === 'hltv');
  assertEqual(hltv.watchUrl, 'https://www.hltv.org/live?matchId=2396603', 'HLTV player URL resolved');
  assertEqual(hltv.viewers, null, 'HLTV player reports no viewer count');

  const twitch = streams.find((s) => s.platform === 'twitch');
  assertEqual(twitch.name, 'BetBoom', 'streamer name');
  assertEqual(twitch.country, 'Russia', 'language taken from the flag title');
  assertEqual(twitch.viewers, 273, 'viewer count parsed');
  assertEqual(twitch.watchUrl, 'https://www.twitch.tv/betboom_cs_ru', 'external watch URL');

  const kickNoViewers = streams.find((s) => s.name === 'LorranBs');
  assertEqual(kickNoViewers.viewers, null, 'a "-" viewer count is unknown, not zero');

  assertEqual(HTA.streams.platformOf('https://www.youtube.com/watch?v=x'), 'youtube', 'youtube host');
  assertEqual(HTA.streams.platformOf('https://youtu.be/x'), 'youtube', 'short youtube host');
  assertEqual(HTA.streams.platformOf('https://example.com/x'), 'other', 'unknown host');
  assertEqual(HTA.streams.platformOf(null), 'other', 'garbage host');

  assertEqual(HTA.streams.platformsIn(streams).join(','), 'twitch,youtube,kick,hltv', 'platforms present');
  assertEqual(
    HTA.streams.countriesIn(streams).join(','),
    'Brazil,Russia,United Kingdom',
    'languages present, deduplicated'
  );

  // -- selection ------------------------------------------------------------
  const biggest = HTA.streams.pickStream(streams, {});
  assertEqual(biggest.stream.name, 'gaules', 'no preference picks the biggest audience');

  const onTwitch = HTA.streams.pickStream(streams, { streamPlatform: 'twitch' });
  assertEqual(onTwitch.stream.platform, 'twitch', 'platform preference honoured');
  assert(!onTwitch.fellBack.platform, 'no fallback when the platform exists');

  const onBackup = HTA.streams.pickStream(streams, {
    streamPlatform: 'other',
    streamFallbackPlatform: 'youtube'
  });
  assertEqual(onBackup.stream.platform, 'youtube', 'backup platform used when primary is absent');
  assert(onBackup.fellBack.platform, 'primary-platform fallback reported');

  const noPreferredPlatforms = HTA.streams.pickStream(streams, {
    streamPlatform: 'other',
    streamFallbackPlatform: 'facebook'
  });
  assertEqual(noPreferredPlatforms.stream.name, 'gaules', 'biggest stream wins after both choices fail');

  const english = HTA.streams.pickStream(streams, { streamCountry: 'United Kingdom' });
  assertEqual(english.stream.name, 'ESL TV B', 'language preference honoured');

  // Preference, not a hard filter: an absent platform must still yield a stream.
  const absent = HTA.streams.pickStream(streams, { streamPlatform: 'hltv', streamCountry: 'Iran' });
  assert(absent.stream !== null, 'unavailable combination still returns a stream');
  assert(absent.fellBack.country, 'country fallback reported');

  const noneAvailable = HTA.streams.pickStream([], { streamPlatform: 'twitch' });
  assertEqual(noneAvailable.stream, null, 'empty stream list yields nothing');

  // -- fallback chain -------------------------------------------------------
  const direct = HTA.streams.resolveStreamUrl({ streams, prefs: {}, matchId: '2396603' });
  assertEqual(direct.source, 'stream', 'a known stream is used directly');

  const noStreams = HTA.streams.resolveStreamUrl({ streams: [], prefs: {}, matchId: '2396603' });
  assertEqual(noStreams.source, 'hltv-live', 'falls back to HLTV own player');
  assertEqual(noStreams.url, 'https://www.hltv.org/live?matchId=2396603', 'HLTV live URL built');

  const nothingKnown = HTA.streams.resolveStreamUrl({
    streams: [],
    prefs: {},
    matchUrl: 'https://www.hltv.org/matches/1/a'
  });
  assertEqual(nothingKnown.source, 'match-page', 'last resort is the match page');
  assertEqual(HTA.streams.resolveStreamUrl({ streams: [] }).url, null, 'nothing to open');
});

/* --------------------------------------------------- 8. per-match rules */

test('per-match rules override globals field by field', () => {
  const settings = {
    teams: ['Vitality'],
    alertsEnabled: true,
    leadTimeMinutes: 15,
    pageAlerts: true,
    desktopAlerts: true,
    openStream: false,
    streamPlatform: 'any',
    streamCountry: 'any'
  };

  // No rule at all: pure inheritance.
  const inherited = HTA.rules.resolveMatchRule(settings, {}, '2396603');
  assertEqual(inherited.leadTimeMinutes, 15, 'inherits global lead time');
  assertEqual(inherited.openStream, false, 'inherits global stream setting');
  assert(!inherited.hasOverrides, 'nothing customised');

  // A partial rule inherits every field it does not set. This is the whole
  // point: pinning a stream language must not freeze the lead time.
  const rules = HTA.rules.setMatchRule({}, '2396603', {
    openStream: true,
    streamPlatform: 'twitch'
  });
  const resolved = HTA.rules.resolveMatchRule(settings, rules, '2396603');
  assertEqual(resolved.openStream, true, 'override applied');
  assertEqual(resolved.streamPlatform, 'twitch', 'override applied');
  assertEqual(resolved.leadTimeMinutes, 15, 'unset field still inherits');
  assertEqual(resolved.overriddenFields.length, 2, 'exactly two fields customised');
  assertEqual(resolved.overrides.openStream, 'match', 'records which scope set the field');

  // Moving the global still moves the un-overridden field.
  const movedGlobal = HTA.rules.resolveMatchRule(
    Object.assign({}, settings, { leadTimeMinutes: 30 }),
    rules,
    '2396603'
  );
  assertEqual(movedGlobal.leadTimeMinutes, 30, 'global change reaches the overridden match');
  assertEqual(movedGlobal.openStream, true, 'override survives a global change');

  // A zero lead time is a real value, not "unset".
  const zeroLead = HTA.rules.setMatchRule({}, 'm', { leadTimeMinutes: 0 });
  assertEqual(
    HTA.rules.resolveMatchRule(settings, zeroLead, 'm').leadTimeMinutes,
    0,
    'lead time 0 overrides rather than reading as absent'
  );

  // Turning a match off individually.
  const muted = HTA.rules.setMatchRule({}, 'm', { enabled: false });
  assertEqual(HTA.rules.resolveMatchRule(settings, muted, 'm').enabled, false, 'match muted');

  // Rules that override nothing are dropped rather than stored as clutter.
  const emptied = HTA.rules.setMatchRule(rules, '2396603', {
    openStream: null,
    streamPlatform: null
  });
  assert(!('2396603' in emptied), 'a rule with no overrides is removed');
  assert(!('x' in HTA.rules.clearMatchRule({ x: { enabled: false } }, 'x')), 'explicit clear');

  // Other matches are untouched.
  const two = HTA.rules.setMatchRule(rules, '999', { enabled: false });
  assertEqual(Object.keys(two).length, 2, 'rules are per match');

  // -- stream opening gate ---------------------------------------------------
  const liveAlert = { status: C.STATUS_LIVE };
  const soonAlert = { status: C.STATUS_STARTING_SOON };
  assert(HTA.rules.shouldOpenStream(liveAlert, { openStream: true }), 'live alert opens a stream');
  assert(
    !HTA.rules.shouldOpenStream(soonAlert, { openStream: true }),
    'a starting-soon alert must not open a player onto a countdown'
  );
  assert(!HTA.rules.shouldOpenStream(liveAlert, { openStream: false }), 'respects the setting');
  assert(!HTA.rules.shouldOpenStream(null, { openStream: true }), 'garbage input does not open');
});

/* ------------------------------ 9. per-match rules drive the alert core */

test('per-match rules change what the alert core emits', () => {
  const now = 1700000000000;
  const settings = {
    teams: ['Vitality'],
    alertsEnabled: true,
    leadTimeMinutes: 5,
    pageAlerts: true,
    desktopAlerts: false,
    openStream: false,
    streamPlatform: 'any',
    streamCountry: 'any'
  };
  const soon = {
    id: '100',
    url: '/matches/100/a',
    team1: 'Vitality',
    team2: 'FaZe',
    startTime: now + 20 * 60 * 1000
  };

  // 20 minutes out, global lead time 5: nothing yet.
  const quiet = HTA.alerts.generateAlerts({ matches: [soon], settings, now, sentAlerts: {} });
  assertEqual(quiet.alerts.length, 0, 'outside the global lead window');

  // A per-match lead time of 30 must reclassify this match, not just filter it.
  const wider = HTA.rules.setMatchRule({}, '100', { leadTimeMinutes: 30 });
  const early = HTA.alerts.generateAlerts({
    matches: [soon],
    settings,
    matchRules: wider,
    now,
    sentAlerts: {}
  });
  assertEqual(early.alerts.length, 1, 'per-match lead time widens the window');
  assertEqual(early.alerts[0].status, C.STATUS_STARTING_SOON, 'classified as starting soon');

  // Muting one match leaves the rest of the config alone.
  const live = { id: '200', url: '/matches/200/b', team1: 'Vitality', team2: 'G2', isLive: true };
  const muted = HTA.rules.setMatchRule({}, '200', { enabled: false });
  const silenced = HTA.alerts.generateAlerts({
    matches: [live],
    settings,
    matchRules: muted,
    now,
    sentAlerts: {}
  });
  assertEqual(silenced.alerts.length, 0, 'muted match stays silent');
  assertEqual(silenced.skipped.muted, 1, 'mute is reported distinctly from disabled');
  assertEqual(Object.keys(silenced.sentAlerts).length, 0, 'muting burns no dedupe key');

  // Opening a stream is a delivery channel: it keeps an alert alive even with
  // both notification channels switched off.
  const streamOnly = HTA.rules.setMatchRule({}, '200', { openStream: true });
  const withStream = HTA.alerts.generateAlerts({
    matches: [live],
    settings: Object.assign({}, settings, { pageAlerts: false, desktopAlerts: false }),
    matchRules: streamOnly,
    now,
    sentAlerts: {}
  });
  assertEqual(withStream.alerts.length, 1, 'stream channel alone still delivers');
  assertEqual(withStream.alerts[0].channels.stream, true, 'stream channel flagged');
  assertEqual(withStream.alerts[0].channels.page, false, 'page channel off');

  // A starting-soon alert must never carry the stream channel.
  const streamSoon = HTA.rules.setMatchRule({}, '100', {
    openStream: true,
    leadTimeMinutes: 30
  });
  const soonAlert = HTA.alerts.generateAlerts({
    matches: [soon],
    settings,
    matchRules: streamSoon,
    now,
    sentAlerts: {}
  });
  assertEqual(soonAlert.alerts[0].channels.stream, false, 'no player opened before the match starts');

  // The effective config travels with the alert, so the deliverer knows which
  // stream preferences to apply without re-resolving.
  assertEqual(withStream.alerts[0].effective.openStream, true, 'effective config attached');

  // The global master switch outranks a per-match enable.
  const forced = HTA.rules.setMatchRule({}, '200', { enabled: true });
  const globallyOff = HTA.alerts.generateAlerts({
    matches: [live],
    settings: Object.assign({}, settings, { alertsEnabled: false }),
    matchRules: forced,
    now,
    sentAlerts: {}
  });
  assertEqual(globallyOff.alerts.length, 0, 'master switch cannot be overridden per match');
});

/* ------------------------------------------------ 10. followed-team model */

test('team identity survives being followed by name then by id', () => {
  const T = HTA.teams;

  // Followed from the popup: a name and nothing else.
  let teams = T.followTeam({}, { name: '  Natus Vincere  ' }, 100);
  assertEqual(Object.keys(teams).length, 1, 'one team followed');
  assertEqual(Object.keys(teams)[0], 'name:natus vincere', 'keyed by normalized name');
  assert(T.isFollowed(teams, { name: 'NATUS VINCERE' }), 'found case-insensitively');

  // Give it settings, as the popup or a team page would.
  teams = T.setTeamRule(teams, { name: 'Natus Vincere' }, { leadTimeMinutes: 30 });
  assertEqual(T.teamByName(teams, 'natus vincere').leadTimeMinutes, 30, 'rule stored');

  // Now the user opens the profile page, which knows the id. This must upgrade
  // the record in place -- duplicating it would silently orphan their settings.
  teams = T.followTeam(teams, { id: '4608', name: 'Natus Vincere', slug: 'natus-vincere' }, 200);
  assertEqual(Object.keys(teams).length, 1, 'still one team, not two');
  assertEqual(Object.keys(teams)[0], 'id:4608', 're-keyed by stable id');

  const upgraded = T.teamByName(teams, 'Natus Vincere');
  assertEqual(upgraded.id, '4608', 'id captured');
  assertEqual(upgraded.slug, 'natus-vincere', 'slug captured');
  assertEqual(upgraded.leadTimeMinutes, 30, 'existing settings survived the upgrade');
  assertEqual(upgraded.followedAt, 100, 'original follow time kept, not reset');

  // Following again from the page is idempotent.
  const again = T.followTeam(teams, { id: '4608', name: 'Natus Vincere' }, 300);
  assertEqual(Object.keys(again).length, 1, 'no duplicate on re-follow');

  // A name-only follow must never blank out identity already captured.
  const nameOnly = T.followTeam(teams, { name: 'Natus Vincere' }, 400);
  assertEqual(T.teamByName(nameOnly, 'Natus Vincere').id, '4608', 'id retained');

  // Unfollow works from either identity.
  assertEqual(Object.keys(T.unfollowTeam(teams, { name: 'natus vincere' })).length, 0, 'by name');
  assertEqual(Object.keys(T.unfollowTeam(teams, { id: '4608' })).length, 0, 'by id');

  // Two genuinely different teams stay separate.
  let two = T.followTeam({}, { id: '4608', name: 'Natus Vincere' }, 1);
  two = T.followTeam(two, { id: '9565', name: 'Vitality' }, 2);
  assertEqual(Object.keys(two).length, 2, 'distinct teams kept apart');
  assertEqual(T.listTeams(two)[0].name, 'Vitality', 'most recently followed first');
  assertEqual(T.teamNames(two).length, 2, 'names extracted for the match index');

  // Garbage in does not create phantom records.
  assertEqual(Object.keys(T.followTeam({}, { name: '   ' }, 1)).length, 0, 'blank name rejected');
});

test('v1 name-only follows migrate without loss', () => {
  const T = HTA.teams;

  const migrated = T.migrateFromNames(['Vitality', '  FaZe  ', ''], {}, 500);
  assertEqual(Object.keys(migrated).length, 2, 'blank entries dropped');
  assert(T.isFollowed(migrated, { name: 'vitality' }), 'Vitality carried over');
  assertEqual(T.teamByName(migrated, 'FaZe').name, 'FaZe', 'name normalized for display');
  assertEqual(T.teamByName(migrated, 'FaZe').id, null, 'no id until the profile is visited');

  // Migration is idempotent: running it twice must not duplicate.
  const twice = T.migrateFromNames(['Vitality'], migrated, 600);
  assertEqual(Object.keys(twice).length, 2, 'no duplicates on re-migration');
});

/* -------------------------------------- 11. global -> team -> match chain */

test('settings resolve down the global, team and match chain', () => {
  const settings = {
    teams: [],
    alertsEnabled: true,
    leadTimeMinutes: 15,
    pageAlerts: true,
    desktopAlerts: true,
    openStream: false,
    streamPlatform: 'any',
    streamCountry: 'any'
  };

  const bare = HTA.rules.resolveRule(settings, {});
  assertEqual(bare.leadTimeMinutes, 15, 'inherits global with no scopes');
  assert(!bare.hasOverrides, 'nothing customised');

  const team = { name: 'Vitality', leadTimeMinutes: 30, openStream: true };

  const teamScoped = HTA.rules.resolveRule(settings, { team });
  assertEqual(teamScoped.leadTimeMinutes, 30, 'team overrides global');
  assertEqual(teamScoped.openStream, true, 'team override applied');
  assertEqual(teamScoped.streamPlatform, 'any', 'unset field still inherits global');
  assertEqual(teamScoped.overrides.leadTimeMinutes, 'team', 'attributed to the team scope');

  // Match scope is narrower, so it wins over the team.
  const match = { leadTimeMinutes: 5 };
  const both = HTA.rules.resolveRule(settings, { team, match });
  assertEqual(both.leadTimeMinutes, 5, 'match beats team');
  assertEqual(both.overrides.leadTimeMinutes, 'match', 'attributed to the match scope');
  assertEqual(both.openStream, true, 'team override survives where match is silent');
  assertEqual(both.overrides.openStream, 'team', 'still attributed to the team');

  // A zero lead time is a real value at team scope, not "unset".
  const zero = HTA.rules.resolveRule(settings, { team: { leadTimeMinutes: 0 } });
  assertEqual(zero.leadTimeMinutes, 0, 'zero overrides rather than reading as absent');

  // Muting one team leaves the global switch alone.
  const muted = HTA.rules.resolveRule(settings, { team: { enabled: false } });
  assertEqual(muted.enabled, false, 'team muted');
  assertEqual(HTA.rules.resolveRule(settings, {}).enabled, true, 'other teams unaffected');
});

test('team rules drive the alert core', () => {
  const now = 1700000000000;
  const settings = {
    teams: [],
    alertsEnabled: true,
    leadTimeMinutes: 5,
    pageAlerts: true,
    desktopAlerts: false,
    openStream: false,
    streamPlatform: 'any',
    streamCountry: 'any'
  };
  const match = {
    id: '500',
    url: '/matches/500/a',
    team1: 'Vitality',
    team2: 'FaZe',
    startTime: now + 20 * 60 * 1000
  };

  let teams = HTA.teams.followTeam({}, { id: '9565', name: 'Vitality' }, 1);

  // 20 minutes out against a 5-minute global window: silent.
  const quiet = HTA.alerts.generateAlerts({
    matches: [match],
    settings,
    followedTeams: teams,
    now,
    sentAlerts: {}
  });
  assertEqual(quiet.alerts.length, 0, 'outside the global lead window');

  // A per-team lead time must reclassify, not merely filter.
  teams = HTA.teams.setTeamRule(teams, { id: '9565' }, { leadTimeMinutes: 30 });
  const fired = HTA.alerts.generateAlerts({
    matches: [match],
    settings,
    followedTeams: teams,
    now,
    sentAlerts: {}
  });
  assertEqual(fired.alerts.length, 1, 'team lead time widens the window');
  assertEqual(fired.alerts[0].teamId, '9565', 'alert carries the team id');
  assertEqual(fired.alerts[0].effective.leadTimeMinutes, 30, 'effective config attached');

  // Muting the team silences it without burning a dedupe key.
  const mutedTeams = HTA.teams.setTeamRule(teams, { id: '9565' }, { enabled: false });
  const silenced = HTA.alerts.generateAlerts({
    matches: [match],
    settings,
    followedTeams: mutedTeams,
    now,
    sentAlerts: {}
  });
  assertEqual(silenced.alerts.length, 0, 'muted team stays silent');
  assertEqual(Object.keys(silenced.sentAlerts).length, 0, 'no key burned');

  // Two followed teams facing each other with different lead times: the one
  // inside its window alerts, the other does not.
  let both = HTA.teams.followTeam({}, { id: '9565', name: 'Vitality' }, 1);
  both = HTA.teams.followTeam(both, { id: '6667', name: 'FaZe' }, 2);
  both = HTA.teams.setTeamRule(both, { id: '9565' }, { leadTimeMinutes: 30 });
  both = HTA.teams.setTeamRule(both, { id: '6667' }, { leadTimeMinutes: 5 });

  const split = HTA.alerts.generateAlerts({
    matches: [match],
    settings,
    followedTeams: both,
    now,
    sentAlerts: {}
  });
  assertEqual(split.alerts.length, 1, 'only the team whose window is open alerts');
  assertEqual(split.alerts[0].team, 'Vitality', 'the right team');

  // Falls back to the v1 settings.teams list when nothing is migrated yet.
  const legacy = HTA.alerts.generateAlerts({
    matches: [Object.assign({}, match, { isLive: true })],
    settings: Object.assign({}, settings, { teams: ['Vitality'] }),
    followedTeams: {},
    now,
    sentAlerts: {}
  });
  assertEqual(legacy.alerts.length, 1, 'v1 name list still works before migration');
});

/* --------------------------------------------------- 14. live streamer feed */

test('parses the live streams sidebar and detects going-live transitions', () => {
  // Shape captured from HLTV on 2026-08-20. Every page carries this sidebar,
  // ~160 entries split CASTER / STREAMER / ORGANIZER.
  const html = [
    '<div class="streams-section"><div class="streams-list">',
    '<div class="streams-stream"',
    ' data-frontpage-stream-title="chopper"',
    ' data-frontpage-stream-viewers="33545"',
    ' data-frontpage-stream-type="STREAMER"',
    ' data-frontpage-stream-flag-name="Russia"',
    ' data-frontpage-stream-embed-src="https://player.twitch.tv/?channel=chopperinho&autoplay=true&parent=www.hltv.org"></div>',
    '<div class="streams-stream"',
    ' data-frontpage-stream-title="gaules"',
    ' data-frontpage-stream-viewers="74689"',
    ' data-frontpage-stream-type="CASTER"',
    ' data-frontpage-stream-flag-name="Brazil"',
    ' data-frontpage-stream-embed-src="https://player.kick.com/gaules?autoplay=true"></div>',
    '<div class="streams-stream"',
    ' data-frontpage-stream-title="ESL"',
    ' data-frontpage-stream-viewers="-"',
    ' data-frontpage-stream-type="ORGANIZER"',
    ' data-frontpage-stream-embed-src="https://www.youtube.com/embed/abc123?autoplay=1"></div>',
    '</div></div>'
  ].join('');

  const live = HTA.streamers.parseLiveStreams(parseHTML(html));
  // The YouTube entry embeds by video id, which carries no stable channel
  // identity, so it cannot be matched to a followed player and is dropped.
  assertEqual(live.length, 2, 'entries with a resolvable channel are kept');

  const chopper = live.find((s) => s.platform === 'twitch');
  assertEqual(chopper.channel, 'chopperinho', 'channel comes from the embed URL');
  assertEqual(chopper.title, 'chopper', 'display label kept separately');
  assertEqual(chopper.viewers, 33545, 'viewers parsed');
  assertEqual(chopper.type, 'STREAMER', 'category preserved');
  assertEqual(chopper.country, 'Russia', 'country preserved');

  // The whole reason matching uses the channel and not the label.
  assert(chopper.title !== chopper.channel, 'label and channel genuinely differ');

  assertEqual(live.find((s) => s.platform === 'kick').channel, 'gaules', 'kick channel');
  assertEqual(HTA.streamers.parseLiveStreams(parseHTML('<div></div>')).length, 0, 'no sidebar');

  // -- channel identity ----------------------------------------------------
  const from = HTA.streamers.channelFromUrl;
  assertEqual(from('https://www.twitch.tv/s1mple').channel, 's1mple', 'twitch watch page');
  assertEqual(from('https://www.twitch.tv/S1mple').channel, 's1mple', 'channel is case-folded');
  assertEqual(from('https://kick.com/gaules').platform, 'kick', 'kick watch page');
  assertEqual(from('https://www.youtube.com/@someone').channel, 'someone', 'youtube handle');
  assertEqual(from('https://www.instagram.com/s1mpleo'), null, 'non-broadcast social ignored');
  assertEqual(from('https://www.twitch.tv/directory'), null, 'twitch section is not a channel');
  assertEqual(from(''), null, 'empty input');

  // -- transition detection ------------------------------------------------
  const keyOf = HTA.streamers.channelKey;
  const current = HTA.streamers.liveChannelKeys(live);
  assert(current.has(keyOf('twitch', 'chopperinho')), 'live set holds the channel key');

  const previous = new Set([keyOf('kick', 'gaules')]);
  const fresh = HTA.streamers.newlyLive(previous, current);
  assertEqual(fresh.size, 1, 'only the newly live channel');
  assert(fresh.has(keyOf('twitch', 'chopperinho')), 'the right one');

  // A stream stays live for hours; it must not re-alert on every scan.
  assertEqual(HTA.streamers.newlyLive(current, current).size, 0, 'still-live is not newly live');

  // No baseline means no alerts: on a first scan everything looks newly live,
  // and opening a pile of stream windows on startup is the worst first run.
  assertEqual(HTA.streamers.newlyLive(null, current).size, 0, 'unknown baseline stays silent');

  assertEqual(
    HTA.streamers.watchUrl({ platform: 'twitch', channel: 'chopperinho' }),
    'https://www.twitch.tv/chopperinho',
    'watch URL rebuilt from channel'
  );
});

/* ------------------------------------------------------ 15. followed players */

test('following a player captures identity, team and personal channels', () => {
  const now = 1700000000000;

  // Exactly what the profile page yields: id and slug from the URL, nickname
  // and real name from the header, team from the info row, and social links
  // that mix broadcast and non-broadcast platforms.
  let players = HTA.players.followPlayer(
    {},
    {
      id: '7998',
      nickname: 's1mple',
      realname: 'Oleksandr Kostyliev',
      slug: 's1mple',
      teamId: '12376',
      teamName: 'BC.Game',
      channelUrls: [
        'https://www.twitter.com/i/user/2814979514',
        'https://www.twitch.tv/s1mple',
        'https://www.instagram.com/s1mpleo'
      ]
    },
    now
  );

  const s1mple = HTA.players.listPlayers(players)[0];
  assertEqual(s1mple.id, '7998', 'stable id captured');
  assertEqual(s1mple.realname, 'Oleksandr Kostyliev', 'real name captured');
  assertEqual(s1mple.teamName, 'BC.Game', 'current team captured');
  assertEqual(s1mple.channels.length, 1, 'only broadcast platforms are kept');
  assertEqual(s1mple.channels[0].channel, 's1mple', 'twitch channel extracted');
  assert(s1mple.alertOnMatch && s1mple.alertOnStream, 'both interests start on');

  assert(HTA.players.isFollowed(players, { id: '7998' }), 'followed by id');
  assert(HTA.players.isFollowed(players, { nickname: 'S1MPLE' }), 'and by nickname, case-folded');
  assert(!HTA.players.isFollowed(players, { id: '1' }), 'someone else is not followed');

  // A transfer must not keep firing alerts for the roster they left.
  players = HTA.players.followPlayer(
    players,
    {
      id: '7998',
      nickname: 's1mple',
      teamId: '4608',
      teamName: 'Natus Vincere',
      channelUrls: ['https://www.twitch.tv/s1mple']
    },
    now + 1000
  );
  assertEqual(Object.keys(players).length, 1, 'refreshed in place, not duplicated');
  assertEqual(HTA.players.listPlayers(players)[0].teamName, 'Natus Vincere', 'team updated');
  assertEqual(HTA.players.listPlayers(players)[0].followedAt, now, 'original follow time kept');

  // Preferences survive a refresh.
  players = HTA.players.setPlayerRule(players, { id: '7998' }, { alertOnMatch: false });
  players = HTA.players.followPlayer(
    players,
    { id: '7998', nickname: 's1mple', teamName: 'Natus Vincere', channelUrls: [] },
    now + 2000
  );
  assertEqual(HTA.players.listPlayers(players)[0].alertOnMatch, false, 'preference preserved');
  assertEqual(
    HTA.players.listPlayers(players)[0].channels.length,
    1,
    'a profile with no links does not wipe known channels'
  );

  // Match watching follows the player's team, and respects the switch.
  assertEqual(HTA.players.teamNamesToWatch(players).length, 0, 'match alerts off: no team watched');
  players = HTA.players.setPlayerRule(players, { id: '7998' }, { alertOnMatch: true });
  assertEqual(HTA.players.teamNamesToWatch(players)[0], 'Natus Vincere', 'watches their team');

  // -- going live ----------------------------------------------------------
  const liveStreams = [
    { platform: 'twitch', channel: 's1mple', title: 's1mple', viewers: 42000, type: 'STREAMER' }
  ];
  const fresh = new Set([HTA.streamers.channelKey('twitch', 's1mple')]);

  const going = HTA.players.playersGoingLive(players, fresh, liveStreams);
  assertEqual(going.length, 1, 'followed player going live is detected');
  assertEqual(going[0].player.nickname, 's1mple', 'names the player');
  assertEqual(going[0].stream.viewers, 42000, 'carries the live stream detail');

  players = HTA.players.setPlayerRule(players, { id: '7998' }, { alertOnStream: false });
  assertEqual(
    HTA.players.playersGoingLive(players, fresh, liveStreams).length,
    0,
    'stream alerts switch off without touching match alerts'
  );

  players = HTA.players.unfollowPlayer(players, { id: '7998' });
  assertEqual(Object.keys(players).length, 0, 'unfollowed');
});

/* ----------------------------------------------------------------- report */


for (const result of results) {
  if (result.ok) {
    console.log(`  PASS  ${result.name}`);
  } else {
    console.log(`  FAIL  ${result.name}`);
    console.log(`        ${result.error.message}`);
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} tests passed (${assertions} assertions)`);

if (passed !== results.length) process.exit(1);
