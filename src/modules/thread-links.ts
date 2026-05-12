import { observeDOM } from '../shared/dom-utils';
import {
  SLACK_THREAD_URL_PATTERN,
  SLACK_INTERNAL_LINK_PATTERN,
  JIRA_ISSUE_URL_PATTERN,
  GITHUB_PR_ISSUE_URL_PATTERN,
  GITHUB_PR_URL_FULL_PATTERN,
} from '../shared/constants';
import { getThreadLinks, saveThreadLinks, mergeLinks } from '../shared/link-cache';
import { requestSpaNav, parseSlackThreadUrl } from '../shared/slack-nav-client';
import type { ExtensionSettings, CachedLink, ThreadLinkCache, ThreadRootInfo } from '../types';

let active = false;
let disconnectObserver: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentSettings: ExtensionSettings | null = null;
const processedMessages = new Map<string, Set<string>>();
let openDropdown: HTMLElement | null = null;
let openDropdownTrigger: HTMLElement | null = null;
let closeDropdownHandler: ((e: MouseEvent | KeyboardEvent) => void) | null = null;
let threadsPageScrollHandler: (() => void) | null = null;
let threadsPageScrollEl: Element | null = null;
let floatingContainer: HTMLElement | null = null;
let scrollScanTimer: ReturnType<typeof setTimeout> | null = null;
let flexpaneScrollHandler: (() => void) | null = null;
let flexpaneScrollEl: Element | null = null;
const threadCacheMap = new Map<string, ThreadLinkCache>();
const githubPrLookedUp = new Set<string>();

const SCANNED_MARKER = 'data-se-links-scanned';
const BTN_TOP_CLASS = 'se-top-of-thread-btn';
const BTN_EXTERNAL_CLASS = 'se-thread-links-btn';
const BTN_THREADS_CLASS = 'se-linked-threads-btn';
const DROPDOWN_CLASS = 'se-thread-link-dropdown';

// ── Public API ──────────────────────────────────────────────────────

