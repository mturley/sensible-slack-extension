import { querySelector, observeDOM } from '../shared/dom-utils';
import { SELECTORS, SLACK_THREAD_URL_PATTERN } from '../shared/constants';

let active = false;
let disconnectObserver: (() => void) | null = null;
let workspaceId = '';

const INJECTED_MARKER = 'data-se-actions-injected';

export function initMessageActions(wsId: string) {
  if (active) return;
  active = true;
  workspaceId = wsId;

  // Inject into existing messages
  injectAllActionButtons();

  // Watch for new messages rendered (virtual scrolling, SPA navigation)
  disconnectObserver = observeDOM(document.body, (_mutations) => {
    injectAllActionButtons();
  });
}

export function destroyMessageActions() {
  if (!active) return;
  active = false;

  if (disconnectObserver) {
    disconnectObserver();
    disconnectObserver = null;
  }

  // Remove all injected buttons
  document.querySelectorAll(`[${INJECTED_MARKER}]`).forEach((el) => {
    el.querySelectorAll('.se-action-btn').forEach((btn) => btn.remove());
    el.removeAttribute(INJECTED_MARKER);
  });
}

function injectAllActionButtons() {
  const actionBars = findActionBars();
  for (const bar of actionBars) {
    if (bar.hasAttribute(INJECTED_MARKER)) continue;
    bar.setAttribute(INJECTED_MARKER, 'true');
    injectButtons(bar);
  }
}

function findActionBars(): Element[] {
  const bars: Element[] = [];
  for (const selector of SELECTORS.messageActionBar) {
    try {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) {
        bars.push(...Array.from(found));
        break;
      }
    } catch {
      // Invalid selector — try next
    }
  }
  return bars;
}

function injectButtons(actionBar: Element) {
  const messageContainer = actionBar.closest('[data-qa="message_container"], [role="article"], [class*="c-message_kit"]');
  if (!messageContainer) return;

  const permalink = extractPermalink(messageContainer);

  // Copy link button
  const copyBtn = createActionButton('📋', 'Copy link', async () => {
    if (!permalink) return;
    try {
      await navigator.clipboard.writeText(permalink);
      showCopiedFeedback(copyBtn);
    } catch {
      // Fallback: use execCommand
      const textArea = document.createElement('textarea');
      textArea.value = permalink;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showCopiedFeedback(copyBtn);
    }
  });

  // Open thread in new tab button
  const threadBtn = createActionButton('↗️', 'Open thread in new tab', () => {
    if (!permalink) return;
    window.open(permalink, '_blank');
  });

  actionBar.appendChild(copyBtn);
  actionBar.appendChild(threadBtn);
}

function createActionButton(
  icon: string,
  tooltip: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'se-action-btn';
  btn.innerHTML = `<span class="tooltip">${tooltip}</span>${icon}`;
  btn.title = tooltip;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  return btn;
}

function showCopiedFeedback(btn: HTMLButtonElement) {
  const original = btn.textContent;
  btn.textContent = '✓';
  btn.classList.add('se-copied-feedback');
  setTimeout(() => {
    btn.textContent = '';
    btn.innerHTML = `<span class="tooltip">Copy link</span>📋`;
    btn.classList.remove('se-copied-feedback');
  }, 1500);
}

function extractPermalink(messageContainer: Element): string | null {
  // Try to find a timestamp link with the message permalink
  const timestampEl = querySelector(SELECTORS.messageTimestamp, messageContainer);
  if (timestampEl) {
    const href = timestampEl.getAttribute('href');
    if (href) {
      // Convert relative URL to absolute
      if (href.startsWith('/')) {
        return `${window.location.origin}${href}`;
      }
      return href;
    }
  }

  // Try to extract from data attributes
  const tsAttr = messageContainer.getAttribute('data-ts') ?? messageContainer.getAttribute('data-item-key');
  if (tsAttr) {
    // Construct permalink from workspace context
    const channelMatch = window.location.pathname.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/);
    if (channelMatch) {
      const channelId = channelMatch[1];
      const ts = tsAttr.replace('.', '');
      return `${window.location.origin}/archives/${channelId}/p${ts}`;
    }
  }

  return null;
}
