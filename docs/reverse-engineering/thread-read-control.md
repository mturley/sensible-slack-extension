# Slack Thread Read State Control — Reverse Engineering Notes

Slack's web client automatically marks threads as read when the user views them on the Threads page. There is no built-in way to prevent this. This document covers how Slack manages thread read state at the API level, and how the extension intercepts and controls it.

Tested: May 2026 on app.slack.com (Red Hat Enterprise workspace).

## How Slack Marks Threads as Read

### The API Endpoint

When Slack marks a thread as read, it sends:

```
POST /api/subscriptions.thread.mark
Content-Type: application/x-www-form-urlencoded

token={api_token}&channel={channel_id}&thread_ts={thread_timestamp}&ts={latest_message_ts}&read=1
```

Expected response:

```json
{"ok": true}
```

### Parameters

| Parameter   | Description |
|-------------|-------------|
| `token`     | The user's session API token (starts with `xoxc-`) |
| `channel`   | Channel ID where the thread lives (e.g. `C05SMJ09DD2`) |
| `thread_ts` | Timestamp of the thread root message (e.g. `1746622698.699349`) |
| `ts`        | Timestamp of the latest message being marked as read |
| `read`      | Always `1` for mark-as-read operations |

### When Slack Fires This

Slack sends `subscriptions.thread.mark` automatically when:

- The user scrolls through threads on the Threads page (`/threads` view)
- A thread with unread replies comes into the viewport
- The user opens a specific thread from the Threads page

These are **XMLHttpRequests** fired by Slack's JavaScript, not user-initiated actions. The user has no control over when they happen — simply viewing the Threads page triggers them.

### Thread Identity

A thread is uniquely identified by `(channel, thread_ts)`. The `ts` parameter tells Slack "mark everything up to this timestamp as read." Multiple mark requests for the same thread may fire as the user scrolls, each with an increasing `ts` value as more messages come into view.

---

## Interception Architecture

The extension uses a two-world content script architecture to intercept and control these requests:

