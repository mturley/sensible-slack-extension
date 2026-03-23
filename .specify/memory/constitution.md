<!--
  Sync Impact Report
  ===================
  Version change: N/A (initial) -> 1.0.0
  Modified principles: N/A (initial population)
  Added sections:
    - Core Principles (5 principles)
    - Technology & Constraints
    - Development Workflow
    - Governance
  Removed sections: None
  Templates requiring updates:
    - plan-template.md: ✅ compatible (Constitution Check is generic)
    - spec-template.md: ✅ compatible (no principle-specific references)
    - tasks-template.md: ✅ compatible (no principle-specific references)
  Follow-up TODOs: None
-->

# Sensible Slack Extension Constitution

## Core Principles

### I. Minimal Permissions

The extension MUST request only the browser permissions strictly
necessary for its current functionality. Broad host permissions,
background persistence, and access to unrelated APIs are prohibited
unless a specific feature requires them and the rationale is
documented. Each permission MUST be justified in the manifest.

**Rationale**: Browser extensions operate in a trust-sensitive
environment. Over-requesting permissions erodes user trust and
increases attack surface.

### II. User Privacy

The extension MUST NOT collect, transmit, or store user data beyond
what is essential for its features to function. All data MUST remain
local to the user's browser unless the user explicitly opts in to
external communication. No analytics, telemetry, or tracking of any
kind without informed, affirmative consent.

**Rationale**: Users install productivity extensions expecting their
Slack data to remain private. Violating this expectation is a
non-negotiable trust boundary.

### III. Non-Intrusive Enhancements

The extension MUST enhance the existing Slack web UI without
disrupting the user's workflow. Enhancements MUST be additive, not
replacements. The extension MUST NOT break existing Slack
functionality, intercept or modify messages in transit, or inject
UI elements that obscure native controls. If Slack updates break an
enhancement, the extension MUST degrade gracefully rather than
error visibly.

**Rationale**: A broken or intrusive enhancement is worse than no
enhancement. Users must always be able to use Slack normally
regardless of the extension's state.

### IV. Simplicity & Maintainability

Prefer the simplest implementation that satisfies requirements.
Avoid premature abstractions, unnecessary dependencies, and
over-engineering. The codebase MUST remain small enough that any
single contributor can understand the entire project. New features
MUST justify their complexity relative to user value.

**Rationale**: Browser extension APIs evolve, Slack's DOM changes
without notice, and maintenance burden compounds. Simplicity is a
survival strategy.

### V. Cross-Browser Compatibility

The extension MUST target the WebExtensions API standard (Manifest
V3) and MUST work in Chrome and Firefox at minimum. Browser-specific
APIs are permitted only when wrapped behind a compatibility layer.
All features MUST be tested in each supported browser before release.

**Rationale**: Users should not be locked into a single browser.
Building on standards from the start avoids costly rewrites later.

## Technology & Constraints

- **Extension Standard**: WebExtensions API, Manifest V3
- **Supported Browsers**: Chrome, Firefox (minimum); Safari, Edge
  (stretch goals)
- **Language**: TypeScript (strict mode)
- **Build Tool**: To be determined during first feature planning
- **Content Security**: The extension MUST NOT use `eval()`,
  inline scripts, or remote code loading
- **Slack DOM Dependency**: Features that rely on Slack's DOM
  structure MUST use resilient selectors and document their
  assumptions so breakage is easy to diagnose

## Development Workflow

- All changes require a feature branch and code review before
  merging to `main`
- Commits MUST be signed off (`--signoff`)
- Manual testing in at least one supported browser is required
  before merging
- Releases follow semantic versioning (MAJOR.MINOR.PATCH)
- The extension MUST be installable from source (no mandatory
  web store dependency for development)

## Governance

This constitution is the authoritative guide for project decisions.
When a proposed change conflicts with a principle above, the
principle takes precedence unless the constitution is formally
amended first.

**Amendment process**:
1. Propose the change with rationale in a PR modifying this file
2. Document the version bump (MAJOR for principle removal/redefinition,
   MINOR for additions, PATCH for clarifications)
3. Update the version line below upon merge

**Compliance**: All PRs and code reviews SHOULD verify alignment
with these principles. Complexity or permission additions MUST
reference the relevant principle and justify the deviation.

**Version**: 1.0.0 | **Ratified**: 2026-03-19 | **Last Amended**: 2026-03-19
