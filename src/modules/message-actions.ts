import { querySelector, observeDOM } from '../shared/dom-utils';
import { SELECTORS } from '../shared/constants';

let active = false;
let disconnectObserver: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const INJECTED_MARKER = 'data-se-actions';

export function initMessageActions(wsId: string) {
  if (active) return;
  active = true;

  injectAll();

  disconnectObserver = observeDOM(document.body, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectAll, 150);
  });
}

export function destroyMessageActions() {
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

  document.querySelectorAll('.se-toolbar').forEach((el) => el.remove());
  document.querySelectorAll(`[${INJECTED_MARKER}]`).forEach((el) => {
    el.removeAttribute(INJECTED_MARKER);
  });
}

function injectAll() {
  // Find all message containers and inject toolbar into any that don't have one yet
  for (const selector of SELECTORS.messageContainer) {
    try {
      const messages = document.querySelectorAll(selector);
      for (const msg of messages) {
        if (msg.hasAttribute(INJECTED_MARKER)) continue;
        msg.setAttribute(INJECTED_MARKER, 'true');
        if (msg instanceof HTMLElement) {
          msg.style.position = msg.style.position || 'relative';
        }
        attachToolbar(msg);
      }
      if (messages.length > 0) break;
    } catch {
      // try next selector
    }
  }
}

function attachToolbar(messageContainer: Element) {
  const permalink = extractPermalink(messageContainer);

  const toolbar = document.createElement('div');
  toolbar.className = 'se-toolbar';

  const copyBtn = createButton(
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h5a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L7.94 2.94A1.5 1.5 0 0 0 6.878 2.5H4.5zM6 3.5h-.5v2A1.5 1.5 0 0 0 7 7h2v5.5H4.5v-9H6z"/><path d="M12 5.5v7a2.5 2.5 0 0 1-2.5 2.5h-4A1.5 1.5 0 0 0 7 16h2.5A3.5 3.5 0 0 0 13 12.5v-6A1.5 1.5 0 0 0 12 5.5z"/></svg>',
    'Copy link',
    async () => {
      const link = permalink ?? extractPermalink(messageContainer);
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showFeedback(copyBtn, 'Copied!');
    }
  );

  const threadBtn = createButton(
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 2h5v5l-2-2-3 3-1.5-1.5L10.5 3.5 9 2zM3.5 4H7v1.5H3.5v7h7V9H12v4.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/></svg>',
    'Open thread in new tab',
    () => {
      const link = permalink ?? extractPermalink(messageContainer);
      if (!link) return;
      const tsMatch = link.match(/\/p(\d+)/);
      if (!tsMatch) return;
      const rawTs = tsMatch[1];
      const dataTs = rawTs.length > 6
        ? `${rawTs.slice(0, -6)}.${rawTs.slice(-6)}`
        : rawTs;
      browser.runtime.sendMessage({ type: 'OPEN_THREAD_TAB', url: link, ts: dataTs });
    }
  );

  // Split view icon (two columns)
  const splitBtn = createButton(
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 0 1 1-1h4.5v12H3a1 1 0 0 1-1-1V3zm6.5-1H13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8.5V2z"/></svg>',
    'Open in split view',
    () => openInSplitView(messageContainer)
  );

  const unreadBtn = createButton(
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a6 6 0 0 0-6 6 6 6 0 0 0 6 6 6 6 0 0 0 6-6 6 6 0 0 0-6-6zm0 1.5a4.5 4.5 0 0 1 4.5 4.5A4.5 4.5 0 0 1 8 12.5 4.5 4.5 0 0 1 3.5 8 4.5 4.5 0 0 1 8 3.5z"/><circle cx="8" cy="8" r="2.5"/></svg>',
    'Mark unread',
    () => markUnread(messageContainer)
  );

  toolbar.appendChild(copyBtn);
  toolbar.appendChild(threadBtn);
  toolbar.appendChild(splitBtn);
  toolbar.appendChild(unreadBtn);

  // Append inside the hover target so hovering our toolbar doesn't trigger mouseleave on it
  const hoverTarget = messageContainer.querySelector('[class*="c-message_kit__hover"]');
  (hoverTarget ?? messageContainer).appendChild(toolbar);
}

