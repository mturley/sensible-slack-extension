import { observeDOM } from '../shared/dom-utils';
import {
  SLACK_THREAD_URL_PATTERN,
  SLACK_INTERNAL_LINK_PATTERN,
  JIRA_ISSUE_URL_PATTERN,
  GITHUB_PR_ISSUE_URL_PATTERN,
  GITHUB_PR_URL_FULL_PATTERN,
} from '../shared/constants';
import { getThreadLinks, saveThreadLinks, mergeLinks } from '../shared/link-cache';
import type { ExtensionSettings, CachedLink, ThreadLinkCache } from '../types';

let active = false;
let disconnectObserver: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentSettings: ExtensionSettings | null = null;
const processedMessages = new Map<string, Set<string>>();
let openDropdown: HTMLElement | null = null;
let closeDropdownHandler: ((e: MouseEvent | KeyboardEvent) => void) | null = null;
let threadsPageScrollHandler: (() => void) | null = null;
let threadsPageScrollEl: Element | null = null;
let floatingContainer: HTMLElement | null = null;
const threadCacheMap = new Map<string, ThreadLinkCache>();
const githubPrLookedUp = new Set<string>();

const SCANNED_MARKER = 'data-se-links-scanned';
const BTN_EXTERNAL_CLASS = 'se-thread-links-btn';
const BTN_THREADS_CLASS = 'se-linked-threads-btn';
const DROPDOWN_CLASS = 'se-thread-link-dropdown';

// ── Public API ──────────────────────────────────────────────────────

export function initThreadLinks(_wsId: string, settings: ExtensionSettings) {
  const settingsChanged = currentSettings &&
    (currentSettings.threadExternalLinks !== settings.threadExternalLinks ||
     currentSettings.threadLinkedThreads !== settings.threadLinkedThreads);
  currentSettings = settings;

  if (active) {
    if (settingsChanged) {
      refreshAllButtons();
    }
    scanAll();
    return;
  }

  active = true;
  scanAll();

  disconnectObserver = observeDOM(document.body, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanAll, 200);
  });
}

export function destroyThreadLinks() {
  if (!active) return;
  active = false;
  currentSettings = null;
  processedMessages.clear();
  flexpaneThreadId = null;
  githubPrLookedUp.clear();
  threadCacheMap.clear();

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (disconnectObserver) {
    disconnectObserver();
    disconnectObserver = null;
  }

  teardownThreadsPageScroll();
  closeDropdownIfOpen();
  document.querySelectorAll(`.se-thread-link-wrapper, .se-floating-thread-links, .${BTN_EXTERNAL_CLASS}, .${BTN_THREADS_CLASS}, .${DROPDOWN_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`[${SCANNED_MARKER}]`).forEach((el) => el.removeAttribute(SCANNED_MARKER));
}

function refreshAllButtons() {
  closeDropdownIfOpen();

  for (const [threadId, cache] of threadCacheMap) {
    const wrapper = document.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`);
    if (wrapper) {
      const headerEl = wrapper.parentElement;
      if (headerEl) {
        const context = headerEl.closest('[data-qa="threads_flexpane"]') ? 'flexpane' : 'threads-page';
        renderButtons(threadId, cache, headerEl, context);
      }
    }
  }

  if (floatingContainer) {
    floatingContainer.remove();
    floatingContainer = null;
  }
  updateFloatingButtons();
}

// ── Scanning ────────────────────────────────────────────────────────

function scanAll() {
  if (!active || !currentSettings) return;

  const flexpane = document.querySelector('[data-qa="threads_flexpane"]');
  if (flexpane) {
    scanThreadContext(flexpane, 'flexpane');
  }

  const threadsView = document.querySelector('[data-qa="threads_view"]');
  if (threadsView) {
    scanThreadsPage(threadsView);
  }
}

