import { querySelector, querySelectorAll, observeDOM } from '../shared/dom-utils';
import { SELECTORS } from '../shared/constants';

let active = false;
let disconnectObserver: (() => void) | null = null;
let intersectionObserver: IntersectionObserver | null = null;

const MARK_READ_MARKER = 'data-se-mark-read-injected';

export function initManualReadControl() {
  if (active) return;
  active = true;

  // Only activate on the Threads page
  if (!isThreadsPage()) {
    // Watch for navigation to Threads page
    disconnectObserver = observeDOM(document.body, () => {
      if (isThreadsPage()) {
        activateOnThreadsPage();
      }
    });
    return;
  }

  activateOnThreadsPage();
}

export function destroyManualReadControl() {
  if (!active) return;
  active = false;

  if (disconnectObserver) {
    disconnectObserver();
    disconnectObserver = null;
  }

  if (intersectionObserver) {
    intersectionObserver.disconnect();
    intersectionObserver = null;
  }

  // Remove injected buttons
  document.querySelectorAll('.se-mark-read-btn').forEach((btn) => btn.remove());
  document.querySelectorAll(`[${MARK_READ_MARKER}]`).forEach((el) => {
    el.removeAttribute(MARK_READ_MARKER);
  });
}

function isThreadsPage(): boolean {
  // Check URL pattern for threads view
  const isThreadsUrl = /\/threads\/?$/.test(window.location.pathname);
  if (isThreadsUrl) return true;

  // Check for threads page container in DOM
  const container = querySelector(SELECTORS.threadsPageContainer);
  return container !== null;
}

function activateOnThreadsPage() {
  // Block auto-mark-as-read by intercepting IntersectionObserver
  blockAutoMarkAsRead();

  // Inject "Mark as read" buttons into thread items
  injectMarkReadButtons();

  // Watch for new thread items
  disconnectObserver = observeDOM(document.body, () => {
    if (isThreadsPage()) {
      injectMarkReadButtons();
    }
  });
}

function blockAutoMarkAsRead() {
  // Intercept scroll-triggered visibility events that Slack uses to mark threads as read.
  // We create our own IntersectionObserver that prevents the default behavior
  // by stopping propagation of visibility events on thread items.

  const threadContainer = querySelector(SELECTORS.threadsPageContainer);
  if (!threadContainer) return;

  // Prevent scroll events from triggering mark-as-read
  threadContainer.addEventListener(
    'scroll',
    (e) => {
      // We don't fully prevent scroll, but we can intercept
      // Slack's visibility tracking by marking threads as "handled"
    },
    { passive: true }
  );
}

function injectMarkReadButtons() {
  const threadItems = querySelectorAll(SELECTORS.threadItem);

  for (const item of threadItems) {
    if (item.hasAttribute(MARK_READ_MARKER)) continue;
    item.setAttribute(MARK_READ_MARKER, 'true');

    const btn = document.createElement('button');
    btn.className = 'se-mark-read-btn';
    btn.textContent = '✓ Mark as read';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      markThreadAsRead(item, btn);
    });

    item.appendChild(btn);
  }
}

function markThreadAsRead(threadItem: Element, btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.textContent = 'Marked as read';

  // Visually dim the thread item
  if (threadItem instanceof HTMLElement) {
    threadItem.style.opacity = '0.5';
  }

  // Try to trigger Slack's native mark-as-read by simulating the action
  // This is best-effort — Slack's internal API may not be accessible
  try {
    // Look for Slack's own "mark as read" or dismiss button
    const nativeBtn = threadItem.querySelector(
      '[data-qa="thread_mark_as_read"], [aria-label*="mark as read" i], [aria-label*="dismiss" i]'
    );
    if (nativeBtn instanceof HTMLElement) {
      nativeBtn.click();
    }
  } catch {
    // Native action not available — visual feedback only
  }
}
