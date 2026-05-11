import { storage } from 'wxt/utils/storage';
import type { CachedLink, ThreadLinkCache, ThreadLinksIndex } from '../types';
import {
  STORAGE_KEY_THREAD_LINKS_PREFIX,
  STORAGE_KEY_THREAD_LINKS_INDEX,
} from './constants';

function threadKey(threadId: string): `local:${string}` {
  return `local:${STORAGE_KEY_THREAD_LINKS_PREFIX}${threadId}`;
}

const indexKey: `local:${string}` = `local:${STORAGE_KEY_THREAD_LINKS_INDEX}`;

async function getIndex(): Promise<ThreadLinksIndex> {
  return (await storage.getItem<ThreadLinksIndex>(indexKey)) ?? {};
}

async function setIndex(index: ThreadLinksIndex): Promise<void> {
  await storage.setItem(indexKey, index);
}

export async function getThreadLinks(
  threadId: string
): Promise<ThreadLinkCache | null> {
  return storage.getItem<ThreadLinkCache>(threadKey(threadId));
}

export async function saveThreadLinks(
  cache: ThreadLinkCache
): Promise<void> {
  cache.lastUpdated = Date.now();
  await storage.setItem(threadKey(cache.threadId), cache);

  const index = await getIndex();
  index[cache.threadId] = cache.lastUpdated;
  await setIndex(index);
}

export function mergeLinks(
  existing: CachedLink[],
  incoming: CachedLink[]
): CachedLink[] {
  const byUrl = new Map<string, CachedLink>();
  for (const link of existing) {
    byUrl.set(link.url, link);
  }
  for (const link of incoming) {
    const prev = byUrl.get(link.url);
    if (prev) {
      if (link.title && !prev.title) prev.title = link.title;
      if (link.description && !prev.description) prev.description = link.description;
      if (link.authorName && !prev.authorName) prev.authorName = link.authorName;
      if (link.channelName && !prev.channelName) prev.channelName = link.channelName;
      if (link.messagePreview && !prev.messagePreview) prev.messagePreview = link.messagePreview;
      if (link.sourceMsgTs && (!prev.sourceMsgTs || link.sourceMsgTs > prev.sourceMsgTs)) {
        prev.sourceMsgTs = link.sourceMsgTs;
        if (link.sourceChannelId) prev.sourceChannelId = link.sourceChannelId;
      }
    } else {
      byUrl.set(link.url, link);
    }
  }
  return Array.from(byUrl.values());
}

export async function getCacheStats(): Promise<{
  linkCount: number;
  threadCount: number;
}> {
  const index = await getIndex();
  const threadIds = Object.keys(index);
  let linkCount = 0;
  for (const id of threadIds) {
    const cache = await storage.getItem<ThreadLinkCache>(threadKey(id));
    if (cache) linkCount += cache.links.length;
  }
  return { linkCount, threadCount: threadIds.length };
}

export async function purgeCache(
  olderThanDays: number | 'all'
): Promise<void> {
  const index = await getIndex();
  const cutoff =
    olderThanDays === 'all'
      ? Infinity
      : Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const threadIds = Object.keys(index);
  for (const id of threadIds) {
    if (olderThanDays === 'all' || index[id] < cutoff) {
      await storage.removeItem(threadKey(id));
      delete index[id];
    } else {
      const cache = await storage.getItem<ThreadLinkCache>(threadKey(id));
      if (cache) {
        cache.links = cache.links.filter((l) => l.firstSeenAt >= cutoff);
        cache.processedMsgTimestamps = [];
        if (cache.links.length === 0) {
          await storage.removeItem(threadKey(id));
          delete index[id];
        } else {
          await storage.setItem(threadKey(id), cache);
        }
      }
    }
  }
  await setIndex(index);
}

export function onCacheIndexChange(
  callback: (index: ThreadLinksIndex) => void
): () => void {
  return storage.watch<ThreadLinksIndex>(indexKey, (newValue) => {
    callback(newValue ?? {});
  });
}
