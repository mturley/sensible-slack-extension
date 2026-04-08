import type { ExtensionSettings } from '../types';

// Storage keys
export const STORAGE_KEY_SETTINGS = 'settings';

// Health check interval (ms)
export const SPA_HEALTH_CHECK_INTERVAL = 3000;

// Default settings (all features enabled)
export const DEFAULT_SETTINGS: ExtensionSettings = {
  quickMessageActions: true,
  quickActionEditMessage: true,
  quickActionCopyLink: true,
  quickActionOpenThread: true,
  quickActionSplitView: true,
  quickActionMarkUnread: true,
  manualThreadReadControl: true,
  autoFormatLinks: true,
  autoFormatGithubLinks: true,
  autoFormatJiraLinks: true,
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
} as const;

// URL patterns
export const SLACK_WORKSPACE_URL_PATTERN = /^https:\/\/app\.slack\.com\/client\/([A-Z0-9]+)/;
export const SLACK_SUBDOMAIN_PATTERN = /^https:\/\/([^.]+)\.slack\.com/;
// Link formatting patterns
export const GITHUB_PR_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/(?:pull|issues)\/(\d+)\/?$/;
export const JIRA_ISSUE_URL_PATTERN = /^https:\/\/[^/]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)\/?$/;

// Extension badge
export const BADGE_DEGRADED = '!';
export const BADGE_COLOR_DEGRADED = '#FF9800';
