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

### Step 4: Locate the View Constructor and Navigate Function

Two key functions are needed (their minified export names change every deploy):

- **threadViewFn** — Constructs a Thread view object: `({channelId, threadTs, replyTs, highlightRoot}) => viewObject`
- **navigateFn** — Wraps a view object in a navigation thunk: `(viewObject) => reduxThunk`

Both are found by tracing imports from the `"Opens the threads flexpane"` inner thunk. This thunk's source contains a nested call like `e((0,r.o)((0,i.UX)({channelId:a, threadTs:o})))` where `r.o` is the navigate function and `i.UX` is the view constructor.

> **Why this thunk?** The `"Handle navigation click from attachment footer"` thunk also imports a navigate function, but it imports many other modules too. Probing all its imports for "returns a function when called with a view object" produces false positives — other thunk creators pass the same probe. The inner `"Opens the threads flexpane"` thunk has fewer imports and directly uses both functions we need in a single parseable call expression.

> **Why not `showThreadOrRefresh`?** The `"Open the thread in the flexpane or refresh it if already open"` thunk destructures `highlightTs` from its params but never passes it through to the inner thunk in the non-tile code path. It drops `replyTs` silently, so threads always open without scrolling to a specific reply.

```typescript
function discoverNavFunctions(wr: WebpackRequire) {
  const desc = "Opens the threads flexpane";

  for (const id of Object.keys(wr.m)) {
    const src = wr.m[id].toString();
    if (!src.includes(desc)) continue;

    // Parse the nested call: e((0,NAV_VAR.NAV_KEY)((0,VIEW_VAR.VIEW_KEY)({...})))
    const nestedMatch = src.match(/e\(\(0,(\w+)\.(\w+)\)\(\(0,(\w+)\.(\w+)\)\(\{/);
    if (!nestedMatch) continue;

    const [, navVar, navKey, viewVar, viewKey] = nestedMatch;

    // Map local variables to their import hex IDs
    const navImport = src.match(new RegExp(`(?:^|,)${navVar}=a\\((0x[0-9a-f]+)\\)`));
    const viewImport = src.match(new RegExp(`(?:^|,)${viewVar}=a\\((0x[0-9a-f]+)\\)`));
    if (!navImport || !viewImport) continue;

    const navModId = parseInt(navImport[1], 16).toString();
    const viewModId = parseInt(viewImport[1], 16).toString();

    const navMod = wr(navModId);
    const viewMod = wr(viewModId);

    if (typeof navMod?.[navKey] === "function" && typeof viewMod?.[viewKey] === "function") {
      return {
        navigateFn: navMod[navKey],
        threadViewFn: viewMod[viewKey],
      };
    }
  }
  throw new Error("Navigate/view functions not found");
}
```

