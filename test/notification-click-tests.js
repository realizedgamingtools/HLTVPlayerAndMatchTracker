'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');

function load(context, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

function event() {
  return { addListener(fn) { this.listener = fn; } };
}

function area() {
  const data = {};
  return {
    async get() { return structuredClone(data); },
    async set(values) { Object.assign(data, structuredClone(values)); }
  };
}

async function run() {
  const storage = { session: area(), local: area(), sync: area() };
  const windows = [], tabs = [], notifications = [], focused = [];
  function worker() {
    const chrome = {
      storage,
      runtime: { getURL: (p) => p, onMessage: event(), onInstalled: event() },
      notifications: {
        onClicked: event(), onClosed: event(),
        async create(id, options) { notifications.push({ id, options }); },
        async clear() {}
      },
      windows: {
        onRemoved: event(),
        async create(options) { windows.push(options); return { id: windows.length }; },
        async update(id) { focused.push(id); }
      },
      tabs: { async create(options) { tabs.push(options); } }
    };
    const context = vm.createContext({ chrome, console });
    context.self = context;
    context.importScripts = (...files) => files.forEach((file) => load(context, file.slice(1)));
    load(context, 'src/background/service-worker.js');
    return { chrome, context };
  }
  let background = worker();
  function send(message) {
    return new Promise((resolve) => background.chrome.runtime.onMessage.listener(message, {}, resolve));
  }

  async function scan({ desktop = true, open = true, status = 'live', streams = [], player = false } = {}) {
    let done;
    const completed = new Promise((resolve) => { done = resolve; });
    const messages = [];
    const pending = [];
    const context = vm.createContext({
      console, document: {}, location: { href: 'https://www.hltv.org/matches' },
      setInterval() {},
      chrome: { runtime: {
        onMessage: event(),
        sendMessage(message) {
          messages.push(message);
          const task = send(message);
          pending.push(task);
          return task;
        }
      } }
    });
    for (const file of ['shared/constants', 'core/normalize', 'core/teams', 'core/rules', 'core/streams']) {
      load(context, `src/${file}.js`);
    }
    const h = context.HTA;
    const settings = { ...h.defaultSettings(), desktopAlerts: desktop, openStream: open };
    const match = { id: '42', url: 'https://www.hltv.org/matches/42/test' };
    h.storage = {
      async getSettings() { return settings; },
      async getFollowedTeams() { return {}; },
      async getFollowedPlayers() { return player ? { one: { id: '1' } } : {}; },
      async getMatchRules() { return {}; },
      async getSentAlerts() { return {}; },
      async saveSentAlerts() {},
      async getStreamSnapshot() { return { streams }; },
      async getLiveChannels() { return []; },
      async saveLiveChannels() {},
      async saveLastScan(record) { done(record); }
    };
    h.players = {
      teamNamesToWatch: () => [],
      playersGoingLive: () => [{ player: { id: '1', nickname: 'Player' }, channel: { platform: 'twitch', channel: 'player' } }]
    };
    h.streamers = {
      parseLiveStreams: () => [], liveChannelKeys: () => [], newlyLive: () => new Set(['player']),
      channelKey: () => 'twitch:player', watchUrl: () => 'https://www.twitch.tv/player'
    };
    h.parser = { parseMatches: () => ({ matches: [], healthy: true }) };
    h.notifier = { showToast() {} };
    h.alerts = {
      pruneHistory: (history) => history,
      generateAlerts: () => ({ sentAlerts: {}, alerts: player ? [] : [{
        key: 'match', match, title: 'Live', body: 'Test', status,
        effective: { streamPlatform: 'twitch', streamFallbackPlatform: 'youtube', streamCountry: 'any' },
        channels: { page: true, desktop, stream: open && status === 'live' }
      }] })
    };
    load(context, 'src/content/content.js');
    const record = await completed;
    assert.equal(record.error, undefined);
    await Promise.all(pending);
    return { messages, match };
  }

  const twitch = { platform: 'twitch', watchUrl: 'https://www.twitch.tv/primary', viewers: 10 };
  const youtube = { platform: 'youtube', watchUrl: 'https://www.youtube.com/watch?v=backup', viewers: 20 };
  const kick = { platform: 'kick', watchUrl: 'https://kick.com/biggest', viewers: 100 };
  for (const [streams, expected] of [
    [[twitch, youtube, kick], twitch.watchUrl], [[youtube, kick], youtube.watchUrl], [[kick], kick.watchUrl],
    [[], 'https://www.hltv.org/live?matchId=42']
  ]) {
    const before = windows.length;
    const { messages } = await scan({ streams });
    assert.equal(messages.length, 1, 'only a desktop notification is sent');
    assert.equal(windows.length, before, 'no popup before the click');
    background = worker(); // A click must work after all worker memory is lost.
    await background.chrome.notifications.onClicked.listener(notifications.at(-1).id);
    assert.equal(windows.at(-1).url, expected);
    assert.equal(tabs.length, 0, 'stream clicks do not open a match tab');
    await background.chrome.windows.onRemoved.listener(windows.length);
  }

  await scan({ desktop: false, streams: [twitch] });
  const beforeReuse = windows.length;
  await scan({ streams: [twitch] });
  await background.chrome.notifications.onClicked.listener(notifications.at(-1).id);
  assert.equal(windows.length, beforeReuse, 'existing match popup is reused');
  assert.equal(focused.at(-1), beforeReuse);

  for (const options of [{ open: false }, { status: 'starting-soon' }]) {
    const { match } = await scan(options);
    await background.chrome.notifications.onClicked.listener(notifications.at(-1).id);
    assert.equal(tabs.at(-1).url, match.url, 'ordinary notifications keep their page target');
  }

  const beforePlayer = windows.length;
  await scan({ player: true });
  assert.equal(windows.length, beforePlayer);
  background = worker();
  await background.chrome.notifications.onClicked.listener(notifications.at(-1).id);
  assert.equal(windows.at(-1).url, 'https://www.twitch.tv/player');

  await scan({ streams: [twitch] });
  const dismissedId = notifications.at(-1).id;
  await background.chrome.notifications.onClosed.listener(dismissedId);
  assert.equal(await background.context.HTA.storage.takeNotificationTarget(dismissedId), null);
  console.log('  PASS  notification click integration (preferences, restart, reuse, fallback, players, dismissal)');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