function scanThreadContext(container: Element, context: 'flexpane' | 'threads-page') {
  const rootMsg = container.querySelector('[data-qa="message_container"][data-msg-channel-id]');
  if (rootMsg) {
    const channelId = rootMsg.getAttribute('data-msg-channel-id');
    const msgTs = rootMsg.getAttribute('data-msg-ts');
    if (channelId && msgTs) {
      const newId = `${channelId}:${msgTs}`;
      if (flexpaneThreadId && flexpaneThreadId !== newId) {
        container.querySelectorAll('.se-thread-link-wrapper').forEach((el) => el.remove());
        container.querySelectorAll(`[${SCANNED_MARKER}]`).forEach((el) => el.removeAttribute(SCANNED_MARKER));
      }
    }
  }

  const threadId = detectThreadId(container, context);
  if (!threadId) return;

  const messages = container.querySelectorAll('[data-qa="message_container"]');
  const newLinks: CachedLink[] = [];
  let foundNew = false;

  for (const msg of messages) {
    if (msg.hasAttribute(SCANNED_MARKER)) continue;
    msg.setAttribute(SCANNED_MARKER, 'true');
    foundNew = true;

    const msgTs = msg.getAttribute('data-msg-ts');
    if (msgTs) {
      let set = processedMessages.get(threadId);
      if (!set) {
        set = new Set();
        processedMessages.set(threadId, set);
      }
      set.add(msgTs);
    }

    const extracted = extractLinksFromMessage(msg);
    newLinks.push(...extracted);
  }

  if (foundNew || !document.querySelector(`.${BTN_EXTERNAL_CLASS}[data-se-thread="${threadId}"]`)) {
    persistAndUpdateUI(threadId, newLinks, container, context);
  }
}

function scanThreadsPage(threadsView: Element) {
  const threadGroups = new Map<string, { headerEl: Element | null; messages: Element[] }>();

  const vListItems = threadsView.querySelectorAll('[data-qa="virtual-list-item"]');
  let currentThreadId: string | null = null;
  let currentHeader: Element | null = null;

  for (const item of vListItems) {
    const header = item.querySelector('[data-qa="threads_view_header"]');
    if (header) {
      const permalink = header.querySelector('a.p-threads_view_header__permalink');
      const href = permalink?.getAttribute('href');
      if (href) {
        const match = SLACK_THREAD_URL_PATTERN.exec(href);
        if (match) {
          currentThreadId = `${match[1]}:${tsFromSlackP(match[2])}`;
          currentHeader = header;
          if (!threadGroups.has(currentThreadId)) {
            threadGroups.set(currentThreadId, { headerEl: header, messages: [] });
          }
        }
      }
      continue;
    }

    const droppable = item.querySelector('[data-droppable-thread]');
    const droppableAttr = droppable?.getAttribute('data-droppable-thread');
    if (droppableAttr && !currentThreadId) {
      const parts = droppableAttr.split('-');
      if (parts.length >= 2) {
        currentThreadId = `${parts[0]}:${parts.slice(1).join('.')}`;
        if (!threadGroups.has(currentThreadId)) {
          threadGroups.set(currentThreadId, { headerEl: null, messages: [] });
        }
      }
    }

    if (currentThreadId) {
      const msg = item.querySelector('[data-qa="message_container"]');
      if (msg) {
        threadGroups.get(currentThreadId)!.messages.push(msg);
      }
    }
  }

  for (const [threadId, group] of threadGroups) {
    const newLinks: CachedLink[] = [];
    let foundNew = false;

    for (const msg of group.messages) {
      if (msg.hasAttribute(SCANNED_MARKER)) continue;
      msg.setAttribute(SCANNED_MARKER, 'true');
      foundNew = true;

      const msgTs = msg.getAttribute('data-msg-ts');
      if (msgTs) {
        let set = processedMessages.get(threadId);
        if (!set) {
          set = new Set();
          processedMessages.set(threadId, set);
        }
        set.add(msgTs);
      }

      newLinks.push(...extractLinksFromMessage(msg));
    }

    if (group.headerEl && (foundNew || !group.headerEl.querySelector(`.${BTN_EXTERNAL_CLASS}`))) {
      persistAndUpdateUI(threadId, newLinks, group.headerEl, 'threads-page');
    }
  }

  setupThreadsPageScroll(threadsView);
}

