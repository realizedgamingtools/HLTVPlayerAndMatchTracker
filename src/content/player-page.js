/**
 * Player-page follow control.
 *
 * Runs on /player/<id>/<slug>. Adds a Follow button beside the player's name
 * and, once followed, controls for the two things worth being told about:
 *
 *   - their team playing a match
 *   - their own channel going live
 *
 * The profile hands us everything needed for both: HLTV's stable player id, the
 * nickname and real name, the current team, and the social links, from which
 * the broadcast channels are extracted. Non-broadcast socials are discarded —
 * a Twitter account says nothing about whether someone is streaming.
 */
(function (root) {
  'use strict';

  const HTA = root.HTA;
  const C = HTA.constants;

  const PANEL_ID = 'hta-player-panel';
  const INHERIT = '';

  const playerId = (/\/player\/(\d+)/.exec(location.pathname) || [])[1] || null;
  const slug = (/\/player\/\d+\/([^/?#]+)/.exec(location.pathname) || [])[1] || null;

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

  /** The player's current team, from the info row that links to /team/<id>. */
  function readTeam() {
    const row = document.querySelector('.playerTeam');
    const link = row && row.querySelector('a[href*="/team/"]');
    if (!link) return { teamId: null, teamName: null };
    return {
      teamId: (/\/team\/(\d+)/.exec(link.getAttribute('href') || '') || [])[1] || null,
      teamName: link.textContent.trim() || null
    };
  }

  /** Every outbound social link; players.toChannels keeps only broadcasts. */
  function readSocialUrls() {
    const box = document.querySelector('.socialMediaButtons');
    if (!box) return [];
    return [...box.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  }

  function describeChannels(channels) {
    if (!channels || channels.length === 0) return 'No personal stream listed on this profile.';
    return channels
      .map((c) => `${C.PLATFORM_LABELS[c.platform] || c.platform}: ${c.channel}`)
      .join(', ');
  }

  async function build() {
    if (!playerId) return;
    if (document.getElementById(PANEL_ID)) return;

    const nickEl = document.querySelector('.playerNickname');
    if (!nickEl) return;
    const nickname = nickEl.textContent.trim();
    if (!nickname) return;

    const realnameEl = document.querySelector('.playerRealname');
    const { teamId, teamName } = readTeam();

    const identity = {
      id: playerId,
      nickname,
      realname: realnameEl ? realnameEl.textContent.trim() : null,
      slug,
      teamId,
      teamName,
      channelUrls: readSocialUrls()
    };
    const channels = HTA.players.toChannels(identity.channelUrls);

    let [settings, followedPlayers] = await Promise.all([
      HTA.storage.getSettings(),
      HTA.storage.getFollowedPlayers()
    ]);

    /* --------------------------------------------------------------- markup */

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'hta-panel';
    panel.setAttribute('aria-label', `Player & Match Tracker for HLTV settings for ${nickname}`);

    const header = document.createElement('div');
    header.className = 'hta-panel__header';

    const brand = document.createElement('p');
    brand.className = 'hta-panel__brand';

    const logo = document.createElement('img');
    logo.className = 'hta-panel__logo';
    logo.src = chrome.runtime.getURL('icons/brand48.png');
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

    const watchBtn = document.createElement('button');
    watchBtn.type = 'button';
    watchBtn.className = 'hta-btn';
    watchBtn.textContent = 'Open their stream';

    actions.append(followBtn, watchBtn);

    const grid = document.createElement('div');
    grid.className = 'hta-panel__grid';

    // The two interests are separate switches, not one, because wanting to know
    // when someone streams is not the same as wanting every fixture they play.
    const matchField = buildSelect(
      'hta-player-match',
      'When their team plays',
      [
        ['true', 'Alert me'],
        ['false', 'Do not alert me']
      ],
      'true'
    );

    const streamField = buildSelect(
      'hta-player-stream',
      'When they go live',
      [
        ['true', 'Alert me'],
        ['false', 'Do not alert me']
      ],
      'true'
    );

    const leadField = buildSelect(
      'hta-player-lead',
      'Notify me before matches',
      [[INHERIT, 'Use default']].concat(C.LEAD_TIME_CHOICES.map((m) => [String(m), leadLabel(m)])),
      INHERIT
    );

    const openField = buildSelect(
      'hta-player-open',
      'Open their stream when live',
      [
        [INHERIT, 'Use default'],
        ['true', 'Yes, pop it open'],
        ['false', 'No']
      ],
      INHERIT
    );

    grid.append(matchField.wrap, streamField.wrap, leadField.wrap, openField.wrap);

    const options = document.createElement('div');
    options.className = 'hta-panel__options';
    options.append(grid);

    body.append(title, status, actions, options);
    panel.append(header, body);

    // Directly under the header card, where a follow control is expected.
    //
    // Not after .playerProfile: that wraps the whole profile -- header,
    // trophies, tabs and ~1600px of statistics -- so appending after it put the
    // panel 2248px down a 3993px page, well below the fold and effectively
    // invisible. The header card is the small block at the top.
    const mount = (() => {
      const profile = document.querySelector('.playerProfile');
      const headerCard = profile && profile.querySelector('.playerContainer');
      if (profile && headerCard) return { parent: profile, before: headerCard.nextSibling };

      const box = nickEl.closest('.standard-box') || nickEl.parentElement;
      if (box && box.parentElement) return { parent: box.parentElement, before: box.nextSibling };
      return null;
    })();
    if (!mount) return;
    mount.parent.insertBefore(panel, mount.before);

    /* ------------------------------------------------------------ behaviour */

    const fields = [matchField, streamField, leadField, openField];

    function currentRecord() {
      const found = HTA.players.findPlayer(followedPlayers, identity);
      return found ? found.player : null;
    }

    function refresh() {
      const record = currentRecord();
      const following = record !== null;
      const known = record ? record.channels || [] : channels;

      title.textContent = following ? `Following ${nickname}` : `Alert me about ${nickname}`;
      followBtn.textContent = following ? 'Unfollow' : `Follow ${nickname}`;
      followBtn.classList.toggle('hta-btn--primary', !following);
      options.hidden = !following;

      badge.textContent = following ? 'Following' : 'Not following';
      badge.classList.toggle('hta-panel__badge--custom', following);

      // Nothing to open when the profile lists no broadcast channel.
      watchBtn.hidden = known.length === 0;

      if (!following) {
        const team = teamName ? ` Plays for ${teamName}.` : '';
        status.textContent = `Follow ${nickname} to be alerted when they play or stream.${team}`;
        return;
      }

      matchField.select.value = record.alertOnMatch === false ? 'false' : 'true';
      streamField.select.value = record.alertOnStream === false ? 'false' : 'true';
      leadField.select.value = fromStored(record.leadTimeMinutes);
      openField.select.value = fromStored(record.openStream);

      const effective = HTA.rules.resolveRule(settings, { team: record });
      const parts = [];
      if (record.alertOnMatch !== false) {
        parts.push(
          teamName
            ? effective.leadTimeMinutes === 0
              ? `Alerting when ${teamName} go live`
              : `Alerting ${effective.leadTimeMinutes} min before ${teamName} play`
            : 'Alerting for their matches, but no current team is listed'
        );
      }
      if (record.alertOnStream !== false) {
        parts.push(known.length > 0 ? `Watching ${describeChannels(known)}` : 'No stream to watch');
      }
      status.textContent =
        parts.length > 0 ? `${parts.join('. ')}.` : 'Following, but both alerts are switched off.';
    }

    async function persist() {
      followedPlayers = HTA.players.setPlayerRule(followedPlayers, identity, {
        alertOnMatch: matchField.select.value === 'true',
        alertOnStream: streamField.select.value === 'true',
        leadTimeMinutes: toStored(leadField.select.value, Number),
        openStream: toStored(openField.select.value, (v) => v === 'true')
      });
      await HTA.storage.saveFollowedPlayers(followedPlayers);
      refresh();
    }

    followBtn.addEventListener('click', async () => {
      followBtn.disabled = true;
      // Re-read first: the popup may have changed follows in another tab.
      followedPlayers = await HTA.storage.getFollowedPlayers();
      followedPlayers = currentRecord()
        ? HTA.players.unfollowPlayer(followedPlayers, identity)
        : HTA.players.followPlayer(followedPlayers, identity, Date.now());
      await HTA.storage.saveFollowedPlayers(followedPlayers);
      refresh();
      followBtn.disabled = false;
    });

    watchBtn.addEventListener('click', () => {
      const record = currentRecord();
      const known = (record && record.channels) || channels;
      const url = known.length > 0 ? HTA.streamers.watchUrl(known[0]) : null;
      if (!url) return;
      chrome.runtime
        .sendMessage({ type: C.MSG_OPEN_STREAM, target: { matchId: `player:${playerId}`, url } })
        .catch(() => {});
    });

    for (const field of fields) field.select.addEventListener('change', persist);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes[C.SYNC_KEY_FOLLOWED_PLAYERS]) {
        followedPlayers = changes[C.SYNC_KEY_FOLLOWED_PLAYERS].newValue || {};
        refresh();
      }
      if (changes[C.SYNC_KEY_SETTINGS]) {
        settings = Object.assign(HTA.defaultSettings(), changes[C.SYNC_KEY_SETTINGS].newValue);
        refresh();
      }
    });

    refresh();
  }

  build().catch((error) => console.warn('[HLTV Tracker] player panel failed', error));
})(typeof globalThis !== 'undefined' ? globalThis : self);