```
┌─────────────────────────────────────────────────────────┐
│  MAIN world (thread-mark-guard.content.ts)              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  XHR monkey-patch                                 │  │
│  │  • Intercepts XMLHttpRequest.open/send            │  │
│  │  • Returns fake {"ok":true} via blob URL          │  │
│  │  • Dispatches se-thread-mark-intercepted event    │  │
│  │  • Replays real requests via se-mark-thread-read  │  │
│  └───────────────────────────────────────────────────┘  │
│                          ▲ CustomEvents ▼               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  CONTENT world (manual-read-control.ts)           │  │
│  │  • Stores blocked request params                  │  │
│  │  • Injects "Mark as read" buttons                 │  │
│  │  • Manages toast notifications                    │  │
│  │  • Triggers replay on user click                  │  │
│  └───────────────────────────────────────────────────┘  │
│                          ▲ runtime.sendMessage ▼        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Background script (background.ts)                │  │
│  │  • Captures API tokens via webRequest             │  │
│  │  • Provides fallback token to content script      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Why two worlds?** The MAIN world script runs in Slack's JavaScript context and can monkey-patch `XMLHttpRequest`. The CONTENT world script has access to the extension APIs (`browser.runtime`, `browser.storage`). They communicate via DOM `CustomEvent`s, which cross the world boundary.

---

## The XHR Monkey-Patch

The MAIN world script (`thread-mark-guard.content.ts`) patches `XMLHttpRequest.prototype.open` and `.send` at `document_start`, before Slack's scripts load.

### Capturing the URL

`XMLHttpRequest.prototype.open` is patched to stash the request URL on the XHR instance:

```typescript
XMLHttpRequest.prototype.open = function (method, url, ...) {
  (this as any).__seUrl = typeof url === 'string' ? url : url.toString();
  return origOpen.call(this, method, url, ...);
};
```

### Intercepting the Send

`XMLHttpRequest.prototype.send` checks two conditions before intercepting:

1. The URL contains `/api/subscriptions.thread.mark`
2. The `<html>` element has the `data-se-block-thread-marks` attribute (the control gate)
3. The request body has `read=1` (only intercept mark-as-read, not mark-as-unread)

```typescript
XMLHttpRequest.prototype.send = function (body?) {
  if ((this as any).__seAllow) {
    return origSend.call(this, body);  // Our own replayed requests pass through
  }

  const url = (this as any).__seUrl;

  if (
    url?.includes('/api/subscriptions.thread.mark') &&
    document.documentElement.hasAttribute('data-se-block-thread-marks') &&
    isReadOne(body)
  ) {
    // Extract and forward params, then return fake success
  }

  return origSend.call(this, body);
};
```

The `__seAllow` flag is how replayed requests bypass the interceptor (see [Replaying Requests](#replaying-requests)).

### The Fake Success (Blob URL Trick)

When a request is intercepted, we need to make Slack think it succeeded without hitting the network. We can't just set `responseText` directly — XHR enforces that responses come from actual loads. Instead, we redirect the request to a `blob:` URL containing the fake JSON response:

```typescript
const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
const blobUrl = URL.createObjectURL(blob);
this.addEventListener('loadend', () => URL.revokeObjectURL(blobUrl), { once: true });
origOpen.call(this, 'GET', blobUrl, true);
return origSend.call(this, null);
```

This works because:
- `origOpen` redirects the XHR to load our blob instead of hitting Slack's API
- The blob loads synchronously (it's in-memory), triggering all the normal XHR lifecycle events (`load`, `loadend`, etc.)
- Slack's response handlers receive `{"ok":true}` and believe the mark-as-read succeeded
- Slack does not retry the request or show an error
- The blob URL is revoked after `loadend` to avoid memory leaks

### Body Format Handling

The request body may come in several formats depending on how Slack constructs it. The `isReadOne` and `extractParams` helpers handle all of them:

```typescript
function isReadOne(body): boolean {
  if (typeof body === 'string') return new URLSearchParams(body).get('read') === '1';
  if (body instanceof URLSearchParams) return body.get('read') === '1';
  if (body instanceof FormData) return (body.get('read') as string) === '1';
  return false;
}
```

---

## The Control Gate

The `data-se-block-thread-marks` attribute on `<html>` acts as the on/off switch for interception. The CONTENT world script manages it:

```typescript
function updateBlockingAttribute() {
  if (isThreadsPage()) {
    document.documentElement.setAttribute('data-se-block-thread-marks', '');
  } else {
    document.documentElement.removeAttribute('data-se-block-thread-marks');
  }
}

function isThreadsPage(): boolean {
  return document.querySelector('[data-qa="threads_view"]') !== null;
}
```

Blocking is only active on the Threads page. On all other pages, mark-as-read requests pass through normally. The attribute is updated:

1. Immediately on any DOM mutation (via `MutationObserver`), so navigating away unblocks requests without delay
2. On a debounced 150ms timer after mutations, for button injection
3. Every 2 seconds via polling, as a fallback

This ensures the interceptor never blocks requests on the wrong page, even during SPA navigation transitions.

---

## Request Capture and Storage

When the MAIN world intercepts a request, it extracts the full request parameters and dispatches a `CustomEvent` to notify the CONTENT world:

```typescript
document.dispatchEvent(new CustomEvent('se-thread-mark-intercepted', {
  detail: JSON.stringify({ token, channel, thread_ts, ts, url }),
}));
```

The CONTENT world listener stores these in a `Map` keyed by `{channel}-{thread_ts}`:

```typescript
const blockedRequests = new Map<string, {
  token: string; url: string; channel: string; thread_ts: string; ts: string;
}>();