// ── Floating Buttons on Threads Page ────────────────────────────────

function setupThreadsPageScroll(threadsView: Element) {
  const scrollEl = threadsView.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl || scrollEl === threadsPageScrollEl) return;

  teardownThreadsPageScroll();
  threadsPageScrollEl = scrollEl;

  threadsPageScrollHandler = () => updateFloatingButtons();
  scrollEl.addEventListener('scroll', threadsPageScrollHandler, { passive: true });
  updateFloatingButtons();
}

function teardownThreadsPageScroll() {
  if (threadsPageScrollEl && threadsPageScrollHandler) {
    threadsPageScrollEl.removeEventListener('scroll', threadsPageScrollHandler);
  }
  threadsPageScrollEl = null;
  threadsPageScrollHandler = null;
  if (floatingContainer) {
    floatingContainer.remove();
    floatingContainer = null;
  }
}

function updateFloatingButtons() {
  const threadsView = document.querySelector('[data-qa="threads_view"]');
  const scrollEl = threadsPageScrollEl;
  if (!threadsView || !scrollEl) return;

  const scrollRect = scrollEl.getBoundingClientRect();

  // Find which thread's items are at the top of the viewport
  // by checking all droppable-thread elements
  const droppableEls = threadsView.querySelectorAll('[data-droppable-thread]');
  let activeThreadId: string | null = null;

  for (const el of droppableEls) {
    const rect = el.getBoundingClientRect();
    // This element is at least partially visible in the scroll area
    if (rect.bottom > scrollRect.top && rect.top < scrollRect.bottom) {
      const droppable = el.getAttribute('data-droppable-thread')!;
      const parts = droppable.split('-');
      const candidateId = `${parts[0]}:${parts.slice(1).join('.')}`;

      // Check if this thread's header buttons are visible
      const pTs = parts.slice(1).join('').replace('.', '');
      const header = threadsView.querySelector(
        `[data-qa="threads_view_header"] a[href*="/archives/${parts[0]}/p${pTs}"]`
      )?.closest('[data-qa="threads_view_header"]');

      if (header) {
        const wrapper = header.querySelector('.se-thread-link-wrapper');
        const checkEl = wrapper ?? header;
        const checkRect = checkEl.getBoundingClientRect();
        if (checkRect.bottom >= scrollRect.top) {
          break;
        }
      }

      // Check if this thread's last item is mostly scrolled past
      const threadItems = threadsView.querySelectorAll(`[data-droppable-thread="${droppable}"]`);
      const lastItem = threadItems[threadItems.length - 1];
      if (lastItem) {
        const lastRect = lastItem.getBoundingClientRect();
        if (lastRect.top < scrollRect.top) {
          break;
        }
      }

      // Header not in DOM or scrolled above — float if we have cached data
      if (threadCacheMap.has(candidateId)) {
        activeThreadId = candidateId;
      }
      break;
    }
  }

  if (activeThreadId) {
    if (!floatingContainer) {
      floatingContainer = document.createElement('div');
      floatingContainer.className = 'se-floating-thread-links';
      const scrollParent = scrollEl.closest('.c-virtual_list') ?? scrollEl.parentElement;
      if (scrollParent) {
        (scrollParent as HTMLElement).style.position = (scrollParent as HTMLElement).style.position || 'relative';
        scrollParent.appendChild(floatingContainer);
      }
    }

    const currentId = floatingContainer.getAttribute('data-se-thread');
    if (currentId !== activeThreadId) {
      floatingContainer.innerHTML = '';
      floatingContainer.setAttribute('data-se-thread', activeThreadId);

      const cache = threadCacheMap.get(activeThreadId);
      if (cache && currentSettings) {
        const externalLinks = cache.links.filter((l) => !SLACK_INTERNAL_LINK_PATTERN.test(l.url));
        const threadLinks = cache.links.filter((l) => SLACK_THREAD_URL_PATTERN.test(l.url));

        if (currentSettings.threadExternalLinks) {
          const btn = document.createElement('button');
          const hasLinks = externalLinks.length > 0;
          btn.className = `${BTN_EXTERNAL_CLASS} se-thread-link-btn${hasLinks ? '' : ' se-thread-link-btn--disabled'}`;
          btn.textContent = hasLinks
            ? `🔗 ${externalLinks.length} ${externalLinks.length === 1 ? 'external link' : 'external links'}`
            : '🔗 No external links';
          btn.type = 'button';
          btn.disabled = !hasLinks;
          if (hasLinks) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (openDropdown) { closeDropdownIfOpen(); } else { showExternalLinksDropdown(activeThreadId!, externalLinks, floatingContainer!); }
            });
          }
          floatingContainer.appendChild(btn);
        }

        if (currentSettings.threadLinkedThreads) {
          const btn = document.createElement('button');
          const hasLinks = threadLinks.length > 0;
          btn.className = `${BTN_THREADS_CLASS} se-thread-link-btn${hasLinks ? '' : ' se-thread-link-btn--disabled'}`;
          btn.textContent = hasLinks
            ? `💬 ${threadLinks.length} ${threadLinks.length === 1 ? 'linked thread' : 'linked threads'}`
            : '💬 No linked threads';
          btn.type = 'button';
          btn.disabled = !hasLinks;
          if (hasLinks) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (openDropdown) { closeDropdownIfOpen(); } else { showLinkedThreadsDropdown(activeThreadId!, threadLinks, floatingContainer!); }
            });
          }
          floatingContainer.appendChild(btn);
        }
      }
    }
  } else {
    if (floatingContainer) {
      floatingContainer.remove();
      floatingContainer = null;
    }
  }
}

