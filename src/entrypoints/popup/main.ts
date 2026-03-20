import { readSettings, updateSetting, onSettingsChange } from '../../shared/settings';
import { getThreads } from '../../shared/storage';
import type { ExtensionSettings, ThreadEntry } from '../../types';

const TOGGLE_KEYS: (keyof ExtensionSettings)[] = [
  'quickMessageActions',
  'recentThreads',
  'manualThreadReadControl',
];

async function initPopup() {
  const settings = await readSettings();

  // Initialize toggles
  for (const key of TOGGLE_KEYS) {
    const checkbox = document.getElementById(`toggle-${key}`) as HTMLInputElement | null;
    if (!checkbox) continue;

    checkbox.checked = settings[key];
    checkbox.addEventListener('change', () => {
      updateSetting(key, checkbox.checked);
    });
  }

  // Listen for external settings changes
  onSettingsChange((newSettings) => {
    for (const key of TOGGLE_KEYS) {
      const checkbox = document.getElementById(`toggle-${key}`) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = newSettings[key];
    }
    updateRecentThreadsVisibility(newSettings.recentThreads);
  });

  updateRecentThreadsVisibility(settings.recentThreads);
  await loadRecentThreads();
}

function updateRecentThreadsVisibility(enabled: boolean) {
  const section = document.getElementById('recent-threads-section');
  if (section) section.style.display = enabled ? 'block' : 'none';
}

async function loadRecentThreads() {
  const listEl = document.getElementById('recent-threads-list');
  if (!listEl) return;

  // Get the active tab's workspace
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.url) return;

  const workspaceMatch = activeTab.url.match(
    /^https:\/\/app\.slack\.com\/client\/([A-Z0-9]+)\//
  );
  if (!workspaceMatch) return;

  const workspaceId = workspaceMatch[1];
  const threads = await getThreads(workspaceId);

  if (threads.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No recent threads tracked yet.</p>';
    return;
  }

  listEl.innerHTML = '';
  const activeTabId = activeTab.id;
  for (const thread of threads) {
    listEl.appendChild(createThreadItem(thread, activeTabId));
  }
}

function createThreadItem(thread: ThreadEntry, activeTabId?: number): HTMLElement {
  const item = document.createElement('a');
  item.className = 'thread-item';
  item.href = thread.permalink;
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const url = `${thread.permalink}#se-open-thread`;
    if (activeTabId != null) {
      // Navigate the current Slack tab instead of opening a new one
      browser.tabs.update(activeTabId, { url });
      window.close();
    } else {
      browser.runtime.sendMessage({
        type: 'NAVIGATE_TO_THREAD',
        url,
      });
    }
  });

  const channel = document.createElement('div');
  channel.className = 'thread-channel';
  channel.textContent = `#${thread.channelName}`;

  const author = document.createElement('div');
  author.className = 'thread-author';
  author.textContent = thread.author;

  const preview = document.createElement('div');
  preview.className = 'thread-preview';
  preview.textContent = thread.messagePreview;

  // Show last reply if available
  if (thread.lastReplyAuthor || thread.lastReplyPreview) {
    const lastReply = document.createElement('div');
    lastReply.className = 'thread-last-reply';
    const replyAuthor = thread.lastReplyAuthor ?? 'Someone';
    const replyText = thread.lastReplyPreview ?? '';
    lastReply.textContent = `${replyAuthor}: ${replyText}`;
    item.appendChild(channel);
    item.appendChild(author);
    item.appendChild(preview);
    item.appendChild(lastReply);
  } else {
    item.appendChild(channel);
    item.appendChild(author);
    item.appendChild(preview);
  }

  const time = document.createElement('div');
  time.className = 'thread-time';
  time.textContent = formatRelativeTime(thread.lastViewedAt);
  item.appendChild(time);

  return item;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

initPopup();
