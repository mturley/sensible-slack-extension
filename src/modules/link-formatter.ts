import type { ExtensionSettings } from '../types';
import { GITHUB_PR_ISSUE_URL_PATTERN, JIRA_ISSUE_URL_PATTERN } from '../shared/constants';

let currentSettings: ExtensionSettings | null = null;

function handlePaste(event: Event) {
  if (!currentSettings) return;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  // Find the closest texty_input editor (works for both compose and edit)
  const editor = target.closest('[data-qa="texty_input"]') ?? (
    target.matches('[data-qa="texty_input"]') ? target : null
  );
  if (!editor) return;

  // Snapshot existing links before paste is applied
  const existingLinks = new Set(editor.querySelectorAll('a'));

  requestAnimationFrame(() => {
    const allLinks = editor.querySelectorAll('a');
    for (const link of allLinks) {
      if (existingLinks.has(link)) continue;

      const href = link.getAttribute('href');
      if (!href) continue;

      // Only modify raw URLs (text matches href), not user-customized link text
      if (link.textContent?.trim() !== href.trim()) continue;

      const formatted = formatUrl(href);
      if (formatted) {
        link.textContent = formatted;

        // Place cursor after the link so the user can keep typing
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.setStartAfter(link);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
  });
}

function formatUrl(url: string): string | null {
  if (!currentSettings) return null;

  if (currentSettings.autoFormatGithubLinks) {
    const ghMatch = url.match(GITHUB_PR_ISSUE_URL_PATTERN);
    if (ghMatch) {
      return `${ghMatch[1]}#${ghMatch[2]}`;
    }
  }

  if (currentSettings.autoFormatJiraLinks) {
    const jiraMatch = url.match(JIRA_ISSUE_URL_PATTERN);
    if (jiraMatch) {
      return jiraMatch[1];
    }
  }

  return null;
}

export function initLinkFormatter(settings: ExtensionSettings): void {
  currentSettings = settings;
  document.addEventListener('paste', handlePaste, { capture: true });
}

export function destroyLinkFormatter(): void {
  currentSettings = null;
  document.removeEventListener('paste', handlePaste, { capture: true });
}
