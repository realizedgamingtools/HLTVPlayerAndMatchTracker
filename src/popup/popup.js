/**
 * Popup controller.
 *
 * Reads settings from storage on open, writes them back on every change, and
 * renders a health panel so a user can tell the difference between "no matches
 * today" and "the parser is broken".
 */
(function (root) {
  'use strict';

  const HTA = root.HTA;
  const C = HTA.constants;

  const el = {
    alertsEnabled: document.getElementById('alerts-enabled'),
    addForm: document.getElementById('add-team-form'),
    teamInput: document.getElementById('team-input'),
    addHint: document.getElementById('add-team-hint'),
    teamList: document.getElementById('team-list'),
    teamEmpty: document.getElementById('team-empty'),
    leadTime: document.getElementById('lead-time'),
    pageAlerts: document.getElementById('page-alerts'),
    desktopAlerts: document.getElementById('desktop-alerts'),
    channelHint: document.getElementById('channel-hint'),
    openStream: document.getElementById('open-stream'),
    streamPlatform: document.getElementById('stream-platform'),
    streamCountry: document.getElementById('stream-country'),
    ruleList: document.getElementById('rule-list'),
    ruleEmpty: document.getElementById('rule-empty'),
    statusList: document.getElementById('status-list'),
    scanNow: document.getElementById('scan-now'),
    scanHint: document.getElementById('scan-hint'),
    testAlert: document.getElementById('test-alert'),
    testHint: document.getElementById('test-hint')
  };

  let settings = HTA.defaultSettings();
  let matchRules = {};

  /* ------------------------------------------------------------ rendering */

  function renderTeams() {
    el.teamList.replaceChildren();
    el.teamEmpty.hidden = settings.teams.length > 0;

    for (const team of settings.teams) {
      const item = document.createElement('li');
      item.className = 'team-list__item';

      const name = document.createElement('span');
      name.className = 'team-list__name';
      name.textContent = team;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'team-list__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Unfollow ${team}`);
      remove.addEventListener('click', async () => {
        settings.teams = HTA.matching.removeTeam(settings.teams, team);
        await HTA.storage.saveSettings(settings);
        renderTeams();
        el.addHint.textContent = `Unfollowed ${team}.`;
      });

      item.append(name, remove);
      el.teamList.appendChild(item);
    }
  }

  function renderLeadTimes() {
    el.leadTime.replaceChildren();
    for (const minutes of C.LEAD_TIME_CHOICES) {
      const option = document.createElement('option');
      option.value = String(minutes);
      option.textContent =
        minutes === 0 ? 'Only once it is live' : minutes >= 60 ? '1 hour' : `${minutes} minutes`;
      el.leadTime.appendChild(option);
    }
    el.leadTime.value = String(settings.leadTimeMinutes);
  }

  /**
   * Platform and language menus.
   *
   * The global menus cannot know which streams exist -- that is only knowable
   * on a match page -- so they list the platforms the extension understands and
   * whatever languages the user has already pinned somewhere. Anything more
   * specific belongs on the match page itself.
   */
  function renderStreamPrefs() {
    el.openStream.checked = settings.openStream === true;

    el.streamPlatform.replaceChildren();
    for (const [value, label] of [[C.ANY, 'Any platform']].concat(
      C.STREAM_PLATFORMS.map((p) => [p, p === 'hltv' ? 'HLTV Live' : p[0].toUpperCase() + p.slice(1)])
    )) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      el.streamPlatform.appendChild(option);
    }
    el.streamPlatform.value = settings.streamPlatform || C.ANY;

    el.streamCountry.replaceChildren();
    const pinned = new Set(
      Object.values(matchRules)
        .map((rule) => rule && rule.streamCountry)
        .filter((c) => typeof c === 'string' && c !== C.ANY)
    );
    if (settings.streamCountry && settings.streamCountry !== C.ANY) {
      pinned.add(settings.streamCountry);
    }
    for (const [value, label] of [[C.ANY, 'Any language']].concat(
      Array.from(pinned).sort((a, b) => a.localeCompare(b)).map((c) => [c, c])
    )) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      el.streamCountry.appendChild(option);
    }
    el.streamCountry.value = settings.streamCountry || C.ANY;
  }

  /** Matches the user has customised individually, with a way to undo. */
  function renderMatchRules() {
    el.ruleList.replaceChildren();
    const ids = Object.keys(matchRules);
    el.ruleEmpty.hidden = ids.length > 0;

    for (const matchId of ids) {
      const resolved = HTA.rules.resolveMatchRule(settings, matchRules, matchId);
      const item = document.createElement('li');
      item.className = 'team-list__item';

      const name = document.createElement('span');
      name.className = 'team-list__name';
      name.textContent = `Match ${matchId} — ${resolved.overrides.length} setting${
        resolved.overrides.length === 1 ? '' : 's'
      }`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'team-list__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Reset match ${matchId} to defaults`);
      remove.addEventListener('click', async () => {
        matchRules = HTA.rules.clearMatchRule(matchRules, matchId);
        await HTA.storage.saveMatchRules(matchRules);
        renderMatchRules();
        renderStreamPrefs();
      });

      item.append(name, remove);
      el.ruleList.appendChild(item);
    }
  }

  function renderChannelHint() {
    const noChannel = !settings.pageAlerts && !settings.desktopAlerts;
    el.channelHint.textContent = noChannel
      ? 'Pick at least one channel, or nothing will be delivered.'
      : '';
    el.channelHint.classList.toggle('hint--warn', noChannel);
  }

  function relativeTime(timestamp) {
    const seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function addStatusRow(label, value, state) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (state) dd.classList.add(`is-${state}`);
    el.statusList.append(dt, dd);
  }

  async function renderStatus() {
    el.statusList.replaceChildren();

    const lastScan = await HTA.storage.getLastScan();
    if (!lastScan) {
      addStatusRow('Last scan', 'never', 'warn');
      addStatusRow('Parser', 'not run yet', 'warn');
    } else {
      addStatusRow('Last scan', relativeTime(lastScan.at));
      if (lastScan.error) {
        addStatusRow('Parser', 'failed', 'bad');
      } else if (!lastScan.healthy) {
        // Cards were on the page but none parsed: HLTV markup likely changed.
        addStatusRow('Parser', 'no matches recognised', 'bad');
      } else {
        addStatusRow('Parser', `${lastScan.matchesParsed} matches`, 'ok');
      }
    }

    // Desktop notification health is an OS/browser setting the extension
    // cannot change, so surface it rather than failing silently later.
    if (settings.desktopAlerts && chrome.notifications) {
      const level = await chrome.notifications.getPermissionLevel();
      addStatusRow(
        'Desktop alerts',
        level === 'granted' ? 'allowed' : 'blocked by browser',
        level === 'granted' ? 'ok' : 'bad'
      );
    }

    addStatusRow('Following', `${settings.teams.length} team${settings.teams.length === 1 ? '' : 's'}`);
  }

  /* -------------------------------------------------------------- actions */

  async function persist() {
    await HTA.storage.saveSettings(settings);
  }

  el.addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = HTA.matching.addTeam(settings.teams, el.teamInput.value);

    if (!result.added) {
      el.addHint.textContent =
        result.reason === 'duplicate'
          ? 'You already follow that team.'
          : 'Enter a team name first.';
      el.addHint.classList.add('hint--warn');
      return;
    }

    settings.teams = result.teams;
    await persist();
    el.teamInput.value = '';
    el.addHint.textContent = '';
    el.addHint.classList.remove('hint--warn');
    renderTeams();
    renderStatus();
  });

  el.alertsEnabled.addEventListener('change', async () => {
    settings.alertsEnabled = el.alertsEnabled.checked;
    await persist();
  });

  el.leadTime.addEventListener('change', async () => {
    settings.leadTimeMinutes = Number(el.leadTime.value);
    await persist();
  });

  el.openStream.addEventListener('change', async () => {
    settings.openStream = el.openStream.checked;
    await persist();
  });

  for (const [key, node] of [
    ['streamPlatform', el.streamPlatform],
    ['streamCountry', el.streamCountry]
  ]) {
    node.addEventListener('change', async () => {
      settings[key] = node.value;
      await persist();
    });
  }

  for (const [key, node] of [
    ['pageAlerts', el.pageAlerts],
    ['desktopAlerts', el.desktopAlerts]
  ]) {
    node.addEventListener('change', async () => {
      settings[key] = node.checked;
      await persist();
      renderChannelHint();
      renderStatus();
    });
  }

  /**
   * Ask every tab running the content script to scan now.
   *
   * The extension holds no tabs permission, so tab URLs are not readable here.
   * Messaging every tab and ignoring the rejections is equivalent: only HLTV
   * tabs have a listener, and a rejection just means "no content script here".
   */
  el.scanNow.addEventListener('click', async () => {
    el.scanNow.disabled = true;
    el.scanHint.textContent = 'Scanning…';
    el.scanHint.classList.remove('hint--warn');

    try {
      const tabs = await chrome.tabs.query({});
      const replies = await Promise.all(
        tabs.map((tab) =>
          chrome.tabs
            .sendMessage(tab.id, { type: C.MSG_MANUAL_SCAN })
            .catch(() => null)
        )
      );
      const scanned = replies.filter((reply) => reply && reply.record);

      if (scanned.length === 0) {
        el.scanHint.textContent = 'Open an HLTV tab to scan.';
        el.scanHint.classList.add('hint--warn');
      } else {
        const total = scanned.reduce((sum, r) => sum + (r.record.matchesParsed || 0), 0);
        el.scanHint.textContent = `Scanned ${scanned.length} HLTV tab${
          scanned.length === 1 ? '' : 's'
        }, ${total} matches seen.`;
      }
    } catch (error) {
      el.scanHint.textContent = 'Scan failed. Reload the HLTV tab and try again.';
      el.scanHint.classList.add('hint--warn');
      console.warn('[HLTV Team Alert] manual scan failed', error);
    } finally {
      el.scanNow.disabled = false;
      renderStatus();
    }
  });

  /**
   * Fire a synthetic alert down the real delivery paths.
   *
   * This exists because the honest answer to "does it work?" otherwise
   * requires waiting for a followed team to actually go live. It uses the
   * user's own channel settings and the real notifier and notification code,
   * so a passing test says something about the shipped path rather than about
   * a mock.
   */
  el.testAlert.addEventListener('click', async () => {
    el.testAlert.disabled = true;
    el.testHint.classList.remove('hint--warn');
    el.testHint.textContent = 'Sending…';

    const sample = {
      key: `test:${Date.now()}`,
      title: 'Test alert — HLTV Team Alert',
      body: 'If you can see this, alerts are working.',
      status: C.STATUS_LIVE,
      url: 'https://www.hltv.org/matches'
    };

    const delivered = [];
    const failed = [];

    if (settings.desktopAlerts) {
      const reply = await chrome.runtime
        .sendMessage({ type: C.MSG_DESKTOP_NOTIFY, alert: sample })
        .catch((error) => ({ ok: false, error: String(error) }));
      if (reply && reply.ok) delivered.push('desktop notification');
      else failed.push('desktop notification');
    }

    if (settings.pageAlerts) {
      const tabs = await chrome.tabs.query({});
      const replies = await Promise.all(
        tabs.map((tab) =>
          chrome.tabs
            .sendMessage(tab.id, { type: C.MSG_TEST_ALERT, alert: sample })
            .catch(() => null)
        )
      );
      if (replies.some((reply) => reply && reply.ok)) delivered.push('on-page toast');
      else failed.push('on-page toast (no HLTV tab open)');
    }

    if (delivered.length === 0 && failed.length === 0) {
      el.testHint.textContent = 'Both channels are off, so there was nothing to send.';
      el.testHint.classList.add('hint--warn');
    } else if (failed.length === 0) {
      el.testHint.textContent = `Sent: ${delivered.join(' and ')}.`;
    } else {
      el.testHint.textContent = `Failed: ${failed.join(', ')}.${
        delivered.length > 0 ? ` Sent: ${delivered.join(', ')}.` : ''
      }`;
      el.testHint.classList.add('hint--warn');
    }

    el.testAlert.disabled = false;
  });

  /* ----------------------------------------------------------------- boot */

  (async function init() {
    [settings, matchRules] = await Promise.all([
      HTA.storage.getSettings(),
      HTA.storage.getMatchRules()
    ]);
    el.alertsEnabled.checked = settings.alertsEnabled;
    el.pageAlerts.checked = settings.pageAlerts;
    el.desktopAlerts.checked = settings.desktopAlerts;
    renderLeadTimes();
    renderTeams();
    renderStreamPrefs();
    renderMatchRules();
    renderChannelHint();
    await renderStatus();
  })();
})(typeof globalThis !== 'undefined' ? globalThis : self);
