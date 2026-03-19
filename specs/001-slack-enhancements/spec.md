# Feature Specification: Slack Web Interface Enhancements

**Feature Branch**: `001-slack-enhancements`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: Multi-phase browser extension adding UX enhancements to the Slack web interface

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prevent Desktop App Redirect (Priority: P1)

When a user clicks a Slack link (e.g. from email, Jira, or another app), the browser often redirects to the Slack desktop app instead of opening in the web interface. This extension should intercept that redirect and keep the user in the Slack web interface instead. The behavior is controlled by a toggle in the extension's popup menu, enabled by default.

**Why this priority**: This is the simplest feature with the broadest impact. Every Slack web user encounters the desktop redirect friction daily, and it requires no DOM manipulation of the Slack interface itself.

**Independent Test**: Click a Slack link from an external source (e.g. a bookmark or another website) and verify it opens in the Slack web interface instead of redirecting to the desktop app.

**Acceptance Scenarios**:

1. **Given** the extension is installed and the redirect-prevention toggle is enabled (default), **When** the user clicks a Slack link from an external source, **Then** the page loads the Slack web interface for that channel/message instead of redirecting to the desktop app.
2. **Given** the redirect-prevention toggle is enabled, **When** the user opens a Slack link in a new tab, **Then** the Slack web interface loads directly without showing a "Open in desktop app?" interstitial.
3. **Given** the user disables the redirect-prevention toggle in the extension menu, **When** the user clicks a Slack link, **Then** Slack's default redirect behavior occurs (may redirect to desktop app).
4. **Given** the user re-enables the toggle, **When** the user clicks another Slack link, **Then** redirect prevention resumes immediately without needing to reload.

---

### User Story 2 - Quick Message Actions (Priority: P2)

When hovering over a Slack message, an icon bar appears with actions like emoji react, reply, etc. The user wants two new buttons added to this bar: one to copy a link to that message to the clipboard (currently buried behind a "More actions" menu), and one to open the message's thread in a new browser tab.

**Why this priority**: These are high-frequency actions that save multiple clicks per interaction. They build on Phase 1 by manipulating the Slack DOM, which establishes patterns for later phases.

**Independent Test**: Hover over any message in a Slack channel, verify the two new buttons appear, click each one, and confirm the expected behavior (clipboard copy / new tab with thread).

**Acceptance Scenarios**:

1. **Given** the user hovers over a message in any Slack channel or DM, **When** the message action bar appears, **Then** two new buttons are visible: "Copy link" and "Open thread in new tab".
2. **Given** the action bar is showing with the new buttons, **When** the user clicks "Copy link", **Then** a permalink to that message is copied to the clipboard, and a brief visual confirmation appears (e.g. tooltip changes to "Copied!").
3. **Given** the action bar is showing, **When** the user clicks "Open thread in new tab", **Then** a new browser tab opens navigated to that message, and the thread panel for that message expands automatically in the new tab.
4. **Given** a message has no replies (no thread), **When** the user clicks "Open thread in new tab", **Then** a new tab still opens focused on that message (the thread panel shows the message with an empty reply area).
5. **Given** the Slack interface updates its DOM structure (e.g. a Slack version update), **When** the extension cannot find the expected action bar elements, **Then** the extension degrades gracefully and does not inject broken UI or cause errors.

---

### User Story 3 - Recent Threads Tracking (Priority: P3)

Slack's "Recent" dropdown at the top of the sidebar lists recently visited channels and views, but does not include recently viewed threads. The user wants the extension to track which threads they have opened (either via the sidebar thread panel or via the Threads page) and inject those threads into the Recent dropdown. If injecting into the Recent dropdown is not feasible, the extension should instead display the recent threads list in the extension's popup menu.

**Why this priority**: This adds new functionality that requires persistent local state (thread history) and either DOM injection into a Slack dropdown or a fallback UI in the extension popup.

**Independent Test**: Open several threads in Slack, then open the Recent dropdown (or extension popup) and verify recently viewed threads appear in the list. Click one to navigate to it.

