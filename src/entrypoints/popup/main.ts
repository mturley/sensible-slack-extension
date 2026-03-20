import { readSettings, updateSetting, onSettingsChange } from '../../shared/settings';
import type { ExtensionSettings } from '../../types';

const TOGGLE_KEYS: (keyof ExtensionSettings)[] = [
  'quickMessageActions',
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
  });
}

initPopup();