async function persistAndUpdateUI(
  threadId: string,
  newLinks: CachedLink[],
  container: Element,
  context: 'flexpane' | 'threads-page'
) {
  let cache = await getThreadLinks(threadId);
  if (!cache) {
    cache = { threadId, links: [], processedMsgTimestamps: [], lastUpdated: Date.now() };
  }

  if (newLinks.length > 0) {
    cache.links = mergeLinks(cache.links, newLinks);
    const set = processedMessages.get(threadId);
    cache.processedMsgTimestamps = set ? Array.from(set) : cache.processedMsgTimestamps;
    await saveThreadLinks(cache);
  }

  threadCacheMap.set(threadId, cache);
  renderButtons(threadId, cache, container, context);

  enrichGitHubPRs(threadId, cache, container, context);
}

async function enrichGitHubPRs(
  threadId: string,
  cache: ThreadLinkCache,
  container: Element,
  context: 'flexpane' | 'threads-page'
) {
  const prsToLookUp = cache.links.filter((link) => {
    if (githubPrLookedUp.has(link.url)) return false;
    const match = GITHUB_PR_URL_FULL_PATTERN.exec(link.url);
    if (!match) return false;
    if (link.title && link.title !== smartDisplayName(link.url, '')) return false;
    return true;
  });

  if (prsToLookUp.length === 0) return;

  const results = await Promise.all(
    prsToLookUp.map(async (link) => {
      githubPrLookedUp.add(link.url);
      const match = GITHUB_PR_URL_FULL_PATTERN.exec(link.url)!;
      try {
        const data = await browser.runtime.sendMessage({
          type: 'FETCH_GITHUB_PR',
          owner: match[1],
          repo: match[2],
          prNumber: match[3],
        }) as { title: string; author: string; state: string; merged: boolean } | null;
        return { link, data };
      } catch {
        return { link, data: null };
      }
    })
  );

  let updated = false;
  for (const { link, data } of results) {
    if (!data) continue;
    const match = GITHUB_PR_URL_FULL_PATTERN.exec(link.url)!;
    link.title = `#${match[3]}: ${data.title}`;
    link.authorName = data.author;
    link.description = `${match[1]}/${match[2]} · by ${data.author} · ${data.merged ? 'merged' : data.state}`;
    updated = true;
  }

  if (updated) {
    await saveThreadLinks(cache);
    threadCacheMap.set(threadId, cache);
    renderButtons(threadId, cache, container, context);
  }
}

