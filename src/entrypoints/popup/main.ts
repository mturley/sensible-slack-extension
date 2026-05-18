import { readSettings, updateSetting, onSettingsChange } from '../../shared/settings';
import { getCacheStats, purgeCache, onCacheIndexChange } from '../../shared/link-cache';
import type { ExtensionSettings } from '../../types';

const TOGGLE_KEYS: (keyof ExtensionSettings)[] = [
  'quickMessageActions',
  'quickActionEditMessage',
  'quickActionCopyLink',
  'quickActionOpenThread',
  'quickActionSplitView',
  'quickActionMarkUnread',
  'manualThreadReadControl',
  'autoFormatLinks',
  'autoFormatGithubLinks',
  'autoFormatJiraLinks',
  'threadExternalLinks',
  'threadLinkedThreads',
  'threadTopButton',
];

const SUB_TOGGLE_PARENTS: Partial<Record<keyof ExtensionSettings, keyof ExtensionSettings>> = {
  quickActionEditMessage: 'quickMessageActions',
  quickActionCopyLink: 'quickMessageActions',
  quickActionOpenThread: 'quickMessageActions',
  quickActionSplitView: 'quickMessageActions',
  quickActionMarkUnread: 'quickMessageActions',
  autoFormatGithubLinks: 'autoFormatLinks',
  autoFormatJiraLinks: 'autoFormatLinks',
};

function updateSubToggleState(settings: ExtensionSettings) {
  for (const [child, parent] of Object.entries(SUB_TOGGLE_PARENTS)) {
    const container = document.getElementById(`sub-toggles-${parent}`);
    if (container) {
      container.classList.toggle('disabled', !settings[parent as keyof ExtensionSettings]);
    }
  }
}

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

  updateSubToggleState(settings);

  // Listen for external settings changes
  onSettingsChange((newSettings) => {
    for (const key of TOGGLE_KEYS) {
      const checkbox = document.getElementById(`toggle-${key}`) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = newSettings[key];
    }
    updateSubToggleState(newSettings);
  });
}

async function updateCacheStats() {
  const statsEl = document.getElementById('cache-stats');
  if (!statsEl) return;
  try {
    const stats = await getCacheStats();
    if (stats.linkCount === 0) {
      statsEl.textContent = '0 links cached';
    } else {
      statsEl.textContent = `${stats.linkCount} link${stats.linkCount === 1 ? '' : 's'} cached across ${stats.threadCount} thread${stats.threadCount === 1 ? '' : 's'}`;
    }
  } catch {
    statsEl.textContent = '0 links cached';
  }
}

function initPurgeButton() {
  const purgeBtn = document.getElementById('purge-btn');
  if (!purgeBtn) return;

  purgeBtn.addEventListener('click', async () => {
    purgeBtn.textContent = 'Purging…';
    purgeBtn.setAttribute('disabled', '');
    try {
      await purgeCache('all');
      await updateCacheStats();
    } finally {
      purgeBtn.textContent = 'Purge all';
      purgeBtn.removeAttribute('disabled');
    }
  });

  onCacheIndexChange(() => {
    updateCacheStats();
  });
}

initPopup();
updateCacheStats();
initPurgeButton();
