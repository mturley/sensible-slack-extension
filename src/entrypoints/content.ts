import { getWorkspaceIdFromCurrentPage } from '../shared/workspace';
import { readSettings, onSettingsChange } from '../shared/settings';
import { SPA_HEALTH_CHECK_INTERVAL } from '../shared/constants';
import { waitForElement } from '../shared/dom-utils';
import type { ExtensionSettings } from '../types';
import { initMessageActions, destroyMessageActions } from '../modules/message-actions';
import { initRecentThreads, destroyRecentThreads } from '../modules/recent-threads';
import { initManualReadControl, destroyManualReadControl } from '../modules/manual-read-control';
import '../styles/content.css';

export default defineContentScript({
  matches: ['*://*.slack.com/*'],
  runAt: 'document_start',

  main() {
    let currentWorkspaceId: string | null = null;
    let featuresApplied = false;

    async function initialize() {
      currentWorkspaceId = getWorkspaceIdFromCurrentPage();
      if (!currentWorkspaceId) return;

      try {
        const settings = await readSettings();
        applyFeatures(settings, currentWorkspaceId);
        featuresApplied = true;
      } catch {
        // Storage may not be ready; onRouteChange will retry
      }
    }

    function applyFeatures(settings: ExtensionSettings, workspaceId: string) {
      if (settings.quickMessageActions) {
        initMessageActions(workspaceId);
      } else {
        destroyMessageActions();
      }

      if (settings.recentThreads) {
        initRecentThreads(workspaceId);
      } else {
        destroyRecentThreads();
      }

      if (settings.manualThreadReadControl) {
        initManualReadControl();
      } else {
        destroyManualReadControl();
      }
    }

    // Listen for settings changes
    onSettingsChange((newSettings) => {
      if (currentWorkspaceId) {
        applyFeatures(newSettings, currentWorkspaceId);
      }
    });

    // SPA navigation detection
    function onRouteChange() {
      const newWorkspaceId = getWorkspaceIdFromCurrentPage();
      if (newWorkspaceId && (newWorkspaceId !== currentWorkspaceId || !featuresApplied)) {
        currentWorkspaceId = newWorkspaceId;
        readSettings().then((settings) => {
          applyFeatures(settings, currentWorkspaceId!);
          featuresApplied = true;
        }).catch(() => {
          // Will retry on next interval
        });
      }
    }

    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);

    // Periodic health check for SPA navigation edge cases
    setInterval(onRouteChange, SPA_HEALTH_CHECK_INTERVAL);

    // Auto-open thread if URL has #se-open-thread marker
    async function checkOpenThreadMarker() {
      if (!window.location.hash.includes('se-open-thread')) return;

      // Clean up the hash
      history.replaceState(null, '', window.location.href.replace('#se-open-thread', ''));

      // Extract message timestamp from the permalink URL
      // Format: /archives/CHANNEL/pTIMESTAMP (e.g. p1234567890123456)
      const tsMatch = window.location.pathname.match(/\/p(\d+)/);
      if (!tsMatch) return;

      // Convert to Slack's data-ts format: "1234567890.123456"
      const rawTs = tsMatch[1];
      const dataTs = rawTs.length > 6
        ? `${rawTs.slice(0, -6)}.${rawTs.slice(-6)}`
        : rawTs;

      // Wait for the target message to render (retry for up to 10s)
      let targetMsg: Element | null = null;
      const deadline = Date.now() + 10000;
      while (!targetMsg && Date.now() < deadline) {
        targetMsg = document.querySelector(`[data-ts="${dataTs}"]`);
        if (!targetMsg) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!targetMsg) return;

      // Hover the message to trigger action bar, then click reply
      targetMsg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      targetMsg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));

      const replySelectors = [
        '[data-qa="reply_in_thread"]',
        'button[aria-label="Reply in thread"]',
        'button[aria-label="Reply to thread"]',
        '[class*="c-message__reply_bar"]',
      ];

      // Look within the message and its siblings (action bar may be adjacent)
      const searchRoot = targetMsg.parentElement ?? targetMsg;
      for (const selector of replySelectors) {
        try {
          const btn = searchRoot.querySelector(selector);
          if (btn instanceof HTMLElement) {
            btn.click();
            return;
          }
        } catch {
          // try next
        }
      }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initialize();
        checkOpenThreadMarker();
      });
    } else {
      initialize();
      checkOpenThreadMarker();
    }
  },
});