> **Note on multiple matches:** The string `"dangerouslyOverrideRouting"` appears in ~4 modules. Only the large view constructor module (~22k chars with 100+ exports) has the actual functions. The others reference the string in different contexts. The approach above avoids this ambiguity entirely by tracing from the thunk that uses both functions.

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
  let navigateFn: Function | null = null;
  let threadViewFn: Function | null = null;

  function ensureInitialized() {
    if (!wr) wr = getWebpackRequire();
    if (!wsStore) wsStore = getWorkspaceStore();
    if (!navigateFn || !threadViewFn) {
      const fns = discoverNavFunctions(wr);
      navigateFn = fns.navigateFn;
      threadViewFn = fns.threadViewFn;
    }
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

  // threadViewFn constructs a Thread view object.
  // replyTs controls which message to scroll to and highlight.
  // Default to threadTs so root messages scroll to top instead of
  // preserving stale scroll state from a previous view.
  const threadView = threadViewFn({
    channelId,
    threadTs,
    replyTs: replyTs || threadTs,
    highlightRoot,
  });

  // navigateFn wraps the view in a navigation thunk.
  // Dispatching to the workspace store triggers the full navigation flow:
  // data fetching, view transition, history.pushState, and React re-render.
  wsStore.dispatch(navigateFn(threadView));
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

// Open a thread panel to a root message (scrolls to top, highlights root):
nav.openThread({
  channelId: "C05SMJ09DD2",
  threadTs: "1746622698.699349",
});

// Explicitly highlight a specific reply as the root:
nav.openThread({
  channelId: "C05SMJ09DD2",
  threadTs: "1746622698.699349",
  replyTs: "1746622698.699349",
  highlightRoot: true,
});
```

### `jumpToMessage` — Open Thread Panel at a Message

Opens the thread panel scrolled to the target message. For messages that are thread roots, this opens the thread at the top. This is useful for "scroll to message" functionality.

```typescript
jumpToMessage({ channelId, messageTs }) {
  ensureInitialized();

  const ts = messageTs || threadTs || replyTs;
  if (!ts) throw new Error("messageTs is required");

  const threadView = threadViewFn({
    channelId,
    threadTs: ts,
    replyTs: ts,
    highlightRoot: true,
  });

  wsStore.dispatch(navigateFn(threadView));
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

**Cross-world communication:** MAIN and ISOLATED world scripts communicate via `CustomEvent` on the document. In MV3, `CustomEvent.detail` must be a JSON string — structured objects are silently dropped as `null` when crossing the world boundary:

```typescript
// ISOLATED world → MAIN world
document.dispatchEvent(new CustomEvent("se-spa-nav-request", {
  detail: JSON.stringify({ action: "openThread", channelId, threadTs }),
}));

// MAIN world listener
document.addEventListener("se-spa-nav-request", (e: CustomEvent) => {
  const detail = JSON.parse(e.detail);  // must parse, e.detail is a string
});
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

There is a higher-level thunk `"Open the thread in the flexpane or refresh it if already open"` that can open threads. It takes `{ channelId, threadTs, highlightTs, requestFocus, shouldOpenInTile }`.

**This thunk is NOT recommended** because it silently drops `highlightTs`. The thunk destructures `highlightTs` from the params object, but in the non-tile code path it spreads only the remaining params (`...h`) to the inner thunk — and since `highlightTs` was already destructured out, it's excluded from the spread. The result: threads open without scrolling to or highlighting the target reply.

The view constructor approach (`threadViewFn` + `navigateFn`) is **required** for reply highlighting because:
1. It sets both `params.replyTs` and `uiState.highlightTs` in the view object
2. These fields are what Slack's rendering code reads to scroll and highlight
3. It's the same code path that Slack's own "View reply" click handler uses

```typescript
// DON'T use showThreadOrRefresh — highlightTs is silently dropped:
wsStore.dispatch(showThreadOrRefresh({
  channelId: "C05SMJ09DD2",
  threadTs: "1776143970.171229",
  highlightTs: "1776162476.804769",  // ← this gets ignored!
  requestFocus: true,
  shouldOpenInTile: false,
}));

// DO use threadViewFn + navigateFn — replyTs is correctly propagated:
const view = threadViewFn({
  channelId: "C05SMJ09DD2",
  threadTs: "1776143970.171229",
  replyTs: "1776162476.804769",      // ← this works
  highlightRoot: true,
});
wsStore.dispatch(navigateFn(view));
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
2. Parsing source code to trace import variable names to hex module IDs
3. Using `Object.keys()` to find React fiber keys by prefix
4. Never hardcoding module IDs or export keys

Performance: searching 13,625 modules by `toString().includes()` takes **~26ms**. Results are cached after first lookup.

### Pitfalls discovered during implementation

**Multiple modules match the same search strings.** The string `"dangerouslyOverrideRouting"` appears in ~4 modules. Only one is the view constructor module. Probing exports helps disambiguate, but it's safer to trace from a thunk that directly imports the module you need (as `discoverNavFunctions` does).

**Probing imports produces false positives.** The `"Handle navigation click from attachment footer"` thunk imports many modules. Checking "does this export return a function when called with a view object?" matches other thunk creators too, not just the navigate function. The fix: parse the thunk source to find which variable name is used in the navigate call, then map that variable to its specific import.

**`CustomEvent.detail` does not cross the MAIN/ISOLATED world boundary in MV3.** Structured objects passed as `detail` arrive as `null` in the other world. Always `JSON.stringify` the detail and `JSON.parse` on the receiving end. This applies to both Chrome and Firefox.

**`replyTs` must be set for scroll-to-message behavior.** If `replyTs` is omitted from the view constructor call, the thread panel opens but does not scroll — it preserves whatever scroll position was last used for that thread. Always default `replyTs` to `threadTs` when navigating to a thread root to ensure scroll-to-top.

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

5. **Probing all imports of the attachment footer thunk for the navigate function:**
   The attachment footer thunk imports ~20 modules. Probing each with `candidate[key]({id: "test", viewType: "Channel"})` and checking "returns a function" matches the wrong module in Firefox — another thunk creator passes the same test. Produces "We're unable to open this link" errors. Fixed by parsing the source to trace which specific import variable is used in the navigate call.

6. **Using `showThreadOrRefresh` for reply-specific navigation:**
   The thunk destructures `highlightTs` from params but never passes it through to the inner thunk's view constructor call. Threads open but don't scroll to the target reply.

---

## Type Stubs

```typescript
type WebpackRequire = ((id: string) => any) & { m: Record<string, Function> };
type WebpackModule = Record<string, any>;
type ReduxStore = { dispatch: (action: any) => any; getState: () => any };
type ReduxThunk = Function & { type?: string; description?: string };
```
