export interface ExtensionSettings {
  quickMessageActions: boolean;
  recentThreads: boolean;
  manualThreadReadControl: boolean;
}

export interface ThreadEntry {
  threadId: string;
  workspaceId: string;
  channelId: string;
  channelName: string;
  author: string;
  messagePreview: string;
  lastViewedAt: number;
  permalink: string;
}

export interface StorageSchema {
  settings: ExtensionSettings;
  [key: `threads_${string}`]: ThreadEntry[];
}

export type MessageActionType = 'copy-link' | 'open-thread';

export interface MessageAction {
  actionType: MessageActionType;
  messageTimestamp: string;
  channelId: string;
  workspaceId: string;
}
