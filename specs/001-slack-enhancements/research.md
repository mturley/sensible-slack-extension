# Research: Slack Web Interface Enhancements

**Date**: 2026-03-19 | **Branch**: `001-slack-enhancements`

## R1: Redirect Prevention Mechanism

**Decision**: Use content scripts as the primary redirect interception mechanism, supplemented by declarativeNetRequest rules for HTTP-level redirects.

**Rationale**: Slack uses multiple redirect mechanisms: JavaScript-triggered `window.location` changes to `slack://` protocol, interstitial pages that detect the desktop app, and occasional HTTP redirects. Content scripts can intercept all JavaScript-triggered navigations (the most common case), while declarativeNetRequest handles HTTP 3xx redirects. Protocol scheme redirects (`slack://`) cannot be blocked at the network level — only content scripts can prevent them by intercepting the navigation trigger before it fires.

**Alternatives considered**:
- declarativeNetRequest only: Cannot intercept JavaScript-triggered or protocol scheme redirects.
- webRequest API: Deprecated in Chrome MV3; would work in Firefox but creates an inconsistent cross-browser implementation.
- Background script interception: Cannot observe or modify page-level JavaScript navigation.

**Implementation approach**:
- Content script injected at `document_start` on `*.slack.com` to intercept redirect attempts early.
- Override/block `slack://` protocol navigation via event listeners on link clicks and `beforeunload`.
- declarativeNetRequest rules to block known Slack redirect URLs at the HTTP level.
- Toggle state read from `storage.local` on script initialization.

## R2: DOM Injection Strategy for Slack's React SPA

**Decision**: Use debounced MutationObserver combined with IntersectionObserver for efficient, resilient DOM injection into Slack's message action bars.

**Rationale**: Slack's web interface is a React SPA with virtual scrolling — message DOM nodes are created and destroyed as the user scrolls. Injected buttons must be re-injected whenever new messages render. MutationObserver detects DOM changes; IntersectionObserver ensures injection only for visible messages (performance). This combination handles virtual scrolling, SPA navigation, and React re-renders.

**Alternatives considered**:
- Polling/setInterval: Wasteful and introduces visible delay.
- React internal inspection (`__reactInternalInstance`): Fragile, undocumented, breaks across React versions.
- Single injection pass: Doesn't survive virtual scrolling or route changes.

**Selector resilience strategy** (priority order):
1. `data-qa` attributes (Slack's internal QA selectors, most stable)
2. ARIA roles (`role="toolbar"`, `role="article"`)
3. Semantic class name patterns (`[class*="c-message_actions"]`)
4. Fallback functions with structural heuristics

**Graceful degradation**: Selector fallback chains with try-catch isolation. If all selectors fail, the feature silently disables and sets a badge on the extension icon. No broken UI is ever shown.

## R3: Cross-Browser Build Tooling

**Decision**: Use WXT (Web Extension Tools) framework with TypeScript.

**Rationale**: WXT is purpose-built for cross-browser extensions. It handles Manifest V3 (Chrome) vs V2/V3 (Firefox) differences automatically, provides built-in HMR for development, generates per-browser manifests from a single source, and is built on Vite internally. It eliminates the need for manual browser-specific configuration while supporting TypeScript strict mode out of the box.

**Alternatives considered**:
- Vite + vite-plugin-web-extension: Viable but requires more manual configuration for cross-browser manifest differences.
- Webpack: Heavier, more configuration overhead, slower rebuild times.
- Plasmo: More opinionated, React-focused; adds unnecessary abstraction for this project.
- esbuild standalone: Too minimal; lacks manifest generation and extension-specific features.

**Key WXT benefits for this project**:
- Automatic manifest generation for Chrome and Firefox from single config
- Built-in HMR for popup, content scripts, and background
- Zero-config TypeScript support
- Handles `chrome.*` vs `browser.*` API differences via webextension-polyfill

## R4: Storage Architecture

**Decision**: Use `browser.storage.local` (via webextension-polyfill) with workspace-scoped keys.

**Rationale**: `storage.local` persists across browser sessions, supports up to 10MB (Chrome) / 5MB (Firefox), and requires only the `storage` permission. Thread history at ~50 entries per workspace is well within limits. Workspace-scoped keys (`threads_{workspaceId}`) satisfy FR-007. No `storage.sync` needed since data should remain device-local per FR-006.

**Alternatives considered**:
- IndexedDB: More powerful but unnecessary complexity for the data volume; harder to use from service workers.
- localStorage: Not available in service workers (MV3 background); not recommended for extensions.
- storage.sync: Would sync across devices, violating the local-only requirement (FR-006).

**Key patterns**:
- Settings stored under `settings` key with per-feature toggle booleans.
- Thread history stored under `threads_{workspaceId}` with array of ThreadEntry objects.
- Workspace ID extracted from Slack page URL or DOM.

## R5: Testing Strategy

**Decision**: Vitest for unit tests; manual testing in Chrome and Firefox for integration/E2E.

**Rationale**: Vitest is fast, supports ES modules natively, and integrates well with WXT's Vite-based build. Unit tests cover shared business logic (thread tracking, storage, settings). Browser extension E2E testing against a live Slack instance is impractical to automate (requires authentication, dynamic DOM), so manual testing against a checklist is more appropriate for this project's scope.

**Alternatives considered**:
- Jest: Slower, less native ESM support, but viable.
- Playwright for E2E: Would require Slack authentication fixtures and is fragile against Slack DOM changes; overkill for initial development.
- Cypress: Same authentication/DOM fragility issues as Playwright.

## R6: Content Script Lifecycle & SPA Navigation

**Decision**: Use `popstate`/`hashchange` listeners combined with periodic health checks to handle Slack's SPA navigation.

**Rationale**: Slack uses client-side routing that doesn't trigger full page reloads. Content scripts must detect route changes (e.g., switching channels, opening Threads page) to restart observers and re-inject UI. A combination of navigation event listeners and periodic container element checks (every 2-3 seconds) provides reliable detection without excessive overhead.

**Key patterns**:
- `popstate` and `hashchange` listeners for SPA route changes.
- Re-initialize MutationObserver when target container changes.
- Periodic health check (setInterval at ~3s) to catch edge cases where navigation events don't fire.
- Feature-specific detection: check for Threads page container to activate US4 features.