export function initThreadLinks(_wsId: string, settings: ExtensionSettings) {
  const settingsChanged = currentSettings &&
    (currentSettings.threadExternalLinks !== settings.threadExternalLinks ||
     currentSettings.threadLinkedThreads !== settings.threadLinkedThreads ||
     currentSettings.threadTopButton !== settings.threadTopButton);
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

  disconnectObserver = observeDOM(document.body, (mutations) => {
    let dominated = false;
    for (const m of mutations) {
      if (m.type !== 'childList') continue;
      const t = m.target as Element;
      if (t.closest?.('.c-virtual_list__scroll_container')) continue;
      dominated = true;
      break;
    }
    if (!dominated) return;
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

  teardownFlexpaneScroll();
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

  let set = processedMessages.get(threadId);
  if (!set) {
    set = new Set();
    processedMessages.set(threadId, set);
  }

  for (const msg of messages) {
    const msgTs = msg.getAttribute('data-msg-ts');
    if (msg.getAttribute(SCANNED_MARKER) === msgTs) continue;
    msg.setAttribute(SCANNED_MARKER, msgTs ?? 'true');
    if (msgTs && set.has(msgTs)) continue;
    if (msgTs) set.add(msgTs);

    foundNew = true;
    newLinks.push(...extractLinksFromMessage(msg));
  }

  if (foundNew || !container.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`) || !threadCacheMap.has(threadId)) {
    persistAndUpdateUI(threadId, newLinks, container, context);
  }

  if (context === 'flexpane') {
    setupFlexpaneScroll(container);
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
    if (droppableAttr) {
      const parts = droppableAttr.split('-');
      if (parts.length >= 2) {
        const droppableId = `${parts[0]}:${parts.slice(1).join('.')}`;
        if (droppableId !== currentThreadId) {
          currentThreadId = droppableId;
          currentHeader = null;
        }
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

    let set = processedMessages.get(threadId);
    if (!set) {
      set = new Set();
      processedMessages.set(threadId, set);
    }

    for (const msg of group.messages) {
      const msgTs = msg.getAttribute('data-msg-ts');
      if (msg.getAttribute(SCANNED_MARKER) === msgTs) continue;
      msg.setAttribute(SCANNED_MARKER, msgTs ?? 'true');
      if (msgTs && set.has(msgTs)) continue;
      if (msgTs) set.add(msgTs);

      foundNew = true;
      newLinks.push(...extractLinksFromMessage(msg));
    }

    if (foundNew || (group.headerEl && !group.headerEl.querySelector('.se-thread-link-wrapper')) || !threadCacheMap.has(threadId)) {
      persistAndUpdateUI(threadId, newLinks, group.headerEl, 'threads-page');
    }
  }

  setupThreadsPageScroll(threadsView);
}

// ── Flexpane Scroll ─────────────────────────────────────────────────

function setupFlexpaneScroll(container: Element) {
  const scrollEl = container.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl || scrollEl === flexpaneScrollEl) return;

  teardownFlexpaneScroll();
  flexpaneScrollEl = scrollEl;
  flexpaneScrollHandler = () => updateTopOfThreadButton(container, 'flexpane');
  scrollEl.addEventListener('scroll', flexpaneScrollHandler, { passive: true });
}

function teardownFlexpaneScroll() {
  if (flexpaneScrollEl && flexpaneScrollHandler) {
    flexpaneScrollEl.removeEventListener('scroll', flexpaneScrollHandler);
  }
  flexpaneScrollEl = null;
  flexpaneScrollHandler = null;
}

function updateTopOfThreadButton(container: Element, context: 'flexpane' | 'threads-page') {
  const headerEl = context === 'flexpane'
    ? container.querySelector('.p-flexpane_header__primary')
    : container;
  if (!headerEl) return;

  const btn = headerEl.querySelector(`.${BTN_TOP_CLASS}`) as HTMLButtonElement | null;
  if (!btn) return;

  const atTop = isAtTopOfThread(container, context);
  btn.disabled = atTop;
  btn.classList.toggle('se-thread-link-btn--disabled', atTop);
}

// ── Floating Buttons on Threads Page ────────────────────────────────

function setupThreadsPageScroll(threadsView: Element) {
  const scrollEl = threadsView.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl || scrollEl === threadsPageScrollEl) return;

  teardownThreadsPageScroll();
  threadsPageScrollEl = scrollEl;

  threadsPageScrollHandler = () => {
    updateFloatingButtons();
    if (scrollScanTimer) clearTimeout(scrollScanTimer);
    scrollScanTimer = setTimeout(() => {
      const tv = document.querySelector('[data-qa="threads_view"]');
      if (tv) scanThreadsPage(tv);
    }, 150);
  };
  scrollEl.addEventListener('scroll', threadsPageScrollHandler, { passive: true });
  updateFloatingButtons();
}

function teardownThreadsPageScroll() {
  if (scrollScanTimer) {
    clearTimeout(scrollScanTimer);
    scrollScanTimer = null;
  }
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

        const topBtn = document.createElement('button');
        topBtn.className = `${BTN_TOP_CLASS} se-thread-link-btn`;
        const topLabel = document.createElement('span');
        topLabel.innerHTML = TOP_OF_THREAD_SVG;
        topBtn.appendChild(topLabel);
        if (cache.rootInfo) {
          const alignRight = !currentSettings?.threadExternalLinks || !currentSettings?.threadLinkedThreads;
          topBtn.appendChild(buildTooltipContent(cache.rootInfo, alignRight));
        }
        topBtn.type = 'button';
        topBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const threadsView = document.querySelector('[data-qa="threads_view"]');
          if (threadsView) {
            scrollToTopOfThread(activeThreadId!, threadsView, 'threads-page');
          }
        });
        floatingContainer.appendChild(topBtn);

        if (currentSettings.threadExternalLinks) {
          const btn = document.createElement('button');
          const hasLinks = externalLinks.length > 0;
          btn.className = `${BTN_EXTERNAL_CLASS} se-thread-link-btn${hasLinks ? '' : ' se-thread-link-btn--disabled'}`;
          btn.appendChild(buildButtonContent(
            '🔗',
            externalLinks.length,
            hasLinks ? (externalLinks.length === 1 ? 'link' : 'links') : 'No links',
            hasLinks,
            externalLinks.map((l) => l.domain)
          ));
          btn.type = 'button';
          btn.disabled = !hasLinks;
          if (hasLinks) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (openDropdown && openDropdownTrigger === btn) { closeDropdownIfOpen(); } else { closeDropdownIfOpen(); openDropdownTrigger = btn; showExternalLinksDropdown(activeThreadId!, externalLinks, floatingContainer!); }
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
              if (openDropdown && openDropdownTrigger === btn) { closeDropdownIfOpen(); } else { closeDropdownIfOpen(); openDropdownTrigger = btn; showLinkedThreadsDropdown(activeThreadId!, threadLinks, floatingContainer!); }
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
  container: Element | null,
  context: 'flexpane' | 'threads-page'
) {
  let cache = await getThreadLinks(threadId);
  if (!cache) {
    cache = { threadId, links: [], processedMsgTimestamps: [], lastUpdated: Date.now() };
  }

  let dirty = newLinks.length > 0;
  if (newLinks.length > 0) {
    cache.links = mergeLinks(cache.links, newLinks);
    const set = processedMessages.get(threadId);
    cache.processedMsgTimestamps = set ? Array.from(set) : cache.processedMsgTimestamps;
  }

  if (container) {
    const rootInfo = getRootMessageInfo(threadId, container, context);
    if (rootInfo && rootInfo.text) {
      cache.rootInfo = rootInfo;
      dirty = true;
    }
  }

  if (dirty) {
    await saveThreadLinks(cache);
  }

  threadCacheMap.set(threadId, cache);

  if (container) {
    renderButtons(threadId, cache, container, context);
    enrichGitHubPRs(threadId, cache, container, context);
  }

  if (floatingContainer?.getAttribute('data-se-thread') === threadId) {
    floatingContainer.remove();
    floatingContainer = null;
    updateFloatingButtons();
  }
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
  const msgTs = msgEl.getAttribute('data-msg-ts') ?? undefined;
  const msgChannelId = msgEl.getAttribute('data-msg-channel-id') ?? undefined;

  return contentLinks.map(({ url, text }) => {
    const link: CachedLink = {
      url,
      domain: extractDomain(url),
      sourceMsgTs: msgTs,
      sourceChannelId: msgChannelId,
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
      if (matched.footerText) {
        const channelMatch = matched.footerText.match(/thread in\s+#?(\S+)/i);
        if (channelMatch) link.channelName = channelMatch[1];
      }
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
  footerText?: string;
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
      const footerEl = att.querySelector('[data-qa="message_attachment_footer"]') ?? att.querySelector('.c-message_attachment__footer');

      return {
        titleLink: titleLinkEl?.getAttribute('href') ?? undefined,
        title: (titleEl ?? titleLinkEl)?.textContent?.trim() ?? undefined,
        description: textEl?.textContent?.trim().slice(0, 200) ?? undefined,
        authorName: authorEl?.textContent?.trim() ?? undefined,
        messagePreview: textEl?.textContent?.trim().slice(0, 200) ?? undefined,
        footerText: footerEl?.textContent?.trim() ?? undefined,
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
    if (flexpaneThreadId) return flexpaneThreadId;

    const timestamps = container.querySelectorAll('.c-timestamp[href]');
    for (const ts of timestamps) {
      const href = ts.getAttribute('href');
      if (!href) continue;
      const match = SLACK_THREAD_URL_PATTERN.exec(href);
      if (!match) continue;
      const channelId = match[1];
      const threadTs = href.match(/thread_ts=([0-9.]+)/)?.[1];
      if (threadTs) {
        flexpaneThreadId = `${channelId}:${threadTs}`;
        return flexpaneThreadId;
      }
      flexpaneThreadId = `${channelId}:${tsFromSlackP(match[2])}`;
      return flexpaneThreadId;
    }
    return null;
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
        ? (externalLinks.length === 1 ? 'link' : 'links')
        : 'No links',
      '🔗', context, hasLinks,
      () => showExternalLinksDropdown(threadId, externalLinks, headerEl),
      externalLinks.map((l) => l.domain)
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

  const featureEnabled = currentSettings.threadExternalLinks || currentSettings.threadLinkedThreads || currentSettings.threadTopButton;
  if (!featureEnabled) {
    headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`)?.remove();
  }

  if (currentSettings.threadTopButton && context === 'flexpane') {
    const rootInfo = getRootMessageInfo(threadId, container, context) ?? cache.rootInfo ?? null;
    renderTopOfThreadButton(headerEl, threadId, container, context, rootInfo);
  } else {
    const wrapper = headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`);
    wrapper?.querySelector(`.${BTN_TOP_CLASS}`)?.remove();
  }
}

function getRootMessageInfo(threadId: string, container: Element, context: 'flexpane' | 'threads-page'): ThreadRootInfo | null {
  let msgEl: Element | null = null;
  let channelName: string | undefined;

  if (context === 'flexpane') {
    msgEl = container.querySelector('[data-qa="message_container"][data-msg-channel-id]');
    const titleContainer = container.querySelector('[data-qa="flexpane-title-container"]');
    const subtitle = titleContainer?.querySelector('[data-qa="subtitle"]');
    if (subtitle?.textContent?.trim()) channelName = subtitle.textContent.trim();
  } else {
    const droppableKey = threadId.replace(':', '-');
    const rootTs = threadId.split(':')[1];
    msgEl = document.querySelector(`[data-droppable-thread="${droppableKey}"] [data-msg-ts="${rootTs}"]`)
      ?? document.querySelector(`[data-droppable-thread="${droppableKey}"] [data-qa="message_container"]`);
    const channelEntity = container.querySelector('[data-qa="inline_channel_entity"]');
    if (channelEntity) channelName = channelEntity.textContent?.trim();
  }

  if (!msgEl) return null;

  const author = msgEl.querySelector('[data-qa="message_sender_name"]')?.textContent?.trim();
  const rawText = msgEl.querySelector('.p-rich_text_section')?.textContent?.trim();
  const text = rawText ? (rawText.length > 100 ? rawText.slice(0, 100) + '…' : rawText) : undefined;
  const tsEl = msgEl.querySelector('.c-timestamp');
  const date = tsEl?.textContent?.trim();

  return { author, text, channelName, date };
}

function isAtTopOfThread(container: Element, context: 'flexpane' | 'threads-page'): boolean {
  const scrollEl = container.querySelector('[data-qa="slack_kit_scrollbar"]')
    ?? container.closest('[data-qa="threads_view"]')?.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl) return true;
  return scrollEl.scrollTop <= 10;
}

function scrollToTopOfThread(threadId: string, container: Element, context: 'flexpane' | 'threads-page') {
  if (context === 'flexpane') {
    const scrollEl = container.querySelector('[data-qa="slack_kit_scrollbar"]');
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  const parts = threadId.split(':');
  const channelId = parts[0];
  const pTs = parts.length >= 2 ? parts[1].replace('.', '') : '';
  const threadsView = document.querySelector('[data-qa="threads_view"]');
  const scrollEl = threadsView?.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl) return;

  const findHeader = () => threadsView?.querySelector(
    `[data-qa="threads_view_header"] a[href*="/archives/${channelId}/p${pTs}"]`
  )?.closest('[data-qa="threads_view_header"]');

  const header = findHeader();
  if (header) {
    header.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  let attempts = 0;
  const scrollStep = scrollEl.clientHeight * 0.7;
  const tryScroll = () => {
    const found = findHeader();
    if (found) {
      found.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (++attempts > 50) return;
    scrollEl.scrollTop -= scrollStep;
    setTimeout(tryScroll, 250);
  };
  scrollEl.scrollTop -= scrollStep;
  setTimeout(tryScroll, 250);
}

function buildTooltipContent(info: ThreadRootInfo, alignRight = false): HTMLElement {
  const tooltip = document.createElement('div');
  tooltip.className = `se-top-tooltip${alignRight ? ' se-top-tooltip--right' : ''}`;

  if (info.author) {
    const authorEl = document.createElement('div');
    authorEl.className = 'se-top-tooltip-author';
    authorEl.textContent = info.author;
    tooltip.appendChild(authorEl);
  }

  if (info.text) {
    const textEl = document.createElement('div');
    textEl.className = 'se-top-tooltip-text';
    textEl.textContent = info.text;
    tooltip.appendChild(textEl);
  }

  const footerParts: string[] = [];
  if (info.channelName) footerParts.push(`Thread in #${info.channelName}`);
  if (info.date) footerParts.push(info.date);
  if (footerParts.length > 0) {
    const footerEl = document.createElement('div');
    footerEl.className = 'se-top-tooltip-footer';
    footerEl.textContent = footerParts.join(' · ');
    tooltip.appendChild(footerEl);
  }

  return tooltip;
}

function renderTopOfThreadButton(
  headerEl: Element,
  threadId: string,
  container: Element,
  context: 'flexpane' | 'threads-page',
  rootInfo?: ThreadRootInfo | null
) {
  let wrapper = headerEl.querySelector(`.se-thread-link-wrapper[data-se-thread="${threadId}"]`) as HTMLElement | null;

  if (!wrapper) return;

  let btn = wrapper.querySelector(`.${BTN_TOP_CLASS}`) as HTMLButtonElement | null;
  const atTop = isAtTopOfThread(container, context);

  if (btn) {
    btn.disabled = atTop;
    btn.classList.toggle('se-thread-link-btn--disabled', atTop);
    if (rootInfo) {
      const existing = btn.querySelector('.se-top-tooltip');
      if (existing) existing.remove();
      const alignRight = !currentSettings?.threadExternalLinks || !currentSettings?.threadLinkedThreads;
      btn.appendChild(buildTooltipContent(rootInfo, alignRight));
    }
    return;
  }

  btn = document.createElement('button');
  btn.className = `${BTN_TOP_CLASS} se-thread-link-btn${atTop ? ' se-thread-link-btn--disabled' : ''}`;
  btn.type = 'button';
  btn.disabled = atTop;

  const label = document.createElement('span');
  label.innerHTML = TOP_OF_THREAD_SVG;
  btn.appendChild(label);

  if (rootInfo) {
    const alignRight = !currentSettings?.threadExternalLinks || !currentSettings?.threadLinkedThreads;
    btn.appendChild(buildTooltipContent(rootInfo, alignRight));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    scrollToTopOfThread(threadId, container, context);
  });

  wrapper.insertBefore(btn, wrapper.firstChild);
}

function domainPriority(d: string): number {
  if (d.includes('atlassian.net')) return 0;
  if (d.includes('github.com')) return 1;
  return 2;
}

function domainSortCompare(a: string, b: string): number {
  const pa = domainPriority(a);
  const pb = domainPriority(b);
  if (pa !== pb) return pa - pb;
  return a.localeCompare(b);
}

function buildButtonContent(
  icon: string,
  count: number,
  label: string,
  enabled: boolean,
  domains?: string[]
): DocumentFragment {
  const frag = document.createDocumentFragment();

  if (enabled && domains && domains.length > 0) {
    const isDark = document.body.classList.contains('sk-client-theme--dark');
    const uniqueDomains = [...new Set(domains)].sort(domainSortCompare);
    for (const domain of uniqueDomains) {
      const img = document.createElement('img');
      img.className = 'se-btn-favicon';
      if (domain === 'github.com' && isDark) {
        img.src = 'https://github.githubassets.com/favicons/favicon-dark.svg';
      } else {
        img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
      }
      img.width = 14;
      img.height = 14;
      img.alt = domain;
      frag.appendChild(img);
    }
  }

  const textNode = document.createTextNode(
    enabled && domains && domains.length > 0
      ? `${count} ${label}`
      : enabled ? `${icon} ${count} ${label}` : `${icon} ${label}`
  );
  frag.appendChild(textNode);

  return frag;
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
  onClick: () => void,
  domains?: string[]
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

  if (btn) {
    btn.innerHTML = '';
    btn.appendChild(buildButtonContent(icon, count, label, enabled, domains));
    btn.disabled = !enabled;
    btn.classList.toggle('se-thread-link-btn--disabled', !enabled);
    return;
  }

  btn = document.createElement('button');
  btn.className = `${btnClass} se-thread-link-btn${enabled ? '' : ' se-thread-link-btn--disabled'}`;
  btn.appendChild(buildButtonContent(icon, count, label, enabled, domains));
  btn.type = 'button';
  btn.disabled = !enabled;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openDropdown && openDropdownTrigger === btn) {
      closeDropdownIfOpen();
    } else {
      closeDropdownIfOpen();
      openDropdownTrigger = btn;
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
    openDropdownTrigger = null;
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

const TOP_OF_THREAD_SVG = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a7 7 0 1 0 3.394 13.124.75.75 0 0 1 .542-.074l2.794.68-.68-2.794a.75.75 0 0 1 .073-.542A7 7 0 0 0 10 3m-8.5 7a8.5 8.5 0 1 1 16.075 3.859l.904 3.714a.75.75 0 0 1-.906.906l-3.714-.904A8.5 8.5 0 0 1 1.5 10M6 8.25a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 6 8.25M6.75 11a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5z" clip-rule="evenodd"/></svg>';

const SCROLL_TO_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6"/><line x1="10" y1="2" x2="10" y2="5"/><line x1="10" y1="15" x2="10" y2="18"/><line x1="2" y1="10" x2="5" y2="10"/><line x1="15" y1="10" x2="18" y2="10"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>';

const OPEN_NEW_TAB_SVG = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-3.5a.75.75 0 0 1 1.5 0v3.5a2.25 2.25 0 0 1-2.25 2.25h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h3.5a.75.75 0 0 1 0 1.5zM10 3.75a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V5.56l-5.22 5.22a.75.75 0 1 1-1.06-1.06l5.22-5.22H10.75A.75.75 0 0 1 10 3.75" /></svg>';

const COPY_LINK_SVG = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.306 3.756a2.75 2.75 0 0 1 3.889 0l.05.05a2.75 2.75 0 0 1 0 3.889l-3.18 3.18a2.75 2.75 0 0 1-3.98-.095l-.03-.034a.75.75 0 0 0-1.11 1.009l.03.034a4.25 4.25 0 0 0 6.15.146l3.18-3.18a4.25 4.25 0 0 0 0-6.01l-.05-.05a4.25 4.25 0 0 0-6.01 0L9.47 4.47a.75.75 0 1 0 1.06 1.06zm-4.611 12.49a2.75 2.75 0 0 1-3.89 0l-.05-.051a2.75 2.75 0 0 1 0-3.89l3.18-3.179a2.75 2.75 0 0 1 3.98.095l.03.034a.75.75 0 1 0 1.11-1.01l-.03-.033a4.25 4.25 0 0 0-6.15-.146l-3.18 3.18a4.25 4.25 0 0 0 0 6.01l.05.05a4.25 4.25 0 0 0 6.01 0l1.775-1.775a.75.75 0 0 0-1.06-1.06z" clip-rule="evenodd"/></svg>';

function createCopyButton(url: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'se-link-copy-btn';
  btn.type = 'button';
  btn.title = 'Copy link';
  btn.innerHTML = COPY_LINK_SVG;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(url).then(() => {
      const orig = btn.innerHTML;
      btn.textContent = 'Copied!';
      btn.classList.add('se-copied-feedback');
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('se-copied-feedback');
      }, 1200);
    });
  });
  return btn;
}

