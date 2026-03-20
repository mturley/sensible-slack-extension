import { storage } from 'wxt/utils/storage';
import type { ExtensionSettings, ThreadEntry } from '../types';
import {
  STORAGE_KEY_SETTINGS,
  STORAGE_KEY_THREADS_PREFIX,
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

export async function getThreads(
  workspaceId: string
): Promise<ThreadEntry[]> {
  const key = `${STORAGE_KEY_THREADS_PREFIX}${workspaceId}`;
  return (await storage.getItem<ThreadEntry[]>(`local:${key}`)) ?? [];
}

export async function setThreads(
  workspaceId: string,
  threads: ThreadEntry[]
): Promise<void> {
  const key = `${STORAGE_KEY_THREADS_PREFIX}${workspaceId}`;
  await storage.setItem(`local:${key}`, threads);
}

export async function removeThreads(workspaceId: string): Promise<void> {
  const key = `${STORAGE_KEY_THREADS_PREFIX}${workspaceId}`;
  await storage.removeItem(`local:${key}`);
}
