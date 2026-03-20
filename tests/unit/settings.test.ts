import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readSettings, writeSettings, updateSetting } from '../../src/shared/settings';

const store: Record<string, unknown> = {};

vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn(async (key: string) => store[key] ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    watch: vi.fn(() => () => {}),
  },
}));

describe('readSettings', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('returns defaults when storage is empty', async () => {
    const settings = await readSettings();
    expect(settings.quickMessageActions).toBe(true);
    expect(settings.manualThreadReadControl).toBe(true);
  });
});

describe('writeSettings', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('merges partial settings with current values', async () => {
    const result = await writeSettings({ quickMessageActions: false });

    expect(result.quickMessageActions).toBe(false);
    expect(result.manualThreadReadControl).toBe(true);
  });
});

describe('updateSetting', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('updates a single setting', async () => {
    const result = await updateSetting('manualThreadReadControl', false);
    expect(result.manualThreadReadControl).toBe(false);
    expect(result.quickMessageActions).toBe(true);
  });
});