function createOpenInNewTabButton(url: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'se-link-newtab-btn';
  btn.type = 'button';
  btn.title = 'Open in new tab';
  btn.innerHTML = OPEN_NEW_TAB_SVG;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDropdownIfOpen();
    window.open(url, '_blank', 'noopener,noreferrer');
  });
  return btn;
}

function scrollToMessageInFlexpane(msgTs: string) {
  const flexpane = document.querySelector('[data-qa="threads_flexpane"]');
  if (!flexpane) return;

  const scrollEl = flexpane.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl) return;

  const existing = flexpane.querySelector(`[data-msg-ts="${msgTs}"]`);
  if (existing) {
    existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightMessage(existing);
    return;
  }

  let attempts = 0;
  const maxAttempts = 50;
  const scrollStep = scrollEl.clientHeight * 0.7;
  let direction = -1;
  let hitTop = false;

  const tryScroll = () => {
    const found = flexpane.querySelector(`[data-msg-ts="${msgTs}"]`);
    if (found) {
      found.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightMessage(found);
      return;
    }
    if (++attempts > maxAttempts) return;

    if (!hitTop && scrollEl.scrollTop <= 0) {
      hitTop = true;
      direction = 1;
    }
    scrollEl.scrollTop += direction * scrollStep;
    setTimeout(tryScroll, 250);
  };

  scrollEl.scrollTop += direction * scrollStep;
  setTimeout(tryScroll, 250);
}

