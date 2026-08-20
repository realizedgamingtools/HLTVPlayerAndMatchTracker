/**
 * Storage access.
 *
 * MV3 service workers are killed aggressively, so storage — not a module-level
 * variable — is the source of truth for every piece of state that has to
 * survive a restart. Split by durability:
 *   sync    preferences the user set, worth carrying across devices
 *   local   delivery history, which is per-install operational state
 *   session notification click targets, which die with the browser anyway
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;

  const api = typeof chrome !== 'undefined' ? chrome : undefined;

  function area(name) {
    return api && api.storage && api.storage[name] ? api.storage[name] : null;
  }

  async function getSettings() {
    const sync = area('sync');
    const defaults = HTA.defaultSettings();
    if (!sync) return defaults;
    const stored = await sync.get(C.SYNC_KEY_SETTINGS);
    return Object.assign(defaults, stored && stored[C.SYNC_KEY_SETTINGS]);
  }

  async function saveSettings(settings) {
    const sync = area('sync');
    if (!sync) return;
    await sync.set({ [C.SYNC_KEY_SETTINGS]: settings });
  }

  async function getSentAlerts() {
    const local = area('local');
    if (!local) return {};
    const stored = await local.get(C.LOCAL_KEY_SENT_ALERTS);
    return (stored && stored[C.LOCAL_KEY_SENT_ALERTS]) || {};
  }

  async function saveSentAlerts(sentAlerts) {
    const local = area('local');
    if (!local) return;
    await local.set({ [C.LOCAL_KEY_SENT_ALERTS]: sentAlerts });
  }

  /**
   * Health record for the popup: when the last scan ran and what it saw.
   * Written by whichever tab scanned most recently.
   */
  async function getLastScan() {
    const local = area('local');
    if (!local) return null;
    const stored = await local.get(C.LOCAL_KEY_LAST_SCAN);
    return (stored && stored[C.LOCAL_KEY_LAST_SCAN]) || null;
  }

  async function saveLastScan(record) {
    const local = area('local');
    if (!local) return;
    await local.set({ [C.LOCAL_KEY_LAST_SCAN]: record });
  }

  /** Remember where a desktop notification should navigate when clicked. */
  async function rememberNotificationTarget(notificationId, url) {
    const session = area('session') || area('local');
    if (!session) return;
    const stored = await session.get(C.SESSION_KEY_NOTIFICATION_TARGETS);
    const targets = (stored && stored[C.SESSION_KEY_NOTIFICATION_TARGETS]) || {};
    targets[notificationId] = url;
    await session.set({ [C.SESSION_KEY_NOTIFICATION_TARGETS]: targets });
  }

  async function takeNotificationTarget(notificationId) {
    const session = area('session') || area('local');
    if (!session) return null;
    const stored = await session.get(C.SESSION_KEY_NOTIFICATION_TARGETS);
    const targets = (stored && stored[C.SESSION_KEY_NOTIFICATION_TARGETS]) || {};
    const url = targets[notificationId] || null;
    if (url) {
      delete targets[notificationId];
      await session.set({ [C.SESSION_KEY_NOTIFICATION_TARGETS]: targets });
    }
    return url;
  }

  HTA.storage = {
    getSettings,
    saveSettings,
    getSentAlerts,
    saveSentAlerts,
    getLastScan,
    saveLastScan,
    rememberNotificationTarget,
    takeNotificationTarget
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