// On interception:
const key = `${detail.channel}-${detail.thread_ts}`;
const existing = blockedRequests.get(key);
if (!existing || detail.ts > existing.ts) {
  blockedRequests.set(key, { token, url, channel, thread_ts, ts });
}
```

If multiple mark-as-read requests fire for the same thread (e.g. from scrolling), only the one with the latest `ts` is kept. This matches what Slack would have done — mark everything up to the latest message.

---

## Token Acquisition

The extension needs the API token to replay requests. It acquires it through two mechanisms:

### Primary: Intercepted Request Parameters

The token is included in every intercepted `subscriptions.thread.mark` request body. The CONTENT world extracts and stores it from the first interception:

```typescript
if (detail.token && detail.url) {
  capturedToken = { token: detail.token, url: detail.url };
}
```

### Fallback: Background Script webRequest

The background script observes all Slack API requests via the `webRequest` API and captures the token from the first one it sees:

```typescript
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (tabTokens.has(details.tabId)) return;
    const token = details.requestBody?.formData?.token?.[0];
    if (typeof token === 'string') {
      tabTokens.set(details.tabId, {
        token,
        url: details.url.replace(/\/api\/.*$/, '/api/subscriptions.thread.mark'),
      });
    }
  },
  { urls: ['*://*.slack.com/api/*'], types: ['xmlhttprequest'] },
  ['requestBody']
);
```

The content script queries this via `browser.runtime.sendMessage({ type: 'GET_TOKEN' })` when it needs to replay a request but hasn't captured a token from an interception yet (e.g. if the user loads the Threads page with no unread threads, then one becomes unread).

---

## Threads Page DOM Structure

### Detecting the Threads Page

The Threads page is identified by the presence of `[data-qa="threads_view"]` in the DOM.

### Virtual List Item IDs

The Threads page uses a virtualized list. Each visible item has a `data-qa="virtual-list-item"` attribute and an `id` following this pattern:

```
threads_view-{channel}-{thread_ts}                    # Message within a thread
threads_view_heading-{channel}-{thread_ts}            # Thread header
threads_view_footer-{channel}-{thread_ts}             # Thread footer (reply box area)
threads_view-{channel}-{thread_ts}-{message_ts}       # Specific message in thread
threads_view-{channel}-{thread_ts}-divider-...        # "New" divider
```

### The "New" Divider

When a thread has unread replies, Slack inserts a divider element with `data-qa="thread-marked-as-read-divider"`. This divider may scroll out of the virtual list's visible range as the user scrolls, which is why we track unread state in a `Set` rather than relying on DOM presence:

```typescript
const seenUnreadThreads = new Set<string>();

// Scan visible items for "New" dividers
for (const item of allItems) {
  if (item.querySelector('[data-qa="thread-marked-as-read-divider"]')) {
    const m = id.match(/([A-Z0-9]+)-([\d.]+)/);
    if (m) seenUnreadThreads.add(`${m[1]}-${m[2]}`);
  }
}
```

Once a thread is observed with a "New" divider, it stays in `seenUnreadThreads` until the user clicks "Mark as read" or navigates away from the Threads page.

### Thread Footer and Reply Container

The "Mark as read" button is injected into the footer item's `[data-qa="reply_container"]` element, inserted before its first child. The footer item is identified by having `footer` in its ID.

---

## Replaying Requests

When the user clicks "Mark as read", the stored request parameters are sent back to the MAIN world for replay:

### Content World → MAIN World

```typescript
document.dispatchEvent(new CustomEvent('se-mark-thread-read', {
  detail: JSON.stringify({ token, url, channel, thread_ts, ts }),
}));
```

### MAIN World Replay

The MAIN world listener creates a fresh XHR with `__seAllow = true` so it bypasses the interceptor:

```typescript
document.addEventListener('se-mark-thread-read', (e: CustomEvent) => {
  const { token, url, channel, thread_ts, ts } = JSON.parse(e.detail);
  const xhr = new XMLHttpRequest();
  (xhr as any).__seAllow = true;
  xhr.open('POST', url);
  xhr.withCredentials = true;
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.addEventListener('load', () => {
    document.dispatchEvent(new CustomEvent('se-mark-thread-read-result', {
      detail: xhr.responseText,
    }));
  });
  xhr.send(new URLSearchParams({ token, channel, thread_ts, ts, read: '1' }).toString());
});
```

### Result Handling

The content script listens for `se-mark-thread-read-result` and updates the UI:

- **Success:** Button text changes to "Marked", thread is removed from `seenUnreadThreads`, and the "New" divider elements within that thread are hidden (`display: none`)
- **Failure:** Button text changes to `Failed: {error}` (e.g. `Failed: invalid_auth`, `Failed: network_error`)

### Fallback: No Blocked Request Captured

If the user sees a thread with unread messages but no `subscriptions.thread.mark` request was intercepted for it (e.g. Slack didn't fire one during the session), the button still works. It falls back to:

1. Getting a token from `capturedToken` or the background script
2. Scanning visible message item IDs to find the latest `ts` for that thread
3. Constructing and replaying the request from those values

```typescript
const latestTs = getLatestMessageTs(channel, threadTs);
replayMarkAsRead(btn, { token, url, channel, thread_ts: threadTs, ts: latestTs });
```

---

## Event Flow Summary

```
Slack fires POST /api/subscriptions.thread.mark
       │
       ▼
