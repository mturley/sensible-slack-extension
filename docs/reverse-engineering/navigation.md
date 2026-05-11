# Slack SPA Navigation — Reverse Engineering Notes

Slack's web client is a React + Redux app bundled with webpack. It does **not** use React Router. Navigation is driven by Redux thunks dispatched to two separate stores, coordinated with `history.pushState`.

This document covers the internal architecture and provides a deploy-resilient API that a browser extension can use to trigger SPA navigation without page reloads — to channels, threads, and specific messages.

Tested: May 2026 on app.slack.com (Red Hat Enterprise workspace).

## Architecture

### Two Redux Stores

Both are accessible via the React fiber tree on `.p-client_container`:

1. **Client Store** — manages window layout, navigation history, tab state.
   - Identified by state keys: `mainWindowHistory`, `tabSoda`, `viewLayout`, `workspaces`
   - Lives on a `<Provider>` component near the top of the fiber tree

2. **Workspace Store** — manages channel data, messages, sockets, boot data.
   - Identified by state keys: `bootData`, `channelPrefs`, `socket`, `endpoints`
   - Lives on a deeper `<Provider>` component in the fiber tree

### Navigation Flow

What happens when a user clicks a channel or thread link:

1. React `onClick` handler calls a thunk creator with navigation params
2. Thunk is dispatched to the **workspace store**
3. Workspace thunk fetches data (channel history, thread replies, etc.)
4. Workspace thunk dispatches `[1344] "Push new view set"` to the **client store**
5. Client store reducer updates `tabSoda` / `mainWindowHistory`
6. React re-renders the UI based on the new view state
7. `history.pushState` is called to update the URL bar

**Key insight:** Dispatching `[1344]` directly to the client store updates Redux state but does **not** trigger UI re-renders. The workspace store thunks are required because they coordinate data fetching and view transitions. Similarly, `history.pushState` + `popstate` events update the URL but Slack does not listen to `popstate` for navigation.

### View Entry Structure

Slack's navigation state is a view entry with slots for each tab:

```json
{
  "home": {
    "sidebar": { "id": "ChannelList", "viewType": "ChannelList" },
    "primary": { "id": "C05SMJ09DD2", "viewType": "Channel" },
    "secondary": { "id": "thread", "viewType": "Thread", "params": { "..." } }
  },
  "activeTab": "home",
  "id": "<uuid>",
  "teamId": "<team-id>",
  "isIA4": true
}
```

- Channel navigation changes `home.primary`
- Opening a thread panel adds `home.secondary`

---

## Implementation

### Step 1: Obtain `__webpack_require__`

Slack's webpack runtime exposes a chunk loading mechanism via `window.webpackChunkwebapp`. By pushing a probe chunk with a runtime function, we receive the internal `require` function as a callback argument.

```typescript
function getWebpackRequire(): WebpackRequire {
  let wr: WebpackRequire | null = null;
  try {
    (window as any).webpackChunkwebapp.push([
      ["__sensible_slack_probe__"],
      {},
      function (require: WebpackRequire) {
        wr = require;
      },
    ]);
  } catch (_e) {
    // The probe chunk may throw after giving us require — that's fine.
  }
  if (!wr) throw new Error("Failed to obtain __webpack_require__");
  return wr;
}
```

### Step 2: Obtain the Workspace Redux Store

The workspace store handles navigation thunks. We find it by walking the React fiber tree from `.p-client_container` and looking for a `<Provider>` whose store state contains `"bootData"`.

```typescript
function getWorkspaceStore(): ReduxStore {
  const container = document.querySelector(".p-client_container");
  if (!container) throw new Error("Slack client container not found");

  const fiberKey = Object.keys(container).find(
    (k) => k.startsWith("__reactContainer$") || k.startsWith("__reactFiber$"),
  );
  if (!fiberKey) throw new Error("React fiber not found on container element");

  let fiber = (container as any)[fiberKey];
  let depth = 0;
  while (fiber && depth < 100) {
    if (fiber.memoizedProps?.store) {
      const stateKeys = Object.keys(fiber.memoizedProps.store.getState?.() || {});
      if (stateKeys.includes("bootData")) {
        return fiber.memoizedProps.store;
      }
    }
    fiber = fiber.child;
    depth++;
  }
  throw new Error("Workspace store not found in fiber tree");
}
```

### Step 3: Find Webpack Modules by Description String

Webpack module IDs and export keys change on every Slack deploy. But human-readable thunk/function description strings are stable. We search module source code for these strings at runtime (~26ms for 13,625 modules).

```typescript
function findThunkCreator(
  wr: WebpackRequire,
  description: string,
): (...args: any[]) => ReduxThunk {
  const modules = wr.m;
  for (const id of Object.keys(modules)) {
    if (modules[id].toString().includes(description)) {
      const mod = wr(id);
      for (const key of Object.keys(mod)) {
        if (typeof mod[key] === "function") {
          try {
            const testThunk = mod[key]({ channelId: "_", threadTs: "_" });
            if (typeof testThunk === "function" && testThunk.description?.includes(description)) {
              return mod[key];
            }
          } catch (_e) {
            // Not the right export, continue.
          }
        }
      }
    }
  }
  throw new Error(`Thunk creator not found: "${description}"`);
}
```

