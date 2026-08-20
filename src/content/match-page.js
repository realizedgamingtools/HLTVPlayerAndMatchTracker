/**
 * Match-page controls.
 *
 * Runs only on /matches/<id>/<slug>. Does two jobs:
 *
 *   1. Snapshots the page's stream list, so an alert firing later — from the
 *      matches list, which carries no stream data — can still open the user's
 *      preferred broadcast.
 *   2. Injects a panel letting the user configure this one match: whether to
 *      alert, how far ahead, whether to open the stream, and which platform
 *      and language to prefer.
 *
 * Every control offers "Use default", which stores null and inherits the global
 * setting. That is what keeps a per-match tweak from silently freezing the rest
 * of the user's preferences for that match.
 */
(function (root) {
  'use strict';

  const HTA = root.HTA;
  const C = HTA.constants;

  const PANEL_ID = 'hta-match-panel';
  const INHERIT = '';

  const matchId = (/\/matches\/(\d+)/.exec(location.pathname) || [])[1] || null;

  /** Build a labelled <select>. Options are [value, label] pairs. */
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

  /** null (inherit) <-> "" for select values. */
  function toStored(raw, parse) {
    if (raw === INHERIT) return null;
    return parse ? parse(raw) : raw;
  }

  function fromStored(value) {
    return value === null || value === undefined ? INHERIT : String(value);
  }

  function leadLabel(minutes) {
    if (minutes === 0) return 'Only once it is live';
    if (minutes >= 60) return '1 hour before';
    return `${minutes} minutes before`;
  }

  function describeStream(stream) {
    if (!stream) return null;
    const bits = [stream.name];
    if (stream.platform) bits.push(`on ${stream.platform}`);
    const detail = [];
    if (stream.country) detail.push(stream.country);
    if (typeof stream.viewers === 'number') {
      detail.push(`${stream.viewers.toLocaleString()} viewers`);
    }
    return detail.length > 0 ? `${bits.join(' ')} — ${detail.join(', ')}` : bits.join(' ');
  }

  /** Where to put the panel: above the stream list, or failing that, high up. */
  function findMountPoint() {
    const streams = document.querySelector('.streams');
    if (streams && streams.parentElement) {
      return { parent: streams.parentElement, before: streams };
    }
    const fallback = document.querySelector('.match-page') || document.querySelector('.contentCol');
    if (fallback) return { parent: fallback, before: fallback.firstChild };
    return null;
  }

  async function build() {
    if (!matchId) return;
    if (document.getElementById(PANEL_ID)) return;

    const mount = findMountPoint();
    if (!mount) return;

    const streams = HTA.streams.parseStreams(document);
    const now = Date.now();

    // Snapshot before touching the DOM: the panel is a nicety, the snapshot is
    // what makes the popup work later.
    if (streams.length > 0) {
      try {
        await HTA.storage.saveStreamSnapshot(matchId, streams, now);
      } catch (error) {
        console.warn('[HLTV Team Alert] could not save stream snapshot', error);
      }
    }

    const [settings, matchRules] = await Promise.all([
      HTA.storage.getSettings(),
      HTA.storage.getMatchRules()
    ]);
    const rule = Object.assign(HTA.defaultMatchRule(), matchRules[matchId]);

    /* ------------------------------------------------------------- markup */

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'hta-panel';
    panel.setAttribute('aria-label', 'HLTV Team Alert settings for this match');

    const header = document.createElement('div');
    header.className = 'hta-panel__header';
    const title = document.createElement('h3');
    title.className = 'hta-panel__title';
    title.textContent = 'Alert me about this match';
    const badge = document.createElement('span');
    badge.className = 'hta-panel__badge';
    header.append(title, badge);

    const grid = document.createElement('div');
    grid.className = 'hta-panel__grid';

    const alertField = buildSelect(
      'hta-match-enabled',
      'Alerts for this match',
      [
        [INHERIT, 'Use default'],
        ['true', 'On'],
        ['false', 'Off']
      ],
      fromStored(rule.enabled)
    );

    const leadField = buildSelect(
      'hta-match-lead',
      'Notify me',
      [[INHERIT, 'Use default']].concat(C.LEAD_TIME_CHOICES.map((m) => [String(m), leadLabel(m)])),
      fromStored(rule.leadTimeMinutes)
    );

    const openField = buildSelect(
      'hta-match-open',
      'Open the stream when live',
      [
        [INHERIT, 'Use default'],
        ['true', 'Yes, pop it open'],
        ['false', 'No']
      ],
      fromStored(rule.openStream)
    );

    // Only offer platforms and languages this match actually broadcasts in.
    const platformField = buildSelect(
      'hta-match-platform',
      'Preferred platform',
      [
        [INHERIT, 'Use default'],
        [C.ANY, 'Any platform']
      ].concat(HTA.streams.platformsIn(streams).map((p) => [p, p[0].toUpperCase() + p.slice(1)])),
      fromStored(rule.streamPlatform)
    );

    const countryField = buildSelect(
      'hta-match-country',
      'Preferred language',
      [
        [INHERIT, 'Use default'],
        [C.ANY, 'Any language']
      ].concat(HTA.streams.countriesIn(streams).map((c) => [c, c])),
      fromStored(rule.streamCountry)
    );

    grid.append(
      alertField.wrap,
      leadField.wrap,
      openField.wrap,
      platformField.wrap,
      countryField.wrap
    );

    const preview = document.createElement('p');
    preview.className = 'hta-panel__preview';
    preview.setAttribute('role', 'status');
    preview.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'hta-panel__actions';

    const watchNow = document.createElement('button');
    watchNow.type = 'button';
    watchNow.className = 'hta-btn hta-btn--primary';
    watchNow.textContent = 'Watch now';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'hta-btn';
    reset.textContent = 'Use defaults';

    actions.append(watchNow, reset);
    panel.append(header, grid, preview, actions);

    mount.parent.insertBefore(panel, mount.before);

    /* ------------------------------------------------------------ behaviour */

    function currentPrefs() {
      return {
        streamPlatform: platformField.select.value === INHERIT
          ? settings.streamPlatform
          : platformField.select.value,
        streamCountry: countryField.select.value === INHERIT
          ? settings.streamCountry
          : countryField.select.value
      };
    }

    function refresh() {
      const custom = [
        alertField.select.value,
        leadField.select.value,
        openField.select.value,
        platformField.select.value,
        countryField.select.value
      ].filter((v) => v !== INHERIT).length;

      badge.textContent = custom > 0 ? `${custom} customised` : 'Using defaults';
      badge.classList.toggle('hta-panel__badge--custom', custom > 0);

      if (streams.length === 0) {
        preview.textContent =
          'No streams listed yet. When this goes live the extension will open HLTV Live.';
        return;
      }

      const picked = HTA.streams.pickStream(streams, currentPrefs());
      const description = describeStream(picked.stream);
      const caveats = [];
      if (picked.fellBack.platform) caveats.push('that platform is not broadcasting this match');
      if (picked.fellBack.country) caveats.push('that language is not available');

      preview.textContent = caveats.length > 0
        ? `Would open ${description} — ${caveats.join(', ')}.`
        : `Would open ${description}.`;
    }

    async function persist() {
      const rules = HTA.rules.setMatchRule(await HTA.storage.getMatchRules(), matchId, {
        enabled: toStored(alertField.select.value, (v) => v === 'true'),
        leadTimeMinutes: toStored(leadField.select.value, Number),
        openStream: toStored(openField.select.value, (v) => v === 'true'),
        streamPlatform: toStored(platformField.select.value),
        streamCountry: toStored(countryField.select.value)
      });
      await HTA.storage.saveMatchRules(rules);
      refresh();
    }

    for (const field of [alertField, leadField, openField, platformField, countryField]) {
      field.select.addEventListener('change', persist);
    }

    watchNow.addEventListener('click', () => {
      const resolved = HTA.streams.resolveStreamUrl({
        streams,
        prefs: currentPrefs(),
        matchId,
        matchUrl: location.href
      });
      if (!resolved.url) return;
      chrome.runtime
        .sendMessage({ type: C.MSG_OPEN_STREAM, target: { matchId, url: resolved.url } })
        .catch(() => {});
    });

    reset.addEventListener('click', async () => {
      for (const field of [alertField, leadField, openField, platformField, countryField]) {
        field.select.value = INHERIT;
      }
      await HTA.storage.saveMatchRules(
        HTA.rules.clearMatchRule(await HTA.storage.getMatchRules(), matchId)
      );
      refresh();
    });

    refresh();
  }

  build().catch((error) => console.warn('[HLTV Team Alert] match panel failed', error));
})(typeof globalThis !== 'undefined' ? globalThis : self);
