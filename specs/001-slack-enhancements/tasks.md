# Tasks: Slack Web Interface Enhancements

**Input**: Design documents from `/specs/001-slack-enhancements/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested in spec. Unit tests included only for shared business logic (storage, settings, thread tracking) where they provide high value.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize WXT project, TypeScript configuration, and extension scaffolding

- [ ] T001 Initialize WXT project with TypeScript strict mode in project root (wxt.config.ts, package.json, tsconfig.json)
- [ ] T002 Create extension icon assets in src/assets/icons/ (16x16, 32x32, 48x48, 128x128 PNG placeholders)
- [ ] T003 Configure Vitest for unit testing in vitest.config.ts and add test scripts to package.json
- [ ] T004 Create .gitignore with Node.js, WXT output (.output/, .wxt/), and editor patterns

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Define shared TypeScript types (ExtensionSettings, ThreadEntry, StorageSchema) in src/types/index.ts
- [ ] T006 [P] Implement typed storage wrapper with get/set/remove operations in src/shared/storage.ts
- [ ] T007 [P] Implement settings manager with defaults (all toggles true), read, write, and onChange listener in src/shared/settings.ts
- [ ] T008 [P] Implement workspace ID detection from Slack URL patterns in src/shared/workspace.ts
- [ ] T009 [P] Implement resilient DOM selector utilities with fallback chains and try-catch isolation in src/shared/dom-utils.ts
- [ ] T010 [P] Define shared constants (storage keys, selector patterns, limits) in src/shared/constants.ts
- [ ] T011 Create content script entrypoint that detects workspace, reads settings, and conditionally initializes feature modules in src/entrypoints/content.ts
- [ ] T012 Create background service worker that handles message routing and settings change events in src/entrypoints/background.ts
- [ ] T013 Create popup HTML shell with 4 feature toggle switches and a recent threads container in src/entrypoints/popup/index.html, src/entrypoints/popup/main.ts, src/entrypoints/popup/style.css

**Checkpoint**: Foundation ready — extension loads in Chrome/Firefox with popup showing 4 toggles, content script injected on Slack pages

---

## Phase 3: User Story 1 - Prevent Desktop App Redirect (Priority: P1) MVP

**Goal**: Intercept Slack's desktop app redirect and keep users in the web interface

**Independent Test**: Click a Slack link from an external source and verify it opens in the Slack web interface instead of redirecting to the desktop app

### Implementation for User Story 1

- [ ] T014 [US1] Implement redirect prevention module with content script logic to intercept slack:// protocol navigations, block interstitial redirect pages, and listen for settings toggle changes in src/modules/redirect-prevention.ts
- [ ] T015 [US1] Add declarativeNetRequest rules for HTTP-level redirect blocking in src/entrypoints/background.ts (add rule registration) and create redirect-rules.json if WXT supports static rule files
- [ ] T016 [US1] Wire redirect prevention toggle in popup to settings and add visual feedback for toggle state in src/entrypoints/popup/main.ts
- [ ] T017 [US1] Integrate redirect prevention module into content script initialization (conditional on settings) in src/entrypoints/content.ts

**Checkpoint**: US1 complete — Slack links open in web interface; toggle in popup enables/disables the feature; works in Chrome and Firefox

---

## Phase 4: User Story 2 - Quick Message Actions (Priority: P2)

**Goal**: Add "Copy link" and "Open thread in new tab" buttons to the Slack message hover action bar

**Independent Test**: Hover over any message in a Slack channel, verify two new buttons appear, click each to confirm expected behavior

### Implementation for User Story 2

- [ ] T018 [US2] Implement message actions module with MutationObserver-based button injection, permalink extraction from message DOM, clipboard copy with "Copied!" tooltip, and open-thread-in-new-tab logic in src/modules/message-actions.ts
- [ ] T019 [US2] Add CSS styles for injected action buttons matching Slack's visual style in src/entrypoints/popup/style.css or as injected styles in the content script
- [ ] T020 [US2] Wire message actions toggle in popup to settings in src/entrypoints/popup/main.ts
- [ ] T021 [US2] Integrate message actions module into content script with SPA navigation awareness (re-inject on route change) in src/entrypoints/content.ts

**Checkpoint**: US2 complete — hover buttons appear on messages; "Copy link" copies permalink; "Open thread" opens new tab; graceful degradation if DOM changes

---

## Phase 5: User Story 3 - Recent Threads Tracking (Priority: P3)

**Goal**: Track viewed/replied threads and display them in a recent threads list in the extension popup

**Independent Test**: Open several threads in Slack, open the extension popup, verify recently viewed threads appear in the list, click one to navigate to it

### Implementation for User Story 3

- [ ] T022 [US3] Implement recent threads module with thread view detection (click-to-open and reply events via MutationObserver), ThreadEntry creation from DOM context, and storage of workspace-scoped thread history (max 50, LRU eviction) in src/modules/recent-threads.ts
- [ ] T023 [US3] Add recent threads list UI to the extension popup showing thread entries with channel name, author, message preview, and clickable navigation in src/entrypoints/popup/main.ts and src/entrypoints/popup/index.html
- [ ] T024 [US3] Add message passing between content script and popup for thread list retrieval and navigation commands in src/entrypoints/background.ts
- [ ] T025 [US3] Wire recent threads toggle in popup to settings and integrate module into content script initialization in src/entrypoints/content.ts

**Checkpoint**: US3 complete — threads tracked on view/reply; popup shows recent threads list; clicking navigates to thread; history scoped per workspace; oldest entries evicted at 50

---

## Phase 6: User Story 4 - Manual Thread Read Control (Priority: P4)

**Goal**: Prevent automatic mark-as-read on the Threads page; add explicit "Mark as read" buttons

**Independent Test**: Navigate to the Threads page with unread threads, scroll through them, verify they remain unread; click "Mark as read" on one thread and verify only that thread is dismissed

**Note**: If US4 proves infeasible during implementation (cannot reliably intercept mark-as-read signals), fall back to US5 — a "Recent Threads" view with unread counts (FR-011). Document the feasibility decision in research.md before switching.

### Implementation for User Story 4

- [ ] T026 [US4] Research and prototype mark-as-read signal interception on the Threads page: identify the DOM events, network requests, or IntersectionObserver callbacks that trigger Slack's auto-mark-as-read, and document findings in specs/001-slack-enhancements/research.md (append as R7)
- [ ] T027 [US4] Implement manual read control module with Threads page detection, auto-mark-as-read blocking, "Mark as read" button injection after last message in each thread, button state management (disabled after click, re-enabled on new messages) in src/modules/manual-read-control.ts
- [ ] T028 [US4] Wire manual read control toggle in popup to settings and integrate module into content script with Threads page route detection in src/entrypoints/content.ts
- [ ] T029 [US4] Handle edge case: if user leaves Threads page and returns, threads not explicitly marked as read must still show as unread in src/modules/manual-read-control.ts

**Checkpoint**: US4 complete — scrolling on Threads page does not auto-mark threads as read; "Mark as read" button works per-thread; feature scoped to Threads page only

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T030 [P] Add unit tests for storage wrapper in tests/unit/storage.test.ts
- [ ] T031 [P] Add unit tests for settings manager in tests/unit/settings.test.ts
- [ ] T032 [P] Add unit tests for recent threads logic (add, update, eviction, workspace scoping) in tests/unit/recent-threads.test.ts
- [ ] T033 [P] Add unit tests for workspace detection in tests/unit/workspace.test.ts
- [ ] T034 Verify extension loads and all features work in both Chrome and Firefox (manual cross-browser testing per quickstart.md)
- [ ] T035 Add graceful degradation badge indicator on extension icon when DOM injection fails in src/entrypoints/background.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories should proceed sequentially in priority order (P1 → P2 → P3 → P4)
  - US2-US4 build on DOM injection patterns established in US1/US2
- **Polish (Phase 7)**: Can begin after Foundational; some tasks parallelizable with user stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) — Independent of US1; establishes DOM injection patterns used by US3/US4
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) — Uses ThreadEntry storage from foundational; independent of US1/US2
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) — Independent of other stories; may fall back to US5 if infeasible

### Within Each User Story

- Module implementation before content script integration
- Content script integration before popup wiring
- Core implementation before edge case handling

### Parallel Opportunities

- T002, T003, T004 can run in parallel (Phase 1, after T001)
- T006, T007, T008, T009, T010 can run in parallel (Phase 2, after T005)
- T030, T031, T032, T033 can all run in parallel (Phase 7)
- US1-US4 are structurally independent but recommended sequential for pattern reuse

---

## Parallel Example: Phase 2 Foundational

```bash
# After T005 (types) completes, launch these in parallel:
Task: "Implement typed storage wrapper in src/shared/storage.ts"
Task: "Implement settings manager in src/shared/settings.ts"
Task: "Implement workspace ID detection in src/shared/workspace.ts"
Task: "Implement resilient DOM selector utilities in src/shared/dom-utils.ts"
Task: "Define shared constants in src/shared/constants.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (redirect prevention)
4. **STOP and VALIDATE**: Test US1 independently in Chrome and Firefox
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently → Quick actions available
4. Add User Story 3 → Test independently → Thread tracking active
5. Add User Story 4 → Test independently → Full feature set (or US5 fallback)
6. Polish phase → Unit tests, cross-browser validation, degradation handling

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- US5 is not a separate phase — it replaces US4 implementation if US4 proves infeasible
- All DOM injection must use selector fallback chains from dom-utils.ts
- All features must check their toggle state from settings before activating
