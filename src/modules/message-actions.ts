import { querySelector, observeDOM } from '../shared/dom-utils';
import { SELECTORS } from '../shared/constants';
import type { ExtensionSettings } from '../types';

let active = false;
let disconnectObserver: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentSettings: ExtensionSettings | null = null;
let cachedUserId: string | null = null;

const INJECTED_MARKER = 'data-se-actions';

export function initMessageActions(wsId: string, settings: ExtensionSettings) {
  currentSettings = settings;

  if (active) {
    // Settings changed while already active — re-inject all toolbars
    document.querySelectorAll('.se-toolbar').forEach((el) => el.remove());
    document.querySelectorAll(`[${INJECTED_MARKER}]`).forEach((el) => {
      el.removeAttribute(INJECTED_MARKER);
    });
    injectAll();
    return;
  }

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
  currentSettings = null;
  cachedUserId = null;

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

function detectCurrentUserId(): string | null {
  // Read Slack's localConfig_v2 from the page's localStorage.
  // Firefox content scripts need wrappedJSObject to access the page's localStorage.
  try {
    const pageWindow = (window as unknown as { wrappedJSObject?: Window }).wrappedJSObject ?? window;
    const raw = pageWindow.localStorage.getItem('localConfig_v2');
    if (raw) {
      const config = JSON.parse(raw) as {
        teams?: Record<string, { id?: string; user_id?: string; enterprise_id?: string }>;
      };
      if (config.teams) {
        // The URL is app.slack.com/client/<TEAM_OR_ENTERPRISE_ID>/...
        // Match against the team's id or enterprise_id from localConfig_v2.
        const urlMatch = window.location.pathname.match(/^\/client\/([A-Z0-9]+)/);
        const wsId = urlMatch?.[1];
        if (wsId) {
          for (const team of Object.values(config.teams)) {
            if ((team.id === wsId || team.enterprise_id === wsId) && team.user_id) {
              return team.user_id;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[SE] detectCurrentUserId error:', e);
  }

  return null;
}

function isOwnMessage(messageContainer: Element): boolean {
  const senderEl = messageContainer.querySelector('[data-message-sender]');
  if (!senderEl) return false;
  const senderId = senderEl.getAttribute('data-message-sender');
  if (!senderId) return false;

  if (!cachedUserId) {
    cachedUserId = detectCurrentUserId();
  }

  return !!cachedUserId && senderId === cachedUserId;
}

function attachToolbar(messageContainer: Element) {
  const permalink = extractPermalink(messageContainer);
  const s = currentSettings;
  const ownMessage = isOwnMessage(messageContainer);

  const toolbar = document.createElement('div');
  toolbar.className = 'se-toolbar';

  if (ownMessage && (!s || s.quickActionEditMessage)) {
    const editBtn = createButton(
      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M13.616 3.445a1.25 1.25 0 0 1 1.768 0l1.171 1.171a1.25 1.25 0 0 1 0 1.768L15.5 7.44 12.56 4.5zM11.5 5.56l-7.079 7.08-1.101 4.04 4.04-1.1 7.079-7.08zm4.945-3.177a2.75 2.75 0 0 0-3.89 0L3.22 11.72a.75.75 0 0 0-.194.333l-1.5 5.5a.75.75 0 0 0 .921.92l5.5-1.5a.75.75 0 0 0 .333-.192l9.336-9.336a2.75 2.75 0 0 0 0-3.89z" clip-rule="evenodd"/></svg>',
      'Edit message',
      () => editMessage(messageContainer)
    );
    toolbar.appendChild(editBtn);
  }

  if (!s || s.quickActionCopyLink) {
    const copyBtn = createButton(
      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.306 3.756a2.75 2.75 0 0 1 3.889 0l.05.05a2.75 2.75 0 0 1 0 3.889l-3.18 3.18a2.75 2.75 0 0 1-3.98-.095l-.03-.034a.75.75 0 0 0-1.11 1.009l.03.034a4.25 4.25 0 0 0 6.15.146l3.18-3.18a4.25 4.25 0 0 0 0-6.01l-.05-.05a4.25 4.25 0 0 0-6.01 0L9.47 4.47a.75.75 0 1 0 1.06 1.06zm-4.611 12.49a2.75 2.75 0 0 1-3.89 0l-.05-.051a2.75 2.75 0 0 1 0-3.89l3.18-3.179a2.75 2.75 0 0 1 3.98.095l.03.034a.75.75 0 1 0 1.11-1.01l-.03-.033a4.25 4.25 0 0 0-6.15-.146l-3.18 3.18a4.25 4.25 0 0 0 0 6.01l.05.05a4.25 4.25 0 0 0 6.01 0l1.775-1.775a.75.75 0 0 0-1.06-1.06z" clip-rule="evenodd"/></svg>',
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
    toolbar.appendChild(copyBtn);
  }

  if (!s || s.quickActionOpenThread) {
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
    toolbar.appendChild(threadBtn);
  }

  const isInThread = !!messageContainer.closest('[data-qa="threads_flexpane"], [data-qa="message_pane_flexpane"]');

  if ((!s || s.quickActionSplitView) && !isInThread) {
    const splitBtn = createButton(
      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.264 1.044c2.103 0 4.143.921 5.075 2.622V2.323a.75.75 0 0 1 1.5 0V5.5a.75.75 0 0 1-.75.75h-3.177a.75.75 0 0 1 0-1.5h1.274c-.487-1.293-1.988-2.206-3.922-2.206-2.169 0-3.787 1.177-4.02 3.049a.75.75 0 0 1-1.488-.186c.353-2.835 2.818-4.363 5.508-4.363M9.43 9.356A1.63 1.63 0 0 0 8.41 9H7.306l-4.762 4.762v2.105q0 .174.035.338zM4.177 9h1.715l-3.348 3.348v-1.715C2.544 9.73 3.275 9 4.177 9m5.812 1.21-6.887 6.886c.287.252.663.404 1.075.404H5.2l4.844-4.844v-2.023q-.001-.22-.055-.423m.055 3.86-3.43 3.43h1.797c.902 0 1.633-.731 1.633-1.633zm1.5 1.797A3.133 3.133 0 0 1 8.411 19H4.177a3.133 3.133 0 0 1-3.133-3.133v-5.234A3.133 3.133 0 0 1 4.177 7.5H8.41a3.133 3.133 0 0 1 3.133 3.133zm5.956-5.234C17.5 9.73 16.769 9 15.867 9h-.234C14.73 9 14 9.73 14 10.633v5.234c0 .902.731 1.633 1.633 1.633h.234c.902 0 1.633-.731 1.633-1.633zm1.5 5.234A3.133 3.133 0 0 1 15.867 19h-.234a3.133 3.133 0 0 1-3.133-3.133v-5.234A3.133 3.133 0 0 1 15.633 7.5h.234A3.133 3.133 0 0 1 19 10.633z" clip-rule="evenodd"/></svg>',
      'Open in split view',
      () => openInSplitView(messageContainer)
    );
    toolbar.appendChild(splitBtn);
  }

  if (!s || s.quickActionMarkUnread) {
    const unreadBtn = createButton(
      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M13.964 4.05a2 2 0 1 1 0 4 2 2 0 0 1 0-4m-3.5 2a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0M2.536 4.905V15.2a2.25 2.25 0 0 0 2.25 2.25h10.357a2.25 2.25 0 0 0 2.25-2.25v-4.35a.75.75 0 0 0-1.5 0v4.35a.75.75 0 0 1-.75.75H4.786a.75.75 0 0 1-.75-.75V4.905a.75.75 0 0 1 .749-.75h4.42a.75.75 0 1 0 0-1.5h-4.42a2.25 2.25 0 0 0-2.25 2.25" clip-rule="evenodd"/></svg>',
      'Mark unread',
      () => markUnread(messageContainer)
    );
    toolbar.appendChild(unreadBtn);
  }

  // Don't append an empty toolbar
  if (toolbar.children.length === 0) return;

  // Append inside the hover target so hovering our toolbar doesn't trigger mouseleave on it
  const hoverTarget = messageContainer.querySelector('[class*="c-message_kit__hover"]');
  const appendTarget = (hoverTarget ?? messageContainer) as HTMLElement;
  // Ensure the append target is a positioning ancestor for our absolute-positioned toolbar
  if (!appendTarget.style.position) {
    appendTarget.style.position = 'relative';
  }
  appendTarget.appendChild(toolbar);
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

async function editMessage(messageContainer: Element) {
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

  // Poll for "Edit message" menu item
  const editItem = await waitForMatch(
    () => {
      for (const item of document.querySelectorAll(
        '[role="menuitem"], [role="option"], [data-qa="menu_item"], [data-qa="edit_message"]'
      )) {
        if ((item.textContent ?? '').toLowerCase().includes('edit message') && item instanceof HTMLElement) {
          return item;
        }
      }
      return null;
    },
    2000
  );
  if (editItem) editItem.click();
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