function highlightMessage(el: Element) {
  el.classList.add('se-highlight-message');
  setTimeout(() => el.classList.remove('se-highlight-message'), 2000);
}

function openThreadAndScrollTo(threadId: string, msgTs: string, linkedThreadUrl?: string) {
  if (linkedThreadUrl) {
    const found = findAndClickViewReply(msgTs, linkedThreadUrl);
    if (found) return;
    scrollToMessageThenClickViewReply(msgTs, linkedThreadUrl);
    return;
  }

  const droppableKey = threadId.replace(':', '-');
  const threadItems = document.querySelectorAll(`[data-droppable-thread="${droppableKey}"]`);
  const parts = threadId.split(':');
  const rootTs = parts.length >= 2 ? parts[1] : null;

  for (const item of threadItems) {
    const msg = item.querySelector('[data-qa="message_container"]');
    if (msg && msg.getAttribute('data-msg-ts') === rootTs) continue;
    const timestamp = item.querySelector('.c-timestamp');
    if (timestamp instanceof HTMLElement) {
      timestamp.click();
      waitForFlexpaneAndScroll(msgTs);
      return;
    }
  }
}

function findAndClickViewReply(msgTs: string, linkedThreadUrl: string): boolean {
  const flexpane = document.querySelector('[data-qa="threads_flexpane"]');
  const msg = flexpane?.querySelector(`[data-msg-ts="${msgTs}"]`) ?? document.querySelector(`[data-msg-ts="${msgTs}"]`);
  if (!msg) return false;

  const attachments = msg.querySelectorAll('.c-message_attachment');
  for (const att of attachments) {
    const links = att.querySelectorAll('a');
    for (const link of links) {
      const text = link.textContent?.trim().toLowerCase();
      if (text === 'view reply' || text === 'view message' || text === 'view thread') {
        (link as HTMLElement).click();
        return true;
      }
    }
  }
  return false;
}

