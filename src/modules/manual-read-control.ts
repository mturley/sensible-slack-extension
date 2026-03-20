import { observeDOM } from '../shared/dom-utils';

let active = false;
let disconnectObserver: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wasOnThreadsPage = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let blockedCount = 0;
let interceptListener: ((e: Event) => void) | null = null;
let capturedToken: { token: string; url: string } | null = null;
// Store the full blocked request params per thread (channel-threadTs -> params)
const blockedRequests = new Map<string, { token: string; url: string; channel: string; thread_ts: string; ts: string }>();

export function initManualReadControl() {
  if (active) return;
  active = true;

  // Listen for blocked mark-as-read events from the MAIN world script
  interceptListener = (e: Event) => {
    blockedCount++;
    showToast(
      `Auto-mark-as-read blocked (${blockedCount} thread${blockedCount > 1 ? 's' : ''})`
    );

    // Capture token and per-thread params from the intercepted request
    try {
      const detail = JSON.parse((e as CustomEvent).detail);
      if (detail.token && detail.url) {
        capturedToken = { token: detail.token, url: detail.url };
      }
      if (detail.channel && detail.thread_ts && detail.ts) {
        const key = `${detail.channel}-${detail.thread_ts}`;
        // Keep the latest ts for each thread
        const existing = blockedRequests.get(key);
        if (!existing || detail.ts > existing.ts) {
          blockedRequests.set(key, {
            token: detail.token,
            url: detail.url,
            channel: detail.channel,
            thread_ts: detail.thread_ts,
            ts: detail.ts,
          });
        }
      }
    } catch {
      // Ignore parse errors
    }
  };
  document.addEventListener('se-thread-mark-intercepted', interceptListener);

  updateBlockingAttribute();

  if (document.body) {
    disconnectObserver = observeDOM(document.body, () => {
      // Update blocking attribute immediately (no debounce) so requests
      // on other pages aren't blocked during navigation transitions
      updateBlockingAttribute();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkNavigation, 150);
    });
  }

  // Periodic fallback — catches cases where the observer misses the initial render
  pollTimer = setInterval(checkNavigation, 2000);
}

function checkNavigation() {
  const onThreadsPage = isThreadsPage();

  updateBlockingAttribute();

  if (onThreadsPage) {
    injectMarkReadButtons();
    if (!wasOnThreadsPage) {
      blockedCount = 0;
    }
  }

  wasOnThreadsPage = onThreadsPage;
}

function updateBlockingAttribute() {
  if (isThreadsPage()) {
    document.documentElement.setAttribute('data-se-block-thread-marks', '');
  } else {
    document.documentElement.removeAttribute('data-se-block-thread-marks');
  }
}

export function destroyManualReadControl() {
  if (!active) return;
  active = false;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (disconnectObserver) {
    disconnectObserver();
    disconnectObserver = null;
  }

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (interceptListener) {
    document.removeEventListener('se-thread-mark-intercepted', interceptListener);
    interceptListener = null;
  }

  document.documentElement.removeAttribute('data-se-block-thread-marks');

  wasOnThreadsPage = false;
  blockedCount = 0;
  capturedToken = null;
  blockedRequests.clear();

  document.querySelectorAll('.se-toast').forEach((el) => el.remove());
  document.querySelectorAll('.se-mark-read-btn').forEach((btn) => btn.remove());
}

function isThreadsPage(): boolean {
  return document.querySelector('[data-qa="threads_view"]') !== null;
}

async function getToken(): Promise<{ token: string; url: string } | null> {
  // Prefer token captured from intercepted XHR in MAIN world
  if (capturedToken) return capturedToken;

  // Fall back to background script (captured via webRequest)
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_TOKEN' });
    if (response?.token && response?.url) return response;
  } catch {
    // Extension context may be invalid
  }
  return null;
}

function getLatestMessageTs(channel: string, threadTs: string): string {
  const threadItems = getThreadListItems(channel, threadTs);
  let latestTs = threadTs;

  for (const item of threadItems) {
    const id = item.getAttribute('id') ?? '';
    // Message items: threads_view-CHANNEL-threadTs-messageTs
    // Skip special items: threads_view_heading-, threads_view_footer-, etc.
    const match = id.match(/^threads_view-[A-Z0-9]+-[\d.]+-(.+)$/);
    if (match) {
      const messageTs = match[1];
      if (messageTs > latestTs) {
        latestTs = messageTs;
      }
    }
  }
  return latestTs;
}

