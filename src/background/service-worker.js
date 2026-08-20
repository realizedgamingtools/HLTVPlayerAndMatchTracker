/**
 * Service worker.
 *
 * Owns the three things a content script cannot do: create desktop
 * notifications, open a tab when one is clicked, and open the stream popup
 * window.
 *
 * MV3 terminates this worker whenever it is idle, so it holds no state in
 * module scope. Both the URL a notification should open and the id of an
 * already-open stream window are written to session storage and read back
 * later, which survives the worker being torn down between the two events.
 */
'use strict';

// Extension-root-relative so resolution does not depend on this file's depth.
// storage.js migrates v1 follows through core/teams.js, which needs normalize,
// so both come along even though the worker never calls them directly today.
importScripts(
  '/src/shared/constants.js',
  '/src/core/normalize.js',
  '/src/core/teams.js',
  '/src/shared/storage.js'
);

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

/* ------------------------------------------------------------ stream popup */

const STREAM_WINDOWS_KEY = 'streamWindows';

async function readStreamWindows() {
  const area = chrome.storage.session || chrome.storage.local;
  const stored = await area.get(STREAM_WINDOWS_KEY);
  return (stored && stored[STREAM_WINDOWS_KEY]) || {};
}

async function writeStreamWindows(windows) {
  const area = chrome.storage.session || chrome.storage.local;
  await area.set({ [STREAM_WINDOWS_KEY]: windows });
}

/**
 * Open a stream in a popup window, reusing the window already showing this
 * match if there is one.
 *
 * Without the reuse check, a user who clicks "Watch now" twice, or has two
 * HLTV tabs open, ends up with a pile of identical player windows.
 */
async function openStreamWindow({ matchId, url }) {
  if (!url) return { ok: false, error: 'no stream url' };

  const windows = await readStreamWindows();
  const existingId = matchId ? windows[matchId] : undefined;

  if (existingId !== undefined) {
    try {
      // Throws if the user already closed it, which is the signal to open anew.
      await chrome.windows.update(existingId, { focused: true });
      return { ok: true, reused: true, windowId: existingId };
    } catch {
      delete windows[matchId];
    }
  }

  const created = await chrome.windows.create({
    url,
    type: 'popup',
    width: C.STREAM_POPUP_WIDTH,
    height: C.STREAM_POPUP_HEIGHT
  });

  if (matchId && created && typeof created.id === 'number') {
    windows[matchId] = created.id;
    await writeStreamWindows(windows);
  }

  return { ok: true, reused: false, windowId: created && created.id };
}

// Forget windows the user closes, so the map does not grow unbounded.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const windows = await readStreamWindows();
  let changed = false;
  for (const [matchId, id] of Object.entries(windows)) {
    if (id === windowId) {
      delete windows[matchId];
      changed = true;
    }
  }
  if (changed) await writeStreamWindows(windows);
});

/* ---------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === C.MSG_DESKTOP_NOTIFY) {
    showDesktopNotification(message.alert)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        // Most often the OS or browser has notifications switched off. The
        // on-page toast still fired, so this is reported, not thrown.
        console.warn('[HLTV Team Alert] desktop notification failed', error);
        sendResponse({ ok: false, error: String((error && error.message) || error) });
      });
    return true; // async response
  }

  if (message.type === C.MSG_OPEN_STREAM) {
    openStreamWindow(message.target || {})
      .then(sendResponse)
      .catch((error) => {
        console.warn('[HLTV Team Alert] stream popup failed', error);
        sendResponse({ ok: false, error: String((error && error.message) || error) });
      });
    return true; // async response
  }

  return false;
});

/* ------------------------------------------------------------ notifications */

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