### Step 4: Locate the View Constructors and Navigate Function

Two key modules are needed:

- **viewMod** — Contains view constructor functions:
  - `.UX({channelId, threadTs, replyTs, highlightRoot})` → Thread view object
  - `.R9(channelId, ts, highlightTs)` → Channel-scroll-to-message view object

- **navMod** — Contains the navigate function:
  - `.o(viewObject)` → Redux thunk that performs the navigation

> **Note:** `.UX`, `.R9`, and `.o` are minified export names that will change across deploys. The code below finds these dynamically.

**Finding viewMod** — identified by containing `"dangerouslyOverrideRouting"` (a param name unique to Slack's thread view constructor):

```typescript
function getViewMod(wr: WebpackRequire) {
  const modules = wr.m;
  for (const id of Object.keys(modules)) {
    const src = modules[id].toString();
    if (src.includes("dangerouslyOverrideRouting") && src.includes("highlightRoot")) {
      const mod = wr(id);
      // Verify by probing exports
      for (const key of Object.keys(mod)) {
        if (typeof mod[key] === "function") {
          try {
            const result = mod[key]({ channelId: "_", threadTs: "_" });
            if (result?.params?.dangerouslyOverrideRouting !== undefined) {
              return mod;
            }
          } catch (_e) { /* continue */ }
        }
      }
    }
  }
  throw new Error("View constructor module not found");
}
```

**Finding navMod** — identified by tracing imports from the `"Handle navigation click from attachment footer"` thunk, which imports the navigate function:

```typescript
function getNavMod(wr: WebpackRequire) {
  const attachmentFooterDesc = "Handle navigation click from attachment footer";
  const modules = wr.m;
  for (const id of Object.keys(modules)) {
    const src = modules[id].toString();
    if (src.includes(attachmentFooterDesc)) {
      // Parse the imported module hex IDs from the source
      const importMatches = [...src.matchAll(/a\((0x[0-9a-f]+)\)/g)];
      for (const match of importMatches) {
        const hexId = parseInt(match[1], 16).toString();
        try {
          const candidate = wr(hexId);
          if (candidate && typeof candidate.o === "function") {
            const testView = { id: "test", viewType: "Channel" };
            const result = candidate.o(testView);
            if (typeof result === "function") {
              return candidate;
            }
          }
        } catch (_e) { /* continue */ }
      }
    }
  }
  throw new Error("Navigate module not found");
}
```

---

## Clean API

```typescript
interface SlackNavOptions {
  channelId: string;
  threadTs?: string;
  replyTs?: string;
  messageTs?: string;
  highlightRoot?: boolean;
}

function createSlackNav() {
  let wr: WebpackRequire | null = null;
  let wsStore: ReduxStore | null = null;
  let viewMod: any = null;
  let navMod: any = null;

  function ensureInitialized() {
    if (!wr) wr = getWebpackRequire();
    if (!wsStore) wsStore = getWorkspaceStore();
    if (!viewMod) viewMod = getViewMod(wr);
    if (!navMod) navMod = getNavMod(wr);
  }

  return {
    openThread(opts: SlackNavOptions) { /* see below */ },
    jumpToMessage(opts: SlackNavOptions) { /* see below */ },
  };
}
```

### `openThread` — Open a Thread in the Side Panel

Opens the thread flexpane (right panel) showing the thread starting from the root message, optionally scrolled to a specific reply. Also navigates the main channel pane to the thread's channel.

```typescript
openThread({ channelId, threadTs, replyTs, highlightRoot = true }) {
  ensureInitialized();

  // UX constructs a Thread view object.
  // When replyTs is provided, the thread panel scrolls to that reply
  // and the message gets a brief highlight animation (yellow flash).
  const threadView = viewMod.UX({
    channelId,
    threadTs,
    replyTs,
    highlightRoot,
  });

  // navMod.o wraps the view in a navigation thunk.
  // Dispatching to the workspace store triggers the full navigation flow:
  // data fetching, view transition, history.pushState, and React re-render.
  wsStore.dispatch(navMod.o(threadView));
}
```

**Usage examples:**

```typescript
const nav = createSlackNav();

// Open a thread panel scrolled to a specific reply (with highlight):
nav.openThread({
  channelId: "C05SMJ09DD2",
  threadTs: "1776143970.171229",
  replyTs: "1776162537.065889",
});

// Open a thread panel to a root message (shows root + all replies):
nav.openThread({
  channelId: "C05SMJ09DD2",
  threadTs: "1746622698.699349",
  replyTs: "1746622698.699349",
  highlightRoot: true,
});

// Open a thread panel without highlighting a specific reply:
nav.openThread({
  channelId: "C05SMJ09DD2",
  threadTs: "1746622698.699349",
});
```

### `jumpToMessage` — Navigate the Channel View to a Message

Scrolls the main channel pane to a specific message and highlights it. Does **not** open the thread panel. This is what Slack's "View message" link does.

```typescript
jumpToMessage({ channelId, messageTs }) {
  ensureInitialized();

  const ts = messageTs || threadTs || replyTs;
  if (!ts) throw new Error("messageTs is required");

  // R9 constructs a Channel view object with startTs and highlightTs.
  const channelView = viewMod.R9(channelId, ts, ts);

  wsStore.dispatch(navMod.o(channelView));
}
```

**Usage example:**

```typescript
nav.jumpToMessage({
  channelId: "C05SMJ09DD2",
  messageTs: "1746622698.699349",
});
```

---

## Content Script Setup

The extension's content script must run in the **MAIN world** (not the isolated content script world) to access Slack's JavaScript context:

```json
// manifest.json (MV3)
{
  "content_scripts": [{
    "matches": ["https://app.slack.com/*"],
    "js": ["content.js"],
    "world": "MAIN",
    "run_at": "document_idle"
  }]
}
```

---

## Parsing Slack URLs

Slack archive URLs encode timestamps by removing the dot from the `p`-prefixed value:

```
https://redhat-internal.slack.com/archives/C05SMJ09DD2/p1776162537065889
→ channelId: "C05SMJ09DD2", ts: "1776162537.065889"
```

Thread replies include query params:

```
?thread_ts=1776143970.171229&cid=C05SMJ09DD2
→ threadTs: "1776143970.171229"
```

Conversion: insert a dot before the last 6 digits of the `p`-prefixed timestamp.

```typescript
function parseSlackUrl(url: string): SlackNavOptions | null {
  const match = url.match(
    /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?.*thread_ts=([\d.]+))?/,
  );
  if (!match) return null;

  const channelId = match[1];
  const ts = `${match[2]}.${match[3]}`;
  const threadTs = match[4];

  if (threadTs) {
    return { channelId, threadTs, replyTs: ts };
  } else {
    return { channelId, messageTs: ts, threadTs: ts };
  }
}
```

---

## Alternative Approach: `showThreadOrRefresh` Thunk

There is also a higher-level thunk that can be used instead of the view constructor approach. It takes `{ channelId, threadTs, highlightTs, requestFocus, shouldOpenInTile }` and handles the case where the thread panel is already open to the same thread.

The view constructor approach (`viewMod.UX` + `navMod.o`) is **preferred** because:
1. It gives us access to both thread panel AND channel-jump navigation
2. It sets both `params.replyTs` and `uiState.highlightTs` correctly
3. It's what Slack's own "View reply" click handler uses

The `showThreadOrRefresh` thunk is simpler but only handles thread panel opens:

```typescript
const showThreadOrRefresh = findThunkCreator(
  wr,
  "Open the thread in the flexpane or refresh it if already open",
);
wsStore.dispatch(showThreadOrRefresh({
  channelId: "C05SMJ09DD2",
  threadTs: "1776143970.171229",
  highlightTs: "1776162476.804769",
  requestFocus: true,
  shouldOpenInTile: false,
}));
```

---

## Deploy Resilience

### What is STABLE across deploys

- Thunk description strings (e.g. `"Open the thread in the flexpane..."`)
- View object shape (`viewType`, params keys like `threadId`, `replyTs`)
- The `"dangerouslyOverrideRouting"` param name in view constructors
- The React fiber tree structure (`Provider` → `store` pattern)
- The `webpackChunkwebapp` global and chunk push mechanism
- The store state key names (`bootData`, `mainWindowHistory`, `tabSoda`)

### What CHANGES across deploys

- Webpack module IDs (numeric strings)
- Export key names (single letters like `.O`, `.A`, `.UX`, `.R9`)
- React fiber key suffixes (`__reactContainer$xxxxx`)
- Minified variable names in thunk/component source code

### How the API handles this

1. Searching module source code for stable description strings
2. Probing exports by calling them with test args and checking results
3. Using `Object.keys()` to find React fiber keys by prefix
4. Never hardcoding module IDs or export keys

Performance: searching 13,625 modules by `toString().includes()` takes **~26ms**. Results are cached after first lookup.

---

## What Does NOT Work (Failed Approaches)

1. **Dispatching `[1344]` directly to the client store:**
   Updates Redux state (`tabSoda`, `mainWindowHistory`) but does NOT trigger UI re-renders. The workspace store thunks are required.

2. **`history.pushState` + `dispatchEvent(new PopStateEvent('popstate'))`:**
   Updates the URL bar but Slack does not listen to `popstate` for navigation. The URL changes but the UI stays on the same view.

3. **Programmatic `element.click()` on sidebar items:**
   Raw DOM `.click()` does not trigger React synthetic event handlers. Playwright's click (which simulates real mouse events) works, but programmatic clicks from extension code do not.

4. **Calling React fiber `onClick` handlers with synthetic events:**
   WORKS but requires the target element to be rendered in the DOM. Not viable for navigating to channels/threads not visible in the sidebar. This was our stepping stone to discovering the thunk-based approach.

---

## Type Stubs

```typescript
type WebpackRequire = ((id: string) => any) & { m: Record<string, Function> };
type WebpackModule = Record<string, any>;
type ReduxStore = { dispatch: (action: any) => any; getState: () => any };
type ReduxThunk = Function & { type?: string; description?: string };
```
