/**
 * Team-page follow control.
 *
 * Runs on /team/<id>/<slug>. Adds a Follow button beside the team's name and,
 * once followed, a panel for how that team should alert.
 *
 * This is the primary way to follow a team: the user is already looking at the
 * team they care about, and the page hands us HLTV's stable team id, the
 * canonical spelling of the name, and the slug. Typing a name into the popup
 * still works, but it cannot capture identity — a name-only follow is upgraded
 * in place the first time its profile is opened.
 *
 * Every option offers "Use default", which stores null and inherits the global
 * setting, so pinning one field for a team does not freeze the rest.
 */
(function (root) {
  'use strict';

  const HTA = root.HTA;
  const C = HTA.constants;

  const PANEL_ID = 'hta-team-panel';
  const INHERIT = '';

  const teamId = (/\/team\/(\d+)/.exec(location.pathname) || [])[1] || null;
  const slug = (/\/team\/\d+\/([^/?#]+)/.exec(location.pathname) || [])[1] || null;

  function buildSelect(id, labelText, options, value) {
    const wrap = document.createElement('div');
    wrap.className = 'hta-field';

    const label = document.createElement('label');
    label.className = 'hta-field__label';
    label.setAttribute('for', id);
    label.textContent = labelText;

    const select = document.createElement('select');
    select.className = 'hta-field__select';
    select.id = id;

    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      select.appendChild(option);
    }
    select.value = value;

    wrap.append(label, select);
    return { wrap, select };
  }

  const toStored = (raw, parse) => (raw === INHERIT ? null : parse ? parse(raw) : raw);
  const fromStored = (v) => (v === null || v === undefined ? INHERIT : String(v));

  function leadLabel(minutes) {
    if (minutes === 0) return 'Only once they are live';
    if (minutes >= 60) return '1 hour before';
    return `${minutes} minutes before`;
  }

  /** Upcoming fixtures HLTV already lists on the profile. */
  function readUpcoming() {
    const table = document.querySelector('.match-table');
    if (!table) return [];
    const rows = [];
    for (const row of table.querySelectorAll('tr')) {
      const link = row.querySelector('a[href*="/matches/"]');
      const unixEl = row.querySelector('[data-unix]');
      if (!link || !unixEl) continue;
      const startTime = Number(unixEl.getAttribute('data-unix'));
      if (!Number.isFinite(startTime) || startTime < Date.now()) continue;
      rows.push({ startTime, url: link.getAttribute('href') });
      if (rows.length >= 3) break;
    }
    return rows;
  }

  function describeNext(upcoming) {
    if (upcoming.length === 0) return 'No upcoming matches listed.';
    const mins = Math.round((upcoming[0].startTime - Date.now()) / 60000);
    if (mins < 60) return `Next match in ${mins} min.`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `Next match in ${hours}h.`;
    return `Next match in ${Math.round(hours / 24)}d.`;
  }

  async function build() {
    if (!teamId) return;
    if (document.getElementById(PANEL_ID)) return;

    const nameEl = document.querySelector('.profile-team-name');
    const container = document.querySelector('.profile-team-container');
    if (!nameEl || !container) return;

    const name = nameEl.textContent.trim();
    if (!name) return;

    const identity = { id: teamId, name, slug };
    const upcoming = readUpcoming();

    let [settings, followedTeams] = await Promise.all([
      HTA.storage.getSettings(),
      HTA.storage.getFollowedTeams()
    ]);

    /* --------------------------------------------------------------- markup */

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'hta-panel';
    panel.setAttribute('aria-label', `Player & Match Tracker for HLTV settings for ${name}`);

    // Header carries the extension's name so the panel never reads as one of
    // HLTV's own controls.
    const header = document.createElement('div');
    header.className = 'hta-panel__header';

    const brand = document.createElement('p');
    brand.className = 'hta-panel__brand';

    const logo = document.createElement('img');
    logo.className = 'hta-panel__logo';
    logo.src = chrome.runtime.getURL('icons/icon48.png');
    logo.alt = '';
    brand.append(logo, document.createTextNode('Realized Tools'));

    const badge = document.createElement('span');
    badge.className = 'hta-panel__badge';

    header.append(brand, badge);

    const body = document.createElement('div');
    body.className = 'hta-panel__body';

    const title = document.createElement('h3');
    title.className = 'hta-panel__title';

    const status = document.createElement('p');
    status.className = 'hta-panel__preview';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'hta-panel__actions';

    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'hta-btn hta-btn--primary';
    actions.append(followBtn);

    const grid = document.createElement('div');
    grid.className = 'hta-panel__grid';

    const leadField = buildSelect(
      'hta-team-lead',
      'Notify me',
      [[INHERIT, 'Use default']].concat(C.LEAD_TIME_CHOICES.map((m) => [String(m), leadLabel(m)])),
      INHERIT
    );

    const openField = buildSelect(
      'hta-team-open',
      'Open the stream when live',
      [
        [INHERIT, 'Use default'],
        ['true', 'Yes, pop it open'],
        ['false', 'No']
      ],
      INHERIT
    );

    const platformField = buildSelect(
      'hta-team-platform',
      'Preferred platform',
      [
        [INHERIT, 'Use default'],
        [C.ANY, 'Any platform']
      ].concat(C.STREAM_PLATFORMS.map((p) => [p, C.PLATFORM_LABELS[p] || p])),
      INHERIT
    );

    const mutedField = buildSelect(
      'hta-team-enabled',
      'Alerts for this team',
      [
        [INHERIT, 'Use default'],
        ['true', 'On'],
        ['false', 'Muted']
      ],
      INHERIT
    );

    grid.append(mutedField.wrap, leadField.wrap, openField.wrap, platformField.wrap);

    const options = document.createElement('div');
    options.className = 'hta-panel__options';
    options.append(grid);

    body.append(title, status, actions, options);
    panel.append(header, body);

    // Sits directly under the team's name block, where a follow control is
    // expected, rather than at the bottom of the page.
    const anchor = container.parentElement || container;
    anchor.parentElement.insertBefore(panel, anchor.nextSibling);

    /* ------------------------------------------------------------ behaviour */

    const fields = [mutedField, leadField, openField, platformField];

    function currentRecord() {
      const found = HTA.teams.findTeam(followedTeams, identity);
      return found ? found.team : null;
    }

    function refresh() {
      const record = currentRecord();
      const following = record !== null;

      title.textContent = following ? `Following ${name}` : `Alert me about ${name}`;
      followBtn.textContent = following ? 'Unfollow' : `Follow ${name}`;
      followBtn.classList.toggle('hta-btn--primary', !following);
      options.hidden = !following;

      badge.textContent = following ? 'Following' : 'Not following';
      badge.classList.toggle('hta-panel__badge--custom', following);

      if (!following) {
        status.textContent = `Follow ${name} to be alerted when they play. ${describeNext(upcoming)}`;
        return;
      }

      // Populate from the stored record so a reload shows what was saved.
      mutedField.select.value = fromStored(record.enabled);
      leadField.select.value = fromStored(record.leadTimeMinutes);
      openField.select.value = fromStored(record.openStream);
      platformField.select.value = fromStored(record.streamPlatform);

      const effective = HTA.rules.resolveRule(settings, { team: record });
      const when =
        effective.enabled === false
          ? 'Muted — no alerts for this team'
          : effective.leadTimeMinutes === 0
            ? 'Alerting when they go live'
            : `Alerting ${effective.leadTimeMinutes} min before they play`;
      const stream = effective.openStream ? ', stream opens automatically' : '';
      status.textContent = `${when}${stream}. ${describeNext(upcoming)}`;
    }

    async function persistRule() {
      followedTeams = HTA.teams.setTeamRule(followedTeams, identity, {
        enabled: toStored(mutedField.select.value, (v) => v === 'true'),
        leadTimeMinutes: toStored(leadField.select.value, Number),
        openStream: toStored(openField.select.value, (v) => v === 'true'),
        streamPlatform: toStored(platformField.select.value)
      });
      await HTA.storage.saveFollowedTeams(followedTeams);
      refresh();
    }

    followBtn.addEventListener('click', async () => {
      followBtn.disabled = true;
      // Re-read first: the popup may have changed follows in another tab.
      followedTeams = await HTA.storage.getFollowedTeams();
      followedTeams = currentRecord()
        ? HTA.teams.unfollowTeam(followedTeams, identity)
        : HTA.teams.followTeam(followedTeams, identity, Date.now());
      await HTA.storage.saveFollowedTeams(followedTeams);
      refresh();
      followBtn.disabled = false;
    });

    for (const field of fields) field.select.addEventListener('change', persistRule);

    // Keep in step with changes made in the popup or another tab.
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes[C.SYNC_KEY_FOLLOWED_TEAMS]) {
        followedTeams = changes[C.SYNC_KEY_FOLLOWED_TEAMS].newValue || {};
        refresh();
      }
      if (changes[C.SYNC_KEY_SETTINGS]) {
        settings = Object.assign(HTA.defaultSettings(), changes[C.SYNC_KEY_SETTINGS].newValue);
        refresh();
      }
    });

    refresh();
  }

  build().catch((error) => console.warn('[HLTV Tracker] team panel failed', error));
})(typeof globalThis !== 'undefined' ? globalThis : self);