async function openInSplitView(messageContainer: Element) {
  // Step 1: Open the thread panel
  // First, try clicking the reply bar (for messages with existing replies)
  let clicked = false;
  for (const selector of ['[data-qa="reply_bar_count"]', '[data-qa="reply_bar_view_thread"]', '[data-qa="reply_bar"]']) {
    const btn = messageContainer.querySelector(selector);
    if (btn instanceof HTMLElement) {
      btn.click();
      clicked = true;
      break;
    }
  }

  // If no reply bar, the thread button is already visible since we're hovering
  if (!clicked) {
    const searchRoot = messageContainer.parentElement ?? messageContainer;
    const threadBtn = await waitForSelector(searchRoot, [
      '[data-qa="start_thread"]',
      '[data-qa="reply_in_thread"]',
      'button[aria-label="View thread"]',
      'button[aria-label="Reply in thread"]',
    ], 2000);
    if (threadBtn) {
      threadBtn.click();
      clicked = true;
    }
  }

  if (!clicked) return;

  // Step 2: Wait for the thread panel to open
  const threadPanel = await waitForSelector(document.documentElement, ['[data-qa="threads_flexpane"]'], 5000);
  if (!threadPanel) return;

  // Step 3: Wait for and click the kebab/more menu in the flexpane header
  const kebab = await waitForSelector(document.documentElement, ['[data-qa="secondary-header-more"]'], 2000);
  if (!kebab) return;
  kebab.click();

  // Step 4: Find and click "Open in split view" in the menu
  const splitItem = await waitForMatch(
    () => {
      for (const item of document.querySelectorAll(
        '[role="menuitem"], [role="option"], [data-qa="menu_item"]'
      )) {
        if ((item.textContent ?? '').toLowerCase().includes('split') && item instanceof HTMLElement) {
          return item;
        }
      }
      return null;
    },
    2000
  );
  if (splitItem) splitItem.click();
}

async function markUnread(messageContainer: Element) {
  // Click the "More actions" (kebab) button — already visible since we're hovering the message
  const moreSelectors = [
    '[data-qa="more_message_actions"]',
    'button[aria-label="More actions"]',
    'button[aria-label="More message actions"]',
  ];
  const searchRoot = messageContainer.parentElement ?? messageContainer;
  const moreBtn = await waitForSelector(searchRoot, moreSelectors, 2000);
  if (!moreBtn) return;
  moreBtn.click();

  // Poll for "Mark unread" menu item
  const unreadItem = await waitForMatch(
    () => {
      for (const item of document.querySelectorAll(
        '[role="menuitem"], [role="option"], [data-qa="menu_item"], [data-qa="mark_unread"]'
      )) {
        if ((item.textContent ?? '').toLowerCase().includes('mark unread') && item instanceof HTMLElement) {
          return item;
        }
      }
      return null;
    },
    2000
  );
  if (unreadItem) unreadItem.click();
}

function waitForSelector(root: Element, selectors: string[], timeout: number): Promise<HTMLElement | null> {
  return waitForMatch(() => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el instanceof HTMLElement) return el;
    }
    return null;
  }, timeout);
}

function waitForMatch<T>(finder: () => T | null, timeout: number): Promise<T | null> {
  return new Promise((resolve) => {
    const result = finder();
    if (result) { resolve(result); return; }
    const deadline = Date.now() + timeout;
    const interval = setInterval(() => {
      const found = finder();
      if (found || Date.now() > deadline) {
        clearInterval(interval);
        resolve(found);
      }
    }, 30);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createButton(
  svgHtml: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'se-action-btn';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svgHtml;

  const tooltip = document.createElement('span');
  tooltip.className = 'se-tooltip';
  tooltip.textContent = label;
  btn.appendChild(tooltip);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  return btn;
}

function showFeedback(btn: HTMLButtonElement, text: string) {
  const orig = btn.innerHTML;
  btn.textContent = text;
  btn.classList.add('se-copied-feedback');
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.classList.remove('se-copied-feedback');
  }, 1200);
}

function extractPermalink(messageContainer: Element): string | null {
  const timestampEl = querySelector(SELECTORS.messageTimestamp, messageContainer);
  if (timestampEl) {
    const href = timestampEl.getAttribute('href');
    if (href) {
      return href.startsWith('/') ? `${window.location.origin}${href}` : href;
    }
  }

  const tsAttr =
    messageContainer.getAttribute('data-ts') ??
    messageContainer.getAttribute('data-item-key');
  if (tsAttr) {
    const channelMatch = window.location.pathname.match(
      /\/client\/[A-Z0-9]+\/([A-Z0-9]+)/
    );
    if (channelMatch) {
      const ts = tsAttr.replace('.', '');
      return `${window.location.origin}/archives/${channelMatch[1]}/p${ts}`;
    }
  }

  return null;
}