XHR.send() interceptor (MAIN world)
       │
       ├── URL matches? ─── No ──→ Pass through normally
       │
       ├── data-se-block-thread-marks present? ─── No ──→ Pass through
       │
       ├── read=1? ─── No ──→ Pass through
       │
       ▼ Yes to all
  Extract params from request body
  Dispatch se-thread-mark-intercepted CustomEvent
  Redirect XHR to blob:// with {"ok":true}
  Slack receives fake success, no retry
       │
       ▼
Content script receives se-thread-mark-intercepted
  Store params in blockedRequests Map (keyed by channel-threadTs)
  Show toast: "Auto-mark-as-read blocked (N thread(s))"
  Inject "Mark as read" button in thread footer
       │
       ▼  (user clicks button)
Content script dispatches se-mark-thread-read CustomEvent
       │
       ▼
MAIN world listener
  Create new XHR with __seAllow = true
  POST real request to Slack API
  Dispatch se-mark-thread-read-result with response
       │
       ▼
Content script receives se-mark-thread-read-result
  Update button text ("Marked" or "Failed: ...")
  Hide "New" divider elements
  Remove thread from seenUnreadThreads
```

---

## Cross-World Communication Protocol

All communication between MAIN and CONTENT worlds uses `CustomEvent`s on `document`:

| Event Name | Direction | Payload | Purpose |
|------------|-----------|---------|---------|
| `se-thread-mark-intercepted` | MAIN → CONTENT | `{token, url, channel, thread_ts, ts}` | Notify of blocked request |
| `se-mark-thread-read` | CONTENT → MAIN | `{token, url, channel, thread_ts, ts}` | Trigger real API call |
| `se-mark-thread-read-result` | MAIN → CONTENT | `{ok, error?}` | Return API response |

All payloads are JSON-stringified in the `detail` field.

---

## Why This Approach

### Why not use `fetch` interception?

Slack uses `XMLHttpRequest` for `subscriptions.thread.mark`, not `fetch`. We confirmed this by monitoring network requests. If Slack migrates to `fetch` in the future, we'd need to add a `fetch` wrapper as well.

### Why blob URLs instead of a mock response?

XHR's `response`, `responseText`, and `status` properties are read-only and tied to actual network loads. You can't just set `xhr.responseText = '{"ok":true}'`. The blob URL approach creates a real (but local) network load that populates these properties correctly and triggers all lifecycle events in the right order.

### Why a DOM attribute as the control gate?

The MAIN world script and CONTENT world script can't share JavaScript variables — they run in separate V8 contexts. The DOM is the shared surface. A `data-` attribute on `<html>` is:
- Readable from both worlds
- Instantly updated (no async)
- Trivially inspected in DevTools for debugging

### Why store params per-thread instead of globally?

Each thread may have a different `ts` (latest message timestamp). Storing per-thread lets the user mark individual threads as read. A global "mark all as read" button could be built on top by iterating `blockedRequests.values()`.
