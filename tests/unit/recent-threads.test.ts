import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addOrUpdateThread } from '../../src/modules/recent-threads';
import type { ThreadEntry } from '../../src/types';

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

function makeThread(overrides: Partial<ThreadEntry> = {}): ThreadEntry {
  return {
    threadId: 'p1234567890',
    workspaceId: 'T0123',
    channelId: 'C0123',
    channelName: 'general',
    author: 'Test User',
    messagePreview: 'Hello world',
    lastViewedAt: Date.now(),
    permalink: 'https://app.slack.com/archives/C0123/p1234567890',
    ...overrides,
  };
}

describe('addOrUpdateThread', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('adds a new thread entry', async () => {
    await addOrUpdateThread(makeThread());

    const saved = store['local:threads_T0123'] as ThreadEntry[];
    expect(saved).toHaveLength(1);
    expect(saved[0].threadId).toBe('p1234567890');
  });

  it('moves existing thread to top on update', async () => {
    const thread1 = makeThread({ threadId: 'p111', lastViewedAt: 1000 });
    const thread2 = makeThread({ threadId: 'p222', lastViewedAt: 2000 });
    store['local:threads_T0123'] = [thread2, thread1];

    const updatedThread1 = { ...thread1, lastViewedAt: 3000 };
    await addOrUpdateThread(updatedThread1);

    const saved = store['local:threads_T0123'] as ThreadEntry[];
    expect(saved[0].threadId).toBe('p111');
    expect(saved[0].lastViewedAt).toBe(3000);
    expect(saved[1].threadId).toBe('p222');
  });

  it('evicts last thread when exceeding limit', async () => {
    // Create 50 existing threads (newest first)
    const existingThreads = Array.from({ length: 50 }, (_, i) =>
      makeThread({ threadId: `p${49 - i}`, lastViewedAt: 49 - i })
    );
    store['local:threads_T0123'] = existingThreads;

    const newThread = makeThread({ threadId: 'pNew', lastViewedAt: 999 });
    await addOrUpdateThread(newThread);

    const saved = store['local:threads_T0123'] as ThreadEntry[];
    expect(saved).toHaveLength(50);
    expect(saved[0].threadId).toBe('pNew');
    // Last thread (p0, with lowest lastViewedAt) should have been evicted
    expect(saved.find((t) => t.threadId === 'p0')).toBeUndefined();
  });
});
