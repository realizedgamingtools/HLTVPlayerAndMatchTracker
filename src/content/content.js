/**
 * Content script entry point.
 *
 * Runs on HLTV pages and drives one pass of the v1 pipeline every 30 seconds:
 *
 *   parse the page -> generate alerts -> deliver -> record delivery state
 *
 * Deliberately thin. All decision-making lives in src/core, which has no DOM
 * or chrome.* dependency, so Phase 3 can move this same pipeline behind
 * chrome.alarms without rewriting the logic.
 */
(function (root) {
  'use strict';

  const HTA = root.HTA;
  const C = HTA.constants;

  let scanning = false;

  /**
   * Merge freshly recorded deliveries into whatever is in storage now.
   *
   * Several HLTV tabs can scan at once, each holding a snapshot of the history
   * it read at the start of its pass. Re-reading immediately before the write
   * and merging keys (rather than overwriting) keeps one tab from resurrecting
   * a key another tab just burned. Two tabs firing in the same instant can
   * still double-notify; Phase 3 removes the race by moving scanning into a
   * single background alarm.
   */
  async function persistDeliveries(nextHistory, now) {
    const current = await HTA.storage.getSentAlerts();
    const merged = HTA.alerts.pruneHistory(Object.assign({}, current, nextHistory), now);
    await HTA.storage.saveSentAlerts(merged);
  }

  /**
   * Open the match's stream in a popup window.
   *
   * The stream list lives on the match page, but alerts almost always fire
   * from the matches list, which has none. So this reads the snapshot taken
   * when the user last visited the match page and falls back to HLTV's own
   * player when there is nothing cached.
   */
  async function deliverStream(alert) {
    const matchId = alert.match && alert.match.id;
    let streams = [];
    try {
      const snapshot = await HTA.storage.getStreamSnapshot(matchId);
      if (snapshot && Array.isArray(snapshot.streams)) streams = snapshot.streams;
    } catch (error) {
      console.warn('[HLTV Team Alert] could not read stream snapshot', error);
    }

    const resolved = HTA.streams.resolveStreamUrl({
      streams,
      prefs: alert.effective,
      matchId,
      matchUrl: alert.match && alert.match.url
    });
    if (!resolved.url) return;

    chrome.runtime
      .sendMessage({
        type: C.MSG_OPEN_STREAM,
        target: { matchId, url: resolved.url }
      })
      .catch(() => {});
  }

  async function deliver(alert) {
    if (alert.channels.page) {
      HTA.notifier.showToast(alert);
    }
    if (alert.channels.stream) {
      await deliverStream(alert);
    }
    if (alert.channels.desktop) {
      // The service worker owns chrome.notifications; a content script cannot
      // call it. Fire and forget -- a dropped message must not break the scan.
      chrome.runtime
        .sendMessage({
          type: C.MSG_DESKTOP_NOTIFY,
          alert: {
            key: alert.key,
            title: alert.title,
            body: alert.body,
            status: alert.status,
            url: alert.match && alert.match.url
          }
        })
        .catch(() => {});
    }
  }

  /**
   * One full pass.
   * @param {string} trigger 'interval' | 'startup' | 'manual'
   */
  async function runScan(trigger) {
    if (scanning) return null;
    scanning = true;
    try {
      const now = Date.now();
      const [settings, followedTeams, matchRules, sentAlerts] = await Promise.all([
        HTA.storage.getSettings(),
        HTA.storage.getFollowedTeams(),
        HTA.storage.getMatchRules(),
        HTA.storage.getSentAlerts()
      ]);

      const parsed = HTA.parser.parseMatches(document, now);
      const { alerts, sentAlerts: nextHistory } = HTA.alerts.generateAlerts({
        matches: parsed.matches,
        settings,
        followedTeams,
        matchRules,
        now,
        sentAlerts
      });

      for (const alert of alerts) await deliver(alert);

      if (alerts.length > 0) await persistDeliveries(nextHistory, now);

      const record = {
        at: now,
        trigger,
        url: location.href,
        cardsSeen: parsed.cardsSeen,
        matchesParsed: parsed.matches.length,
        healthy: parsed.healthy,
        alertsFired: alerts.length,
        sourceVersion: C.SOURCE_VERSION
      };
      await HTA.storage.saveLastScan(record);
      return record;
    } catch (error) {
      // A parse or storage failure must not kill the interval; the next pass
      // gets a fresh chance, and the popup surfaces the failure.
      console.warn('[HLTV Team Alert] scan failed', error);
      await HTA.storage
        .saveLastScan({
          at: Date.now(),
          trigger,
          url: location.href,
          healthy: false,
          error: String((error && error.message) || error),
          sourceVersion: C.SOURCE_VERSION
        })
        .catch(() => {});
      return null;
    } finally {
      scanning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    // Manual scan from the popup's "Scan now" button.
    if (message.type === C.MSG_MANUAL_SCAN) {
      runScan('manual').then((record) => sendResponse({ type: C.MSG_SCAN_RESULT, record }));
      return true; // keep the message channel open for the async response
    }

    // Test alert from the popup. Goes through the real notifier, so a passing
    // test means the actual delivery path works, not a mock of it.
    if (message.type === C.MSG_TEST_ALERT) {
      HTA.notifier.showToast(message.alert);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  runScan('startup');
  setInterval(() => runScan('interval'), C.SCAN_INTERVAL_MS);
})(typeof globalThis !== 'undefined' ? globalThis : self);
