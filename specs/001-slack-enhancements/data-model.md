# Data Model: Slack Web Interface Enhancements

**Date**: 2026-03-19 | **Branch**: `001-slack-enhancements`

## Entities

### ExtensionSettings

Persisted in `browser.storage.local` under key `settings`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| redirectPrevention | boolean | true | Enable/disable desktop app redirect blocking (US1) |
| quickMessageActions | boolean | true | Enable/disable copy-link and open-thread buttons (US2) |
| recentThreads | boolean | true | Enable/disable recent threads tracking (US3) |
| manualThreadReadControl | boolean | true | Enable/disable manual mark-as-read on Threads page (US4) |

**Validation rules**:
- All fields are optional; missing fields default to `true`.
- No cross-field dependencies.

### ThreadEntry

Persisted in `browser.storage.local` under key `threads_{workspaceId}`. Stored as an array, ordered by `lastViewedAt` descending.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| threadId | string | yes | Root message permalink or unique identifier (e.g., `p1234567890123456`) |
| workspaceId | string | yes | Slack workspace identifier (extracted from URL subdomain) |
| channelId | string | yes | Channel ID where the thread lives |
| channelName | string | yes | Human-readable channel name for display |
| author | string | yes | Display name of the thread's root message author |
| messagePreview | string | yes | Truncated text of the root message (max 100 chars) |
| lastViewedAt | number | yes | Unix timestamp (ms) of last view or reply |
| permalink | string | yes | Full URL to the thread root message |

**Validation rules**:
- `threadId` is the unique key within a workspace's thread list.
- Maximum 50 entries per workspace; oldest entries evicted when limit exceeded.
- `messagePreview` truncated to 100 characters with ellipsis if longer.

**State transitions**:
- **Created**: When user clicks to open a thread or replies to a thread.
- **Updated**: When user re-views or replies to an already-tracked thread (`lastViewedAt` updated, entry moved to top).
- **Evicted**: When array exceeds 50 entries, oldest by `lastViewedAt` is removed.
- **Removed**: When thread's root message is deleted or unavailable (detected on next access attempt).

### MessageAction (Runtime only, not persisted)

Represents an injected button in the Slack message hover action bar. Exists only in the DOM during the current page session.

| Field | Type | Description |
|-------|------|-------------|
| actionType | "copy-link" \| "open-thread" | Which action this button performs |
| messageTimestamp | string | Slack message `ts` value identifying the target message |
| channelId | string | Channel containing the message |
| workspaceId | string | Workspace context |

## Relationships

```text
ExtensionSettings (1) ──── controls ────> Feature modules (many)
                                           ├── RedirectPrevention
                                           ├── QuickMessageActions
                                           ├── RecentThreadsTracker
                                           └── ManualReadControl

ThreadEntry (many) ──── scoped to ────> Workspace (by workspaceId)

MessageAction (runtime) ──── references ────> ThreadEntry (on "open-thread" click, may create/update)
```

## Storage Schema

```typescript
// browser.storage.local structure
interface StorageSchema {
  settings: ExtensionSettings;
  [key: `threads_${string}`]: ThreadEntry[]; // e.g., threads_T0123456789
}
```

## Workspace Identity

The workspace ID is extracted from the Slack URL pattern: `https://app.slack.com/client/{workspaceId}/...` or from the subdomain `{workspace}.slack.com`. The content script determines the active workspace on initialization and route changes.