**Acceptance Scenarios**:

1. **Given** the user opens a thread (via sidebar panel or Threads page), **When** the user later opens the Recent dropdown, **Then** that thread appears in the list with identifying context (channel name, message preview or author).
2. **Given** multiple threads have been viewed, **When** the user opens the Recent dropdown, **Then** threads appear in reverse chronological order (most recently viewed first).
3. **Given** the user clicks a thread entry in the Recent list, **Then** Slack navigates to the channel containing that thread and opens the thread in the sidebar panel.
4. **Given** the extension cannot inject items into Slack's Recent dropdown, **Then** the extension displays the recent threads list in the extension's popup menu as a fallback, with the same navigation behavior.
5. **Given** thread history has accumulated, **When** the history exceeds a reasonable limit, **Then** the oldest entries are removed automatically to prevent unbounded storage growth.

**Assumptions**:
- A reasonable limit for thread history is approximately 50 entries.
- Thread identity is based on the thread's root message permalink.

---

### User Story 4 - Manual Thread Read Control (Priority: P4)

On Slack's Threads page, threads are automatically marked as read as the user scrolls past them. The user wants to disable this automatic mark-as-read behavior specifically on the Threads page (without affecting mark-as-read triggered by opening individual threads in other views). Instead, a "Mark as read" button should appear after the last message in each thread on the Threads page, allowing the user to explicitly choose which threads to dismiss.

**Why this priority**: This is the most complex feature, requiring interception of Slack's mark-as-read signals and careful scoping to only the Threads page. It fundamentally changes the Threads page workflow.

**Independent Test**: Navigate to the Threads page with several unread threads, scroll through them, and verify they remain marked as unread. Click "Mark as read" on one thread and verify only that thread's unread indicator disappears.

**Acceptance Scenarios**:

1. **Given** the user is on the Threads page with unread threads, **When** the user scrolls past a thread, **Then** the thread remains marked as unread (the "new" indicator line stays visible).
2. **Given** the user reads a thread by opening it from a channel (not the Threads page), **When** the user returns to the Threads page, **Then** that thread reflects its read status normally (mark-as-read blocking only applies to the Threads page scroll behavior).
3. **Given** a thread on the Threads page has unread messages, **When** the user views the thread, **Then** a "Mark as read" button is visible after the last message in that thread.
4. **Given** the user clicks "Mark as read" on a thread, **Then** the "new" indicator line disappears for that thread, and the button becomes disabled/dimmed.
5. **Given** the user has marked a thread as read, **When** new messages arrive in that thread while the user is still on the Threads page, **Then** the "new" indicator reappears and the "Mark as read" button re-enables.
6. **Given** the user leaves the Threads page and returns, **Then** threads that were not explicitly marked as read still show as unread.
7. **Given** this feature is not technically feasible (e.g. cannot reliably intercept mark-as-read signals), **Then** the extension falls back to User Story 5 (Recent Threads View).

---

### User Story 5 - Recent Threads View Fallback (Priority: P5)

If modifying the Threads page behavior (User Story 4) is not feasible, the extension should create an alternative "Recent Threads" view. This view shows a simple list of threads with unread message counts. Clicking a thread opens it in the sidebar panel as if the user had clicked on it from a channel.

**Why this priority**: This is a fallback for User Story 4 and only implemented if US4 proves infeasible. It provides similar value with a simpler approach.

**Independent Test**: Navigate to the "Recent Threads" view, verify threads with unread counts are listed, click one, and verify it opens in the sidebar thread panel.

**Acceptance Scenarios**:

1. **Given** the extension provides a "Recent Threads" view (because US4 was not feasible), **When** the user navigates to this view, **Then** they see a list of threads they participate in, each showing the number of unread messages.
2. **Given** the Recent Threads list is displayed, **When** the user clicks a thread entry, **Then** Slack navigates to the channel containing that message and opens the thread in the sidebar panel.
3. **Given** a thread has no unread messages, **Then** it still appears in the list but with a zero or no unread count indicator.
4. **Given** the user reads a thread (via any method), **When** they return to Recent Threads, **Then** the unread count for that thread is updated.