function scrollToMessageThenClickViewReply(msgTs: string, linkedThreadUrl: string) {
  const flexpane = document.querySelector('[data-qa="threads_flexpane"]');
  if (!flexpane) return;

  const scrollEl = flexpane.querySelector('[data-qa="slack_kit_scrollbar"]');
  if (!scrollEl) return;

  let attempts = 0;
  const maxAttempts = 50;
  const scrollStep = scrollEl.clientHeight * 0.7;
  let direction = -1;
  let hitTop = false;

  const tryScroll = () => {
    if (findAndClickViewReply(msgTs, linkedThreadUrl)) return;
    if (++attempts > maxAttempts) return;

    if (!hitTop && scrollEl.scrollTop <= 0) {
      hitTop = true;
      direction = 1;
    }
    scrollEl.scrollTop += direction * scrollStep;
    setTimeout(tryScroll, 250);
  };

  scrollEl.scrollTop += direction * scrollStep;
  setTimeout(tryScroll, 250);
}

function openThreadScrollAndClickViewReply(threadId: string, msgTs: string, linkedThreadUrl: string) {
  const droppableKey = threadId.replace(':', '-');
  const threadItems = document.querySelectorAll(`[data-droppable-thread="${droppableKey}"]`);
  const parts = threadId.split(':');
  const rootTs = parts.length >= 2 ? parts[1] : null;

  for (const item of threadItems) {
    const msg = item.querySelector('[data-qa="message_container"]');
    if (msg && msg.getAttribute('data-msg-ts') === rootTs) continue;
    const timestamp = item.querySelector('.c-timestamp');
    if (timestamp instanceof HTMLElement) {
      timestamp.click();
      waitForFlexpaneThenScrollAndClick(msgTs, linkedThreadUrl);
      return;
    }
  }
}

