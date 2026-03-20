export interface ExtensionSettings {
  quickMessageActions: boolean;
  manualThreadReadControl: boolean;
}

export interface StorageSchema {
  settings: ExtensionSettings;
}

export type MessageActionType = 'copy-link' | 'open-thread';

export interface MessageAction {
  actionType: MessageActionType;
  messageTimestamp: string;
  channelId: string;
  workspaceId: string;
}