// ── Link Extraction ─────────────────────────────────────────────────

function extractLinksFromMessage(msgEl: Element): CachedLink[] {
  const bodyBlock = msgEl.querySelector('.c-message_kit__blocks');
  if (!bodyBlock) return [];

  const anchors = bodyBlock.querySelectorAll('a.c-link');
  const contentLinks: { url: string; text: string }[] = [];

  for (const a of anchors) {
    if (
      a.classList.contains('c-timestamp') ||
      a.classList.contains('c-member_slug') ||
      a.closest('[class*="attachment"]')
    ) continue;

    const parent = a.parentElement;
    if (!parent?.classList.contains('c-mrkdwn__draggable-link')) continue;

    const href = a.getAttribute('href');
    if (!href) continue;

    contentLinks.push({ url: href, text: (a.textContent ?? '').trim() });
  }

  if (contentLinks.length === 0) return [];

  const unfurls = collectUnfurls(msgEl);
  const now = Date.now();

  return contentLinks.map(({ url, text }) => {
    const link: CachedLink = {
      url,
      domain: extractDomain(url),
      firstSeenAt: now,
    };

    const threadMatch = SLACK_THREAD_URL_PATTERN.exec(url);
    if (threadMatch) {
      link.threadId = `${threadMatch[1]}:${tsFromSlackP(threadMatch[2])}`;
    }

    const matched = matchUnfurl(url, unfurls);
    if (matched) {
      if (matched.title) link.title = matched.title;
      if (matched.description) link.description = matched.description;
      if (matched.authorName) link.authorName = matched.authorName;
      if (matched.messagePreview) link.messagePreview = matched.messagePreview;
    }

    if (!link.title) {
      link.title = smartDisplayName(url, text);
    }

    return link;
  });
}

// ── Unfurl Matching ─────────────────────────────────────────────────

interface UnfurlData {
  titleLink?: string;
  title?: string;
  description?: string;
  authorName?: string;
  messagePreview?: string;
  innerText: string;
}

function collectUnfurls(msgEl: Element): UnfurlData[] {
  const attachmentArea = msgEl.querySelector('.c-message_kit__attachments');
  if (!attachmentArea) return [];

  return Array.from(attachmentArea.children)
    .filter((el) => el.classList.contains('c-message_attachment') || el.classList.contains('c-message_attachment_v2'))
    .map((att) => {
      const titleLinkEl = att.querySelector('[data-qa="message_attachment_title_link"]');
      const titleEl = att.querySelector('[data-qa="message_attachment_title"]');
      const authorEl = att.querySelector('[data-qa="message_attachment_author_name"]');
      const textEl = att.querySelector('[data-qa*="text"]') ?? att.querySelector('.c-message_attachment__body');

      return {
        titleLink: titleLinkEl?.getAttribute('href') ?? undefined,
        title: (titleEl ?? titleLinkEl)?.textContent?.trim() ?? undefined,
        description: textEl?.textContent?.trim().slice(0, 200) ?? undefined,
        authorName: authorEl?.textContent?.trim() ?? undefined,
        messagePreview: textEl?.textContent?.trim().slice(0, 200) ?? undefined,
        innerText: (att.textContent ?? '').trim(),
      };
    });
}

