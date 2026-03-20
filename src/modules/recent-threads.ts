import { querySelector, observeDOM, getTextContent } from '../shared/dom-utils';
import { getThreads, setThreads } from '../shared/storage';
import { SELECTORS, MAX_THREADS_PER_WORKSPACE, MESSAGE_PREVIEW_MAX_LENGTH } from '../shared/constants';
import type { ThreadEntry } from '../types';

let active = false;
let disconnectObserver: (() => void) | null = null;
let currentWorkspaceId = '';

export function initRecentThreads(workspaceId: string) {
  if (active) return;
  active = true;
  currentWorkspaceId = workspaceId;

  // Watch for thread open/reply events
  disconnectObserver = observeDOM(document.body, (mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          detectThreadView(node);
        }
      }
    }
  });
}

export function destroyRecentThreads() {
  if (!active) return;
  active = false;

  if (disconnectObserver) {
    disconnectObserver();
    disconnectObserver = null;
  }
}

function detectThreadView(addedNode: HTMLElement) {
  // Check if a threads panel was opened
  const threadPanel = addedNode.matches?.('[data-qa="threads_flexpane"], [class*="p-threads_flexpane"]')
    ? addedNode
    : addedNode.querySelector?.('[data-qa="threads_flexpane"], [class*="p-threads_flexpane"]');

  if (threadPanel) {
    trackCurrentThread(threadPanel);
  }
}

async function trackCurrentThread(threadPanel: Element) {
  // Extract thread information from the panel
  const entry = extractThreadEntry(threadPanel);
  if (!entry) return;

  await addOrUpdateThread(entry);
}

function extractThreadEntry(threadPanel: Element): ThreadEntry | null {
  try {
    // Get the root message of the thread
    const messages = threadPanel.querySelectorAll(
      '[data-qa="message_container"], [role="article"], [class*="c-message_kit"]'
    );
    const rootMessage = messages[0];
    if (!rootMessage) return null;

    // Extract author
    const authorEl = querySelector(SELECTORS.messageAuthor, rootMessage);
    const author = authorEl ? getTextContent(authorEl) : 'Unknown';

    // Extract message preview
    const textEl = querySelector(SELECTORS.messageText, rootMessage);
    const messagePreview = textEl
      ? getTextContent(textEl, MESSAGE_PREVIEW_MAX_LENGTH)
      : '';

    // Extract channel name from header or URL
    const channelName = getChannelName();
    const channelId = getChannelIdFromUrl();
    const threadId = getThreadIdFromPanel(rootMessage);
    const permalink = buildPermalink(channelId, threadId);

    if (!threadId || !channelId) return null;

    // Extract last reply info (last message that isn't the root)
    let lastReplyAuthor: string | undefined;
    let lastReplyPreview: string | undefined;
    if (messages.length > 1) {
      const lastMessage = messages[messages.length - 1];
      const lastAuthorEl = querySelector(SELECTORS.messageAuthor, lastMessage);
      lastReplyAuthor = lastAuthorEl ? getTextContent(lastAuthorEl) : undefined;
      const lastTextEl = querySelector(SELECTORS.messageText, lastMessage);
      lastReplyPreview = lastTextEl
        ? getTextContent(lastTextEl, MESSAGE_PREVIEW_MAX_LENGTH)
        : undefined;
    }

    return {
      threadId,
      workspaceId: currentWorkspaceId,
      channelId,
      channelName: channelName ?? channelId,
      author,
      messagePreview,
      lastReplyAuthor,
      lastReplyPreview,
      lastViewedAt: Date.now(),
      permalink,
    };
  } catch {
    return null;
  }
}

function getChannelName(): string | null {
  const headerEl = querySelector(SELECTORS.channelHeader);
  return headerEl ? getTextContent(headerEl) : null;
}

function getChannelIdFromUrl(): string {
  const match = window.location.pathname.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/);
  return match?.[1] ?? '';
}

function getThreadIdFromPanel(rootMessage: Element): string {
  // Try data-ts attribute
  const ts = rootMessage.getAttribute('data-ts') ?? rootMessage.getAttribute('data-item-key');
  if (ts) return `p${ts.replace('.', '')}`;

  // Try to extract from permalink in the message
  const timestampEl = querySelector(SELECTORS.messageTimestamp, rootMessage);
  if (timestampEl) {
    const href = timestampEl.getAttribute('href') ?? '';
    const match = href.match(/\/p(\d+)/);
    if (match) return `p${match[1]}`;
  }

  // Generate a fallback ID
  return `thread_${Date.now()}`;
}

function buildPermalink(channelId: string, threadId: string): string {
  return `${window.location.origin}/archives/${channelId}/${threadId}`;
}

export async function addOrUpdateThread(entry: ThreadEntry): Promise<void> {
  const threads = await getThreads(entry.workspaceId);

  // Check if thread already exists
  const existingIndex = threads.findIndex((t) => t.threadId === entry.threadId);
  if (existingIndex >= 0) {
    // Update existing entry and move to top
    threads.splice(existingIndex, 1);
  }

  // Add to beginning (most recent first)
  threads.unshift(entry);

  // Evict oldest if over limit
  if (threads.length > MAX_THREADS_PER_WORKSPACE) {
    threads.length = MAX_THREADS_PER_WORKSPACE;
  }

  await setThreads(entry.workspaceId, threads);
}
