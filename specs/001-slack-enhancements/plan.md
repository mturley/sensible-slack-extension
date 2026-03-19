# Implementation Plan: Slack Web Interface Enhancements

**Branch**: `001-slack-enhancements` | **Date**: 2026-03-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-slack-enhancements/spec.md`

## Summary

A cross-browser extension (Chrome MV3 + Firefox) that enhances the Slack web interface with four feature groups: redirect prevention to keep users in the web app, quick message action buttons (copy link, open thread in new tab), recent threads tracking with persistent history, and manual thread read control on the Threads page. Built with WXT framework and TypeScript, using content scripts for DOM injection and `browser.storage.local` for persistence.

## Technical Context

**Language/Version**: TypeScript (strict mode), targeting ES2020+
**Framework**: WXT (Web Extension Tools) — handles cross-browser manifest generation, HMR, and build
**Primary Dependencies**: WXT, webextension-polyfill (via WXT)
**Storage**: `browser.storage.local` for settings and thread history (no external database)
**Testing**: Vitest for unit tests; manual browser testing for integration/E2E
**Target Platform**: Chrome (Manifest V3) and Firefox (WebExtensions) browsers
**Project Type**: Browser extension
**Performance Goals**: Button injection < 200ms after message render; redirect interception before page navigation completes; < 5MB storage usage
**Constraints**: No external network requests (FR-006); no eval/inline scripts (constitution); minimal permissions (constitution); graceful degradation on DOM changes (FR-013)
**Scale/Scope**: Single-user local extension; ~50 thread entries per workspace; 4 feature modules + popup UI

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Permissions | PASS | Only `storage` and `host_permissions` for `*.slack.com`. `declarativeNetRequest` for redirect blocking. Each permission justified. |
| II. User Privacy | PASS | All data stored locally via `browser.storage.local`. No analytics, telemetry, or external requests (FR-006). |
| III. Non-Intrusive Enhancements | PASS | Additive buttons in existing action bars. Graceful degradation via selector fallback chains. No modification of messages in transit. |
| IV. Simplicity & Maintainability | PASS | Single project, 4 feature modules, no framework beyond WXT. Plain HTML/CSS popup (no React). Minimal dependencies. |
| V. Cross-Browser Compatibility | PASS | WXT generates per-browser manifests. webextension-polyfill normalizes APIs. Both Chrome and Firefox targeted from start. |

**Post-design re-check**: All principles remain satisfied. No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-slack-enhancements/
├── plan.md              # This file
├── research.md          # Phase 0: technical research and decisions
├── data-model.md        # Phase 1: entity definitions and storage schema
├── quickstart.md        # Phase 1: setup and testing guide
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── entrypoints/
│   ├── background.ts          # Service worker: settings management, message routing
│   ├── content.ts             # Content script: feature module orchestration
│   └── popup/                 # Extension popup UI
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── modules/
│   ├── redirect-prevention.ts # US1: Intercept desktop app redirects
│   ├── message-actions.ts     # US2: Inject copy-link and open-thread buttons
│   ├── recent-threads.ts      # US3: Track and display recently viewed threads
│   └── manual-read-control.ts # US4: Block auto mark-as-read on Threads page
├── shared/
│   ├── storage.ts             # Typed wrapper around browser.storage.local
│   ├── settings.ts            # ExtensionSettings read/write/subscribe
│   ├── dom-utils.ts           # Resilient selector chains and DOM helpers
│   ├── workspace.ts           # Workspace ID detection from URL/DOM
│   └── constants.ts           # Shared constants (limits, selectors, keys)
├── types/
│   └── index.ts               # Shared TypeScript type definitions
└── assets/
    └── icons/                 # Extension icons (16, 32, 48, 128px)

tests/
└── unit/
    ├── storage.test.ts
    ├── settings.test.ts
    ├── recent-threads.test.ts
    └── workspace.test.ts
```

**Structure Decision**: Single-project WXT extension layout. The `entrypoints/` directory follows WXT conventions for automatic entry point detection. Feature logic is isolated in `modules/` with shared utilities in `shared/`. Tests cover business logic only (storage, settings, thread tracking); DOM injection is validated through manual browser testing.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
