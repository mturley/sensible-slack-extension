import type { ExtensionSettings } from '../types';

// Storage keys
export const STORAGE_KEY_SETTINGS = 'settings';
export const STORAGE_KEY_THREADS_PREFIX = 'threads_';

// Limits
export const MAX_THREADS_PER_WORKSPACE = 50;
export const MESSAGE_PREVIEW_MAX_LENGTH = 100;

// Health check interval (ms)
export const SPA_HEALTH_CHECK_INTERVAL = 3000;

// Default settings (all features enabled)
export const DEFAULT_SETTINGS: ExtensionSettings = {
  redirectPrevention: true,
  quickMessageActions: true,
  recentThreads: true,
  manualThreadReadControl: true,
};

// Slack DOM selectors (priority: data-qa > aria > class)
export const SELECTORS = {
  messageActionBar: [
    '[data-qa="message_actions"]',
    '[role="toolbar"][class*="message_actions"]',
    '[class*="c-message_actions"]',
  ],
  messageContainer: [
    '[data-qa="message_container"]',
    '[role="article"]',
    '[class*="c-message_kit"]',
  ],
  messageTimestamp: [
    '[data-qa="message_timestamp"]',
    'a[class*="c-timestamp"]',
    '[class*="c-message__timestamp"]',
  ],
  channelHeader: [
    '[data-qa="channel_header_title"]',
    '[class*="p-channel_sidebar__channel--selected"]',
  ],
  threadsPanelContainer: [
    '[data-qa="threads_flexpane"]',
    '[class*="p-threads_flexpane"]',
  ],
  threadsPageContainer: [
    '[data-qa="threads_view"]',
    '[class*="p-threads_view"]',
  ],
  threadItem: [
    '[data-qa="thread_item"]',
    '[class*="p-thread_list_item"]',
  ],
  messageAuthor: [
    '[data-qa="message_sender_name"]',
    'button[class*="c-message__sender"]',
  ],
  messageText: [
    '[data-qa="message_text"]',
    '[class*="c-message__body"]',
  ],
} as const;

// URL patterns
export const SLACK_WORKSPACE_URL_PATTERN = /^https:\/\/app\.slack\.com\/client\/([A-Z0-9]+)\//;
export const SLACK_SUBDOMAIN_PATTERN = /^https:\/\/([^.]+)\.slack\.com/;
export const SLACK_THREAD_URL_PATTERN = /\/archives\/([A-Z0-9]+)\/p(\d+)/;

// Extension badge
export const BADGE_DEGRADED = '!';
export const BADGE_COLOR_DEGRADED = '#FF9800';
