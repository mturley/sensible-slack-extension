export interface ExtensionSettings {
  quickMessageActions: boolean;
  quickActionEditMessage: boolean;
  quickActionCopyLink: boolean;
  quickActionOpenThread: boolean;
  quickActionSplitView: boolean;
  quickActionMarkUnread: boolean;
  manualThreadReadControl: boolean;
  autoFormatLinks: boolean;
  autoFormatGithubLinks: boolean;
  autoFormatJiraLinks: boolean;
  threadExternalLinks: boolean;
  threadLinkedThreads: boolean;
  threadTopButton: boolean;
}

export interface StorageSchema {
  settings: ExtensionSettings;
}

export interface CachedLink {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  faviconUrl?: string;
  authorName?: string;
  channelName?: string;
  messagePreview?: string;
  threadId?: string;
  isReply?: boolean;
  sourceMsgTs?: string;
  sourceChannelId?: string;
  sourceMsgAuthor?: string;
  sourceMsgText?: string;
  firstSeenAt: number;
}

export interface ThreadRootInfo {
  author?: string;
  text?: string;
  channelName?: string;
  date?: string;
}

export interface Backlink {
  sourceThreadId: string;
  sourceUrl: string;
  rootInfo?: ThreadRootInfo;
  linkAuthorName?: string;
  linkPreview?: string;
  linkChannelName?: string;
  firstSeenAt: number;
}

export interface ThreadLinkCache {
  threadId: string;
  links: CachedLink[];
  backlinks?: Backlink[];
  processedMsgTimestamps: string[];
  rootInfo?: ThreadRootInfo;
  lastUpdated: number;
}

export interface ThreadLinksIndex {
  [threadId: string]: number;
}

export type MessageActionType = 'copy-link' | 'open-thread';

export interface MessageAction {
  actionType: MessageActionType;
  messageTimestamp: string;
  channelId: string;
  workspaceId: string;
}
