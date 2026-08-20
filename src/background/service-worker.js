/**
 * Service worker.
 *
 * Owns the two things a content script cannot do: create desktop notifications
 * and open a tab when one is clicked.
 *
 * MV3 terminates this worker whenever it is idle, so it holds no state in
 * module scope. The URL a notification should open is written to session
 * storage at creation time and read back on click, which survives the worker
 * being torn down between the two events.
 */
'use strict';

// Extension-root-relative so resolution does not depend on this file's depth.
importScripts('/src/shared/constants.js', '/src/shared/storage.js');

const HTA = self.HTA;
const C = HTA.constants;

const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

/** Notification ids must be unique per delivery but stable within one alert. */
function notificationId(alertKey) {
  return `hta:${alertKey}`;
}

async function showDesktopNotification(alert) {
  const id = notificationId(alert.key);

  if (alert.url) {
    await HTA.storage.rememberNotificationTarget(id, alert.url);
  }

  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: ICON_URL,
    title: alert.title,
    message: alert.body,
    // Live matches are the time-critical case; let them sit until dismissed.
    requireInteraction: alert.status === C.STATUS_LIVE,
    silent: false
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== C.MSG_DESKTOP_NOTIFY) return false;

  showDesktopNotification(message.alert)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      // Most often the OS or browser has notifications switched off. The
      // on-page toast still fired, so this is reported, not thrown.
      console.warn('[HLTV Team Alert] desktop notification failed', error);
      sendResponse({ ok: false, error: String((error && error.message) || error) });
    });

  return true; // async response
});

chrome.notifications.onClicked.addListener(async (id) => {
  const url = await HTA.storage.takeNotificationTarget(id);
  if (url) await chrome.tabs.create({ url });
  await chrome.notifications.clear(id);
});

chrome.notifications.onClosed.addListener(async (id) => {
  // Drop the stored target so dismissed notifications do not accumulate.
  await HTA.storage.takeNotificationTarget(id);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  // Seed defaults on first install so the popup opens in a known state.
  if (details.reason === 'install') {
    const settings = await HTA.storage.getSettings();
    await HTA.storage.saveSettings(settings);
  }
});
