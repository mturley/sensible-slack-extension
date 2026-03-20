# Slack Enhancements

A browser extension that adds quality-of-life improvements to the Slack web interface. Built with [WXT](https://wxt.dev/) for Chrome and Firefox.

## Features

### Quick Message Actions

Adds two new buttons to the message hover action bar:

- **Copy link** — Copies a permalink to the message to your clipboard in one click (instead of digging through the "More actions" menu).
- **Open thread in new tab** — Opens the message's thread in a new browser tab with the thread panel expanded.

### Recent Threads Tracking

Tracks threads you've opened and displays them in the extension popup, ordered by most recently viewed. Click any entry to navigate back to that thread. History is stored locally and scoped per workspace.

### Manual Thread Read Control *(planned)*

Prevents the Threads page from automatically marking threads as read when you scroll past them. Instead, a "Mark as read" button appears on each thread so you can dismiss them explicitly.

## Pairing with a Redirect Blocker

Slack's web client often tries to redirect you to the desktop app when you open a Slack link. This extension pairs well with a separate extension that blocks that redirect behavior:

- **Firefox**: [Slack Redirect](https://addons.mozilla.org/en-US/firefox/addon/slack-redirect/)
- **Chrome**: [Open Slack in browser, not app](https://chromewebstore.google.com/detail/open-slack-in-browser-not/jkgehijlkoolgcjifalbiicaomkngakb)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Chrome and/or Firefox

### Development

```bash
npm install

# Dev mode with hot reload
npm run dev          # Chrome
npm run dev:firefox  # Firefox
```

Then load the extension in your browser:

- **Chrome**: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", and select `.output/chrome-mv3`
- **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select the manifest.json in `.output/firefox-mv2`

### Build

```bash
npm run build          # All browsers
npm run build:chrome   # Chrome only
npm run build:firefox  # Firefox only
```

### Test

```bash
npm test
npm run test:watch
```
