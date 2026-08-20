/**
 * On-page toast notifier.
 *
 * Builds every node with the DOM API rather than innerHTML: team and event
 * names come from a third-party page, and this code injects them back into
 * that same page. Passing them through textContent keeps a crafted team name
 * from becoming markup.
 */
(function (root) {
  'use strict';

  const HTA = (root.HTA = root.HTA || {});
  const C = HTA.constants;

  const STACK_ID = 'hta-toast-stack';
  const AUTO_DISMISS_MS = 20000;

  function ensureStack() {
    let stack = document.getElementById(STACK_ID);
    if (stack) return stack;

    stack = document.createElement('div');
    stack.id = STACK_ID;
    stack.className = 'hta-toast-stack';
    // Announce new toasts without stealing focus from the page.
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(stack);
    return stack;
  }

  /**
   * Render one alert as a toast.
   * @param {object} alert produced by HTA.alerts.generateAlerts
   */
  function showToast(alert) {
    if (!document.body) return;
    const stack = ensureStack();

    const toast = document.createElement('div');
    toast.className = 'hta-toast';
    if (alert.status === C.STATUS_LIVE) toast.classList.add('hta-toast--live');

    const body = document.createElement('div');
    body.className = 'hta-toast__body';

    const title = document.createElement('p');
    title.className = 'hta-toast__title';
    title.textContent = alert.title;

    const text = document.createElement('p');
    text.className = 'hta-toast__text';
    text.textContent = alert.body;

    body.append(title, text);

    if (alert.match && alert.match.url) {
      const link = document.createElement('a');
      link.className = 'hta-toast__link';
      link.href = alert.match.url;
      link.textContent = 'Open match on HLTV';
      link.rel = 'noopener noreferrer';
      body.appendChild(link);
    }

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'hta-toast__dismiss';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Dismiss alert');

    let timer = null;
    const remove = () => {
      if (timer) clearTimeout(timer);
      toast.remove();
      if (stack.childElementCount === 0) stack.remove();
    };

    dismiss.addEventListener('click', remove);
    toast.append(body, dismiss);
    stack.appendChild(toast);

    timer = setTimeout(remove, AUTO_DISMISS_MS);
  }

  HTA.notifier = { showToast };
})(typeof globalThis !== 'undefined' ? globalThis : self);