---

### Edge Cases

- What happens when the user is logged into multiple Slack workspaces? Each workspace's thread history and settings MUST be tracked independently.
- What happens when a thread's root message is deleted? The extension MUST handle missing threads gracefully (remove from history, show a "thread unavailable" indicator, or skip).
- What happens when the extension is installed mid-session? Features that require page load (redirect prevention) MUST work on the next navigation; features that inject into the DOM (action buttons) MUST inject on the current page without requiring a full reload.
- What happens when Slack's DOM structure changes in an update? The extension MUST degrade gracefully: hide injected elements rather than show broken UI, and log the issue for debugging.
- What happens if the user clicks "Copy link" when offline? The extension should still copy the constructed permalink from the available page context.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST provide a toggle in the extension popup menu to enable/disable desktop app redirect prevention, defaulting to enabled.
- **FR-002**: When redirect prevention is enabled, the extension MUST ensure Slack links open in the web interface instead of redirecting to the desktop app.
- **FR-003**: The extension MUST inject a "Copy link" button into the message hover action bar that copies the message permalink to the clipboard.
- **FR-004**: The extension MUST inject an "Open thread in new tab" button into the message hover action bar that opens a new tab navigated to the message with its thread expanded.
- **FR-005**: The extension MUST track threads the user has viewed and present them in a recent threads list, either injected into Slack's Recent dropdown or displayed in the extension popup menu.
- **FR-006**: Thread history MUST be stored locally in the browser and MUST NOT be transmitted externally.
- **FR-007**: Thread history MUST be scoped per workspace for users with multiple workspaces.
- **FR-008**: The extension MUST prevent automatic mark-as-read behavior on the Threads page while preserving mark-as-read behavior triggered from other views.
- **FR-009**: The extension MUST inject a "Mark as read" button after the last message of each thread on the Threads page.
- **FR-010**: The "Mark as read" button MUST dismiss the unread indicator for that thread, become disabled, and re-enable if new messages arrive.
- **FR-011**: If US4 features (FR-008 through FR-010) are not feasible, the extension MUST provide a "Recent Threads" alternate view showing threads with unread counts.
- **FR-012**: All extension settings MUST persist across browser sessions.
- **FR-013**: The extension MUST degrade gracefully when Slack's DOM structure changes, avoiding broken UI or errors.

### Key Entities

- **Thread Entry**: Represents a tracked thread in the recent threads history. Attributes: thread root message identifier, workspace, channel name, message author, message preview, timestamp of last view, unread message count.
- **Extension Settings**: User preferences for the extension. Attributes: redirect prevention toggle state, any per-feature enable/disable toggles.
- **Message Action**: An injected button in the Slack message hover action bar. Attributes: action type (copy link or open thread), target message identifier.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can open a Slack link and arrive at the web interface within 2 seconds, without encountering a desktop app redirect prompt.
- **SC-002**: Users can copy a message link in 1 click (down from 3+ clicks through the current More Actions menu).
- **SC-003**: Users can open a thread in a new tab in 1 click.
- **SC-004**: Users can find and navigate to a recently viewed thread within 3 clicks (open Recent or extension menu, find thread, click).
- **SC-005**: On the Threads page, zero threads are automatically marked as read by scrolling alone; users must explicitly mark each thread as read.
- **SC-006**: All extension data remains local to the browser with no external network requests made by the extension.
- **SC-007**: When Slack updates its interface, the extension's injected elements either continue to work correctly or disappear cleanly without causing errors or broken UI.

## Assumptions

- Slack's message hover action bar DOM is consistent enough to reliably detect and inject buttons into.
- Slack message permalinks can be constructed or extracted from the page context without additional network requests.
- Slack's mark-as-read behavior on the Threads page is triggered by observable signals (e.g. network requests or DOM events) that can be intercepted.
- The user will provide DOM markup samples when implementation requires inspecting the current Slack interface structure.
- Thread history of approximately 50 entries per workspace is a reasonable default limit.