function matchUnfurl(url: string, unfurls: UnfurlData[]): UnfurlData | null {
  for (const u of unfurls) {
    if (u.titleLink && u.titleLink === url) return u;
  }

  const jiraMatch = JIRA_ISSUE_URL_PATTERN.exec(url);
  if (jiraMatch) {
    const issueKey = jiraMatch[1];
    for (const u of unfurls) {
      if (u.innerText.includes(issueKey)) {
        const titleMatch = u.innerText.match(new RegExp(`${issueKey}\\s*\\[[^\\]]*\\]\\s*:\\s*(.+)`));
        if (titleMatch) {
          u.title = `${issueKey}: ${titleMatch[1].trim().split('\n')[0]}`;
        } else {
          u.title = issueKey;
        }
        return u;
      }
    }
  }

  const threadMatch = SLACK_THREAD_URL_PATTERN.exec(url);
  if (threadMatch) {
    for (const u of unfurls) {
      if (u.authorName && !u.titleLink) return u;
    }
  }

  return null;
}

// ── Smart Display Names ─────────────────────────────────────────────

function smartDisplayName(url: string, linkText: string): string {
  const ghMatch = GITHUB_PR_ISSUE_URL_PATTERN.exec(url);
  if (ghMatch) return `${ghMatch[1]}#${ghMatch[2]}`;

  const ghFileMatch = url.match(/^https:\/\/github\.com\/[^/]+\/([^/]+)\/(?:blob|tree)\/[^/]+\/(.+)/);
  if (ghFileMatch) return `${ghFileMatch[1]}/${ghFileMatch[2].split('/').pop()}`;

  const jiraMatch = JIRA_ISSUE_URL_PATTERN.exec(url);
  if (jiraMatch) return jiraMatch[1];

  if (url.includes('docs.google.com')) return 'Google Doc';

  if (linkText && linkText !== url && linkText.length < 80) return linkText;

  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    if (path && path !== '/') {
      const segments = path.split('/').filter(Boolean);
      return segments.slice(-2).join('/');
    }
    return u.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function tsFromSlackP(pTs: string): string {
  if (pTs.length > 10) {
    return pTs.slice(0, 10) + '.' + pTs.slice(10);
  }
  return pTs;
}

// ── Thread Identity ─────────────────────────────────────────────────

let flexpaneThreadId: string | null = null;

function detectThreadId(container: Element, context: 'flexpane' | 'threads-page'): string | null {
  if (context === 'flexpane') {
    const rootMsg = container.querySelector('[data-qa="message_container"][data-msg-channel-id]');
    if (rootMsg) {
      const channelId = rootMsg.getAttribute('data-msg-channel-id');
      const msgTs = rootMsg.getAttribute('data-msg-ts');
      if (channelId && msgTs) {
        flexpaneThreadId = `${channelId}:${msgTs}`;
        return flexpaneThreadId;
      }
    }
    return flexpaneThreadId;
  }
  return null;
}

// ── UI Rendering ────────────────────────────────────────────────────

function renderButtons(
  threadId: string,
  cache: ThreadLinkCache,
  container: Element,
  context: 'flexpane' | 'threads-page'
) {
  if (!currentSettings) return;

  const externalLinks = cache.links.filter((l) => !SLACK_INTERNAL_LINK_PATTERN.test(l.url));
  const threadLinks = cache.links.filter((l) => SLACK_THREAD_URL_PATTERN.test(l.url));

  const headerEl = context === 'flexpane'
    ? container.querySelector('.p-flexpane_header__primary')
    : container;

  if (!headerEl) return;

  if (currentSettings.threadExternalLinks) {
    const hasLinks = externalLinks.length > 0;
    renderOrUpdateButton(
      headerEl, threadId, BTN_EXTERNAL_CLASS,
      externalLinks.length,
      hasLinks
        ? (externalLinks.length === 1 ? 'external link' : 'external links')
        : 'No external links',
      '🔗', context, hasLinks,
      () => showExternalLinksDropdown(threadId, externalLinks, headerEl)
    );
  } else {
    const wrapper = headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`);
    wrapper?.querySelector(`.${BTN_EXTERNAL_CLASS}`)?.remove();
  }

  if (currentSettings.threadLinkedThreads) {
    const hasLinks = threadLinks.length > 0;
    renderOrUpdateButton(
      headerEl, threadId, BTN_THREADS_CLASS,
      threadLinks.length,
      hasLinks
        ? (threadLinks.length === 1 ? 'linked thread' : 'linked threads')
        : 'No linked threads',
      '💬', context, hasLinks,
      () => showLinkedThreadsDropdown(threadId, threadLinks, headerEl)
    );
  } else {
    const wrapper = headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`);
    wrapper?.querySelector(`.${BTN_THREADS_CLASS}`)?.remove();
  }

  const featureEnabled = currentSettings.threadExternalLinks || currentSettings.threadLinkedThreads;
  if (!featureEnabled) {
    headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`)?.remove();
  }
}

function renderOrUpdateButton(
  headerEl: Element,
  threadId: string,
  btnClass: string,
  count: number,
  label: string,
  icon: string,
  context: 'flexpane' | 'threads-page',
  enabled: boolean,
  onClick: () => void
) {
  let wrapper = headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`) as HTMLElement | null;

  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'se-thread-link-wrapper';
    wrapper.setAttribute('data-se-thread', threadId);

    if (context === 'flexpane') {
      const moreBtn = headerEl.querySelector('[data-qa="secondary-header-more"]');
      if (moreBtn) {
        headerEl.insertBefore(wrapper, moreBtn);
      } else {
        headerEl.appendChild(wrapper);
      }
    } else {
      const permalink = headerEl.querySelector('a.p-threads_view_header__permalink');
      if (permalink) {
        permalink.after(wrapper);
      } else {
        headerEl.appendChild(wrapper);
      }
    }
  }

  let btn = wrapper.querySelector(`.${btnClass}`) as HTMLButtonElement | null;
  const text = enabled ? `${icon} ${count} ${label}` : `${icon} ${label}`;

  if (btn) {
    btn.textContent = text;
    btn.disabled = !enabled;
    btn.classList.toggle('se-thread-link-btn--disabled', !enabled);
    return;
  }

  btn = document.createElement('button');
  btn.className = `${btnClass} se-thread-link-btn${enabled ? '' : ' se-thread-link-btn--disabled'}`;
  btn.textContent = text;
  btn.type = 'button';
  btn.disabled = !enabled;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openDropdown) {
      closeDropdownIfOpen();
    } else {
      onClick();
    }
  });

  wrapper.appendChild(btn);
}