function injectMarkReadButtons() {
  const headings = document.querySelectorAll('[data-qa="threads_view_header"]');

  for (const heading of headings) {
    const listItem = heading.closest('[data-qa="virtual-list-item"]');
    if (!listItem) continue;

    const itemId = listItem.getAttribute('id') ?? '';
    const match = itemId.match(/heading-([A-Z0-9]+)-(.+)/);
    if (!match) continue;

    const channel = match[1];
    const threadTs = match[2];

    // Only show button for threads with unread messages (those with a "New" divider)
    const threadItems = getThreadListItems(channel, threadTs);
    const hasUnread = threadItems.some(
      (item) => item.querySelector('[data-qa="thread-marked-as-read-divider"]') !== null
    );
    if (!hasUnread) continue;

    // Button before the reply box (footer)
    const footerItem = threadItems.find(
      (item) => (item.getAttribute('id') ?? '').includes('footer')
    );
    if (!footerItem) continue;

    const replyContainer = footerItem.querySelector('[data-qa="reply_container"]');
    if (!replyContainer) continue;

    // Skip if already has a button
    if (replyContainer.querySelector('.se-mark-read-btn')) continue;

    const btn = createMarkReadButton((e) => {
      e.stopPropagation();
      e.preventDefault();

      btn.disabled = true;
      btn.textContent = 'Marking\u2026';

      const threadKey = `${channel}-${threadTs}`;
      const blocked = blockedRequests.get(threadKey);

      if (!blocked) {
        // Fall back to token + DOM-based ts if no blocked request was captured
        getToken().then((tokenInfo) => {
          if (!tokenInfo) {
            btn.textContent = 'No token yet';
            btn.disabled = false;
            return;
          }
          return replayMarkAsRead(btn, {
            token: tokenInfo.token,
            url: tokenInfo.url,
            channel,
            thread_ts: threadTs,
            ts: getLatestMessageTs(channel, threadTs),
          });
        }).catch(() => { btn.textContent = 'Failed'; });
        return;
      }

      // Replay the exact blocked request
      replayMarkAsRead(btn, blocked).catch(() => { btn.textContent = 'Failed'; });
    });

    replyContainer.insertBefore(btn, replyContainer.firstChild);
  }
}

function replayMarkAsRead(
  btn: HTMLButtonElement,
  params: { token: string; url: string; channel: string; thread_ts: string; ts: string },
): Promise<void> {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const onResult = (evt: Event) => {
      document.removeEventListener('se-mark-thread-read-result', onResult);
      try {
        resolve(JSON.parse((evt as CustomEvent).detail));
      } catch {
        resolve({ ok: false, error: 'parse_error' });
      }
    };
    document.addEventListener('se-mark-thread-read-result', onResult);

    document.dispatchEvent(new CustomEvent('se-mark-thread-read', {
      detail: JSON.stringify(params),
    }));
  }).then((result) => {
    if (!result.ok) {
      btn.textContent = `Failed: ${result.error || 'unknown'}`;
      return;
    }
    btn.textContent = 'Marked';

    // Hide the "New" divider line within this thread
    const items = getThreadListItems(params.channel, params.thread_ts);
    for (const item of items) {
      if (item instanceof HTMLElement && (item.id ?? '').includes('divider')) {
        item.style.display = 'none';
      }
      const newDivider = item.querySelector('[data-qa="thread-marked-as-read-divider"]');
      if (newDivider instanceof HTMLElement) {
        newDivider.closest('[data-qa="virtual-list-item"]')
          ?.setAttribute('style', 'display:none');
      }
    }
  });
}

function createMarkReadButton(onClick: (e: Event) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'se-mark-read-btn';
  btn.textContent = 'Mark as read';
  btn.addEventListener('click', onClick);
  return btn;
}

function showToast(message: string) {
  let toast = document.querySelector('.se-toast') as HTMLElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'se-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = '';
  const icon = document.createElement('span');
  icon.textContent = '\u{1F6D1}';
  icon.style.marginRight = '8px';
  toast.appendChild(icon);
  toast.appendChild(document.createTextNode(message));
  toast.classList.add('se-toast--visible');

  const existingTimer = toast.dataset.timer;
  if (existingTimer) clearTimeout(Number(existingTimer));
  const timer = setTimeout(() => {
    toast.classList.remove('se-toast--visible');
  }, 3000);
  toast.dataset.timer = String(timer);
}

function getThreadListItems(channel: string, threadTs: string): Element[] {
  const suffix = `${channel}-${threadTs}`;
  const items: Element[] = [];
  const allItems = document.querySelectorAll('[data-qa="virtual-list-item"]');
  for (const item of allItems) {
    const id = item.getAttribute('id') ?? '';
    if (id.includes(suffix)) {
      items.push(item);
    }
  }
  return items;
}
