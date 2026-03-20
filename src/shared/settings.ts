import { storage } from 'wxt/utils/storage';
import type { ExtensionSettings } from '../types';
import { STORAGE_KEY_SETTINGS, DEFAULT_SETTINGS } from './constants';

export async function readSettings(): Promise<ExtensionSettings> {
  const raw = await storage.getItem<ExtensionSettings>(
    `local:${STORAGE_KEY_SETTINGS}`
  );
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function writeSettings(
  settings: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await readSettings();
  const updated = { ...current, ...settings };
  await storage.setItem(`local:${STORAGE_KEY_SETTINGS}`, updated);
  return updated;
}

export async function updateSetting<K extends keyof ExtensionSettings>(
  key: K,
  value: ExtensionSettings[K]
): Promise<ExtensionSettings> {
  return writeSettings({ [key]: value });
}

export type SettingsChangeCallback = (
  newSettings: ExtensionSettings,
  oldSettings: ExtensionSettings
) => void;

export function onSettingsChange(
  callback: SettingsChangeCallback
): () => void {
  const unwatch = storage.watch<ExtensionSettings>(
    `local:${STORAGE_KEY_SETTINGS}`,
    (newValue, oldValue) => {
      const newSettings = { ...DEFAULT_SETTINGS, ...newValue };
      const oldSettings = { ...DEFAULT_SETTINGS, ...oldValue };
      callback(newSettings, oldSettings);
    }
  );
  return unwatch;
}
