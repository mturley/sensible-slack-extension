# Quickstart: Slack Web Interface Enhancements

**Date**: 2026-03-19 | **Branch**: `001-slack-enhancements`

## Prerequisites

- Node.js 18+ and npm
- Chrome and/or Firefox browser for testing
- A Slack workspace accessible via web browser

## Setup

```bash
# Install dependencies
npm install

# Start development with hot reload (Chrome)
npm run dev

# Start development with hot reload (Firefox)
npm run dev:firefox
```

## Development Workflow

### Loading the Extension

**Chrome**:
1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `.output/chrome-mv3` directory

**Firefox**:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the manifest.json in the `.output/firefox-mv2` directory

With WXT's dev mode (`npm run dev`), changes are hot-reloaded automatically.

### Testing Features

**US1 - Redirect Prevention**:
1. Open the extension popup and verify the "Redirect Prevention" toggle is ON
2. Open a Slack link (e.g., bookmark a channel URL, then click it)
3. Verify it opens in the web interface without redirecting to the desktop app
4. Toggle OFF, repeat — verify default redirect behavior returns

**US2 - Quick Message Actions**:
1. Navigate to any Slack channel
2. Hover over a message — look for "Copy link" and "Open thread" buttons in the action bar
3. Click "Copy link" — paste elsewhere to verify the permalink was copied
4. Click "Open thread" — verify a new tab opens with the thread expanded

**US3 - Recent Threads**:
1. Open several threads by clicking on them
2. Open the extension popup — verify threads appear in the recent list
3. Click a thread in the list — verify navigation to that thread

**US4 - Manual Read Control**:
1. Navigate to the Threads page with unread threads
2. Scroll through — verify threads remain marked as unread
3. Click "Mark as read" on a thread — verify it dismisses

## Building for Production

```bash
# Build for all browsers
npm run build

# Build for specific browser
npm run build:chrome
npm run build:firefox
```

Output directories:
- Chrome: `.output/chrome-mv3/`
- Firefox: `.output/firefox-mv2/`

## Project Structure

```text
src/
├── entrypoints/
│   ├── background.ts          # Service worker / background script
│   ├── content.ts             # Content script injected into Slack pages
│   └── popup/                 # Extension popup UI
│       ├── index.html
│       ├── App.ts
│       └── style.css
├── modules/
│   ├── redirect-prevention.ts # US1: Redirect interception logic
│   ├── message-actions.ts     # US2: Button injection into action bars
│   ├── recent-threads.ts      # US3: Thread tracking and display
│   └── manual-read-control.ts # US4: Mark-as-read interception
├── shared/
│   ├── storage.ts             # Typed storage layer
│   ├── settings.ts            # Extension settings management
│   ├── dom-utils.ts           # Resilient DOM selectors and helpers
│   ├── workspace.ts           # Workspace detection utilities
│   └── constants.ts           # Shared constants
├── types/
│   └── index.ts               # TypeScript type definitions
└── assets/
    └── icons/                 # Extension icons (16, 32, 48, 128px)
```

## Running Tests

```bash
# Unit tests
npm test

# Unit tests with watch mode
npm run test:watch
```
