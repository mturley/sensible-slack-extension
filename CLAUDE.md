# sensible-slack-extension Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-19

## Active Technologies

- TypeScript (strict mode), targeting ES2020+ + WXT, webextension-polyfill (via WXT) (001-slack-enhancements)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (strict mode), targeting ES2020+: Follow standard conventions

## Recent Changes

- 001-slack-enhancements: Added TypeScript (strict mode), targeting ES2020+ + WXT, webextension-polyfill (via WXT)

<!-- MANUAL ADDITIONS START -->

## Image Generation

When generating PNG images (e.g. icons), create an SVG first, then convert using `npx sharp-cli`:

```bash
npx --yes sharp-cli -i input.svg -o output.png resize <width> <height>
```

Do not use Puppeteer or `qlmanage` for image conversion — they are too slow or produce incorrect output.

<!-- MANUAL ADDITIONS END -->
