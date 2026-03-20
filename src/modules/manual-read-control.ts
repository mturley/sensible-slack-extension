import { observeDOM } from '../shared/dom-utils';

let active = false;
let disconnectObserver: (() => void) | null = null;
let messageListener: ((message: any) => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wasOnThreadsPage = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let blockedCount = 0;

export function initManualReadControl() {
  if (active) return;
  active = true;

  // Listen for messages from the background script
  messageListener = (message: any) => {
    if (message.type === 'THREAD_MARK_BLOCKED') {
      blockedCount++;
      showToast(
        `Auto-mark-as-read blocked (${blockedCount} thread${blockedCount > 1 ? 's' : ''})`
      );
    }
  };
  browser.runtime.onMessage.addListener(messageListener);

  wasOnThreadsPage = isThreadsPage();
  if (wasOnThreadsPage) {
    setBlocking(true);
    injectMarkReadButtons();
    blockedCount = 0;
  }

  if (document.body) {
    disconnectObserver = observeDOM(document.body, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkNavigation, 150);
    });
  }

  // Periodic fallback — catches cases where the observer misses the initial render
  pollTimer = setInterval(checkNavigation, 2000);
}

function checkNavigation() {
  const onThreadsPage = isThreadsPage();

  if (onThreadsPage && !wasOnThreadsPage) {
    setBlocking(true);
    injectMarkReadButtons();
    blockedCount = 0;
  } else if (!onThreadsPage && wasOnThreadsPage) {
    setBlocking(false);
  } else if (onThreadsPage) {
    injectMarkReadButtons();
  }

  wasOnThreadsPage = onThreadsPage;
}

function setBlocking(enabled: boolean) {
  browser.runtime.sendMessage({
    type: enabled ? 'ENABLE_READ_CONTROL' : 'DISABLE_READ_CONTROL',
  }).catch(() => {
    // Extension context may be invalid
  });
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

  if (messageListener) {
    browser.runtime.onMessage.removeListener(messageListener);
    messageListener = null;
  }

  wasOnThreadsPage = false;
  blockedCount = 0;
  setBlocking(false);

  document.querySelectorAll('.se-toast').forEach((el) => el.remove());
  document.querySelectorAll('.se-mark-read-btn').forEach((btn) => btn.remove());
}

function isThreadsPage(): boolean {
  return document.querySelector('[data-qa="threads_view"]') !== null;
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
      btn.textContent = 'Marking…';

      // Get token from background, then make the API call from content script (has cookies)
      browser.runtime.sendMessage({
        type: 'MARK_THREAD_READ',
        channel,
        threadTs,
      }).then((response: any) => {
        if (response?.error) {
          btn.textContent = 'No token yet';
          btn.disabled = false;
          return;
        }

        const separator = response.url.includes('?') ? '&' : '?';
        const allowUrl = `${response.url}${separator}_se_allow=1`;

        return fetch(allowUrl, {
          method: 'POST',
          body: new URLSearchParams({
            token: response.token,
            channel,
            thread_ts: threadTs,
            ts: response.ts,
            read: '1',
          }),
          credentials: 'include',
        }).then((r) => r.json().then((json) => ({ status: r.status, json })));
      }).then((result) => {
        if (!result) return;
        console.log('[SE DEBUG] mark-as-read response:', result);
        if (!result.json?.ok) {
          btn.textContent = `Failed: ${result.json?.error || result.status}`;
          return;
        }
        btn.textContent = 'Marked';

        // Hide the "New" divider line within this thread
        const items = getThreadListItems(channel, threadTs);
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
      }).catch(() => {
        btn.textContent = 'Failed';
      });
    });

    replyContainer.insertBefore(btn, replyContainer.firstChild);
  }
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
  icon.textContent = '🛑';
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
