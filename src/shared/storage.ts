import { storage } from 'wxt/utils/storage';
import type { ExtensionSettings } from '../types';
import {
  STORAGE_KEY_SETTINGS,
  DEFAULT_SETTINGS,
} from './constants';

export async function getSettings(): Promise<ExtensionSettings> {
  const raw = await storage.getItem<ExtensionSettings>(
    `local:${STORAGE_KEY_SETTINGS}`
  );
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function setSettings(
  settings: ExtensionSettings
): Promise<void> {
  await storage.setItem(`local:${STORAGE_KEY_SETTINGS}`, settings);
}
