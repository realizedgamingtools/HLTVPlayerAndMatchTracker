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
    statusList: document.getElementById('status-list'),
    scanNow: document.getElementById('scan-now'),
    scanHint: document.getElementById('scan-hint')
  };

  let settings = HTA.defaultSettings();

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
      option.textContent = minutes >= 60 ? '1 hour' : `${minutes} minutes`;
      el.leadTime.appendChild(option);
    }
    el.leadTime.value = String(settings.leadTimeMinutes);
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

  /* ----------------------------------------------------------------- boot */

  (async function init() {
    settings = await HTA.storage.getSettings();
    el.alertsEnabled.checked = settings.alertsEnabled;
    el.pageAlerts.checked = settings.pageAlerts;
    el.desktopAlerts.checked = settings.desktopAlerts;
    renderLeadTimes();
    renderTeams();
    renderChannelHint();
    await renderStatus();
  })();
})(typeof globalThis !== 'undefined' ? globalThis : self);