// ── Dropdown Menus ──────────────────────────────────────────────────

function closeDropdownIfOpen() {
  if (openDropdown) {
    openDropdown.remove();
    openDropdown = null;
  }
  if (closeDropdownHandler) {
    document.removeEventListener('click', closeDropdownHandler);
    document.removeEventListener('keydown', closeDropdownHandler);
    closeDropdownHandler = null;
  }
}

function attachDropdown(dropdown: HTMLElement) {
  closeDropdownIfOpen();
  openDropdown = dropdown;

  closeDropdownHandler = (e: MouseEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    if (e instanceof MouseEvent && dropdown.contains(e.target as Node)) return;
    closeDropdownIfOpen();
  };

  setTimeout(() => {
    document.addEventListener('click', closeDropdownHandler!);
    document.addEventListener('keydown', closeDropdownHandler!);
  }, 0);
}

function createCopyButton(url: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'se-link-copy-btn';
  btn.type = 'button';
  btn.title = 'Copy link';
  btn.textContent = '📋';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(url).then(() => {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 1500);
    });
  });
  return btn;
}

function showExternalLinksDropdown(
  _threadId: string,
  links: CachedLink[],
  headerEl: Element
) {
  const dropdown = document.createElement('div');
  dropdown.className = DROPDOWN_CLASS;

  const grouped = new Map<string, CachedLink[]>();
  for (const link of links) {
    const group = grouped.get(link.domain) ?? [];
    group.push(link);
    grouped.set(link.domain, group);
  }

  const sortedDomains = Array.from(grouped.keys()).sort((a, b) => {
    const priority = (d: string) => {
      if (d.includes('atlassian.net')) return 0;
      if (d.includes('github.com')) return 1;
      return 2;
    };
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });

  for (const domain of sortedDomains) {
    const groupEl = document.createElement('div');
    groupEl.className = 'se-link-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'se-link-group-header';

    const favicon = document.createElement('img');
    favicon.className = 'se-link-favicon';
    favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    favicon.width = 16;
    favicon.height = 16;
    favicon.alt = '';

    const domainLabel = document.createElement('span');
    domainLabel.className = 'se-link-domain';
    domainLabel.textContent = domain;

    groupHeader.appendChild(favicon);
    groupHeader.appendChild(domainLabel);
    groupEl.appendChild(groupHeader);

    for (const link of grouped.get(domain)!) {
      const itemEl = document.createElement('div');
      itemEl.className = 'se-link-item';

      const linkEl = document.createElement('a');
      linkEl.className = 'se-link-item-content';
      linkEl.href = link.url;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';

      const titleEl = document.createElement('div');
      titleEl.className = 'se-link-title';
      titleEl.textContent = link.title ?? link.url;
      linkEl.appendChild(titleEl);

      if (link.description) {
        const descEl = document.createElement('div');
        descEl.className = 'se-link-description';
        descEl.textContent = link.description.slice(0, 120) + (link.description.length > 120 ? '…' : '');
        linkEl.appendChild(descEl);
      }

      itemEl.appendChild(linkEl);
      itemEl.appendChild(createCopyButton(link.url));

      groupEl.appendChild(itemEl);
    }

    dropdown.appendChild(groupEl);
  }

  const wrapper = headerEl.querySelector(`.se-thread-link-wrapper`);
  if (wrapper) {
    wrapper.appendChild(dropdown);
  } else {
    headerEl.appendChild(dropdown);
  }

  attachDropdown(dropdown);
}

