/**
 * Dependency-free test runner for HLTV Team Alert.
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
  'src/core/alerts.js',
  'src/core/parser.js'
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
  const { buildTeamIndex, matchedTeams, addTeam, removeTeam } = HTA.matching;

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

  const added = addTeam(['Vitality'], '  faze  ');
  assert(added.added, 'adds a new team');
  assertEqual(added.teams.length, 2, 'list grows');

  const dupe = addTeam(['Vitality'], 'VITALITY');
  assert(!dupe.added && dupe.reason === 'duplicate', 'rejects case-variant duplicate');
  assert(!addTeam(['Vitality'], '   ').added, 'rejects blank input');

  assertEqual(removeTeam(['Vitality', 'FaZe'], 'vitality').length, 1, 'removes case-insensitively');
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