function waitForFlexpaneThenScrollAndClick(msgTs: string, linkedThreadUrl: string) {
  let checks = 0;
  const poll = () => {
    const flexpane = document.querySelector('[data-qa="threads_flexpane"]');
    if (flexpane) {
      const waitForMessages = () => {
        const msgs = flexpane.querySelectorAll('[data-qa="message_container"]');
        if (msgs.length > 1) {
          setTimeout(() => scrollToMessageThenClickViewReply(msgTs, linkedThreadUrl), 300);
          return;
        }
        if (++checks < 60) setTimeout(waitForMessages, 200);
      };
      waitForMessages();
      return;
    }
    if (++checks < 60) setTimeout(poll, 200);
  };
  setTimeout(poll, 200);
}

function waitForFlexpaneAndScroll(msgTs: string) {
  let checks = 0;
  const poll = () => {
    const flexpane = document.querySelector('[data-qa="threads_flexpane"]');
    if (flexpane) {
      const waitForMessages = () => {
        const msgs = flexpane.querySelectorAll('[data-qa="message_container"]');
        if (msgs.length > 1) {
          setTimeout(() => scrollToMessageInFlexpane(msgTs), 300);
          return;
        }
        if (++checks < 60) setTimeout(waitForMessages, 200);
      };
      waitForMessages();
      return;
    }
    if (++checks < 60) setTimeout(poll, 200);
  };
  setTimeout(poll, 200);
}