function showLinkedThreadsDropdown(
  _threadId: string,
  links: CachedLink[],
  headerEl: Element
) {
  const dropdown = document.createElement('div');
  dropdown.className = DROPDOWN_CLASS;

  const sorted = [...links].sort((a, b) => {
    const aTs = a.threadId?.split(':')[1] ?? '0';
    const bTs = b.threadId?.split(':')[1] ?? '0';
    return parseFloat(bTs) - parseFloat(aTs);
  });

  for (const link of sorted) {
    const itemEl = document.createElement('div');
    itemEl.className = 'se-linked-thread-item';

    const linkEl = document.createElement('a');
    linkEl.className = 'se-linked-thread-item-content';
    linkEl.href = link.url;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';

    if (link.channelName || link.authorName) {
      const metaEl = document.createElement('div');
      metaEl.className = 'se-linked-thread-meta';

      if (link.channelName) {
        const channelEl = document.createElement('span');
        channelEl.className = 'se-linked-thread-channel';
        channelEl.textContent = `#${link.channelName}`;
        metaEl.appendChild(channelEl);
      }
      if (link.authorName) {
        const authorEl = document.createElement('span');
        authorEl.className = 'se-linked-thread-author';
        authorEl.textContent = link.authorName;
        metaEl.appendChild(authorEl);
      }
      linkEl.appendChild(metaEl);
    }

    const previewEl = document.createElement('div');
    previewEl.className = 'se-linked-thread-preview';
    previewEl.textContent = link.messagePreview ?? link.title ?? link.url;
    linkEl.appendChild(previewEl);

    itemEl.appendChild(linkEl);
    itemEl.appendChild(createCopyButton(link.url));

    dropdown.appendChild(itemEl);
  }

  const wrapper = headerEl.querySelector(`.se-thread-link-wrapper`);
  if (wrapper) {
    wrapper.appendChild(dropdown);
  } else {
    headerEl.appendChild(dropdown);
  }

  attachDropdown(dropdown);
}
