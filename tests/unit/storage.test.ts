import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSettings, setSettings, getThreads, setThreads } from '../../src/shared/storage';
import type { ExtensionSettings, ThreadEntry } from '../../src/types';

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
      redirectPrevention: true,
      quickMessageActions: true,
      recentThreads: true,
      manualThreadReadControl: true,
    });
  });

  it('merges stored values with defaults', async () => {
    store['local:settings'] = { redirectPrevention: false };

    const settings = await getSettings();
    expect(settings.redirectPrevention).toBe(false);
    expect(settings.quickMessageActions).toBe(true);
  });
});

describe('setSettings', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('writes settings to storage', async () => {
    const settings: ExtensionSettings = {
      redirectPrevention: false,
      quickMessageActions: true,
      recentThreads: false,
      manualThreadReadControl: true,
    };

    await setSettings(settings);
    expect(store['local:settings']).toEqual(settings);
  });
});

describe('getThreads / setThreads', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('returns empty array when no threads stored', async () => {
    const threads = await getThreads('T0123');
    expect(threads).toEqual([]);
  });

  it('stores and retrieves threads by workspace', async () => {
    const threads: ThreadEntry[] = [
      {
        threadId: 'p123',
        workspaceId: 'T0123',
        channelId: 'C0123',
        channelName: 'general',
        author: 'User',
        messagePreview: 'Hello',
        lastViewedAt: Date.now(),
        permalink: 'https://app.slack.com/archives/C0123/p123',
      },
    ];

    await setThreads('T0123', threads);
    expect(store['local:threads_T0123']).toEqual(threads);
  });
});