function createGoToMessageButton(link: CachedLink, threadId: string, isFlexpane: boolean): HTMLButtonElement | null {
  if (!link.sourceMsgTs) return null;
  const btn = document.createElement('button');
  btn.className = 'se-link-goto-btn';
  btn.type = 'button';
  btn.title = 'Scroll to message';
  btn.innerHTML = SCROLL_TO_SVG;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDropdownIfOpen();
    const parts = threadId.split(':');
    const channelId = parts[0];
    const threadTs = parts.length >= 2 ? parts[1] : undefined;
    if (channelId && threadTs) {
      requestSpaNav({
        action: 'openThread',
        channelId,
        threadTs,
        replyTs: link.sourceMsgTs!,
      }).then((result) => {
        if (!result.success) {
          if (isFlexpane) {
            scrollToMessageInFlexpane(link.sourceMsgTs!);
          } else {
            openThreadAndScrollTo(threadId, link.sourceMsgTs!);
          }
        }
      }).catch(() => {
        if (isFlexpane) {
          scrollToMessageInFlexpane(link.sourceMsgTs!);
        } else {
          openThreadAndScrollTo(threadId, link.sourceMsgTs!);
        }
      });
    } else if (isFlexpane) {
      scrollToMessageInFlexpane(link.sourceMsgTs!);
    } else {
      openThreadAndScrollTo(threadId, link.sourceMsgTs!);
    }
  });
  return btn;
}

