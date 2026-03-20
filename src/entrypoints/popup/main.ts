import { readSettings, updateSetting, onSettingsChange } from '../../shared/settings';
import type { ExtensionSettings } from '../../types';

const TOGGLE_KEYS: (keyof ExtensionSettings)[] = [
  'quickMessageActions',
  'quickActionCopyLink',
  'quickActionOpenThread',
  'quickActionSplitView',
  'quickActionMarkUnread',
  'manualThreadReadControl',
];

const SUB_TOGGLE_PARENTS: Partial<Record<keyof ExtensionSettings, keyof ExtensionSettings>> = {
  quickActionCopyLink: 'quickMessageActions',
  quickActionOpenThread: 'quickMessageActions',
  quickActionSplitView: 'quickMessageActions',
  quickActionMarkUnread: 'quickMessageActions',
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

initPopup();
