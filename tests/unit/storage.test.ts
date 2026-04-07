import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSettings, setSettings } from '../../src/shared/storage';
import type { ExtensionSettings } from '../../src/types';

const store: Record<string, unknown> = {};

vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn(async (key: string) => store[key] ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete store[key];
    }),
  },
}));

describe('getSettings', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('returns defaults when storage is empty', async () => {
    const settings = await getSettings();
    expect(settings).toEqual({
      quickMessageActions: true,
      quickActionCopyLink: true,
      quickActionOpenThread: true,
      quickActionSplitView: true,
      quickActionMarkUnread: true,
      manualThreadReadControl: true,
    });
  });

  it('merges stored values with defaults', async () => {
    store['local:settings'] = { quickMessageActions: false };

    const settings = await getSettings();
    expect(settings.quickMessageActions).toBe(false);
  });
});

describe('setSettings', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('writes settings to storage', async () => {
    const settings: ExtensionSettings = {
      quickMessageActions: true,
      quickActionCopyLink: true,
      quickActionOpenThread: true,
      quickActionSplitView: true,
      quickActionMarkUnread: true,
      manualThreadReadControl: true,
      autoFormatLinks: true,
      autoFormatGithubLinks: true,
      autoFormatJiraLinks: true,
    };

    await setSettings(settings);
    expect(store['local:settings']).toEqual(settings);
  });
});