function showExternalLinksDropdown(
  threadId: string,
  links: CachedLink[],
  headerEl: Element
) {
  const isFlexpane = !!headerEl.closest('[data-qa="threads_flexpane"]') || !!headerEl.closest('.p-flexpane_header__primary');
  const dropdown = document.createElement('div');
  dropdown.className = DROPDOWN_CLASS;

  const grouped = new Map<string, CachedLink[]>();
  for (const link of links) {
    const group = grouped.get(link.domain) ?? [];
    group.push(link);
    grouped.set(link.domain, group);
  }

  const sortedDomains = Array.from(grouped.keys()).sort(domainSortCompare);

  const isDark = document.body.classList.contains('sk-client-theme--dark');

  for (const domain of sortedDomains) {
    const groupEl = document.createElement('div');
    groupEl.className = 'se-link-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'se-link-group-header';

    const favicon = document.createElement('img');
    favicon.className = 'se-link-favicon';
    if (domain === 'github.com' && isDark) {
      favicon.src = 'https://github.githubassets.com/favicons/favicon-dark.svg';
    } else {
      favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    }
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
      const gotoBtn = createGoToMessageButton(link, threadId, isFlexpane);
      if (gotoBtn) itemEl.appendChild(gotoBtn);
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
  threadId: string,
  links: CachedLink[],
  headerEl: Element
) {
  const isFlexpane = !!headerEl.closest('[data-qa="threads_flexpane"]') || !!headerEl.closest('.p-flexpane_header__primary');
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
    linkEl.addEventListener('click', (e) => {
      e.preventDefault();
      closeDropdownIfOpen();
      const parsed = parseSlackThreadUrl(link.url);
      if (parsed?.channelId && parsed.threadTs) {
        requestSpaNav({
          action: 'openThread',
          channelId: parsed.channelId,
          threadTs: parsed.threadTs,
          replyTs: parsed.replyTs,
        }).then((result) => {
          if (!result.success) window.location.href = link.url;
        }).catch(() => {
          window.location.href = link.url;
        });
      } else {
        window.location.href = link.url;
      }
    });

    if (link.authorName) {
      const authorEl = document.createElement('div');
      authorEl.className = 'se-linked-thread-author';
      authorEl.textContent = link.authorName;
      linkEl.appendChild(authorEl);
    }

    const previewEl = document.createElement('div');
    previewEl.className = 'se-linked-thread-preview';
    previewEl.textContent = link.messagePreview ?? link.title ?? link.url;
    linkEl.appendChild(previewEl);

    const footerParts: string[] = [];
    if (link.channelName) footerParts.push(`Thread in #${link.channelName}`);
    const linkedThreadTs = link.threadId?.split(':')[1];
    if (linkedThreadTs) {
      const date = new Date(parseFloat(linkedThreadTs) * 1000);
      footerParts.push(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    }
    if (footerParts.length > 0) {
      const footerEl = document.createElement('div');
      footerEl.className = 'se-linked-thread-footer';
      footerEl.textContent = footerParts.join(' · ');
      linkEl.appendChild(footerEl);
    }

    itemEl.appendChild(linkEl);
    const gotoBtn = createGoToMessageButton(link, threadId, isFlexpane);
    if (gotoBtn) itemEl.appendChild(gotoBtn);
    itemEl.appendChild(createOpenInNewTabButton(link.url));
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
