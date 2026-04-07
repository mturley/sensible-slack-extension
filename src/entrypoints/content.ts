import { getWorkspaceIdFromCurrentPage } from '../shared/workspace';
import { readSettings, onSettingsChange } from '../shared/settings';
import { SPA_HEALTH_CHECK_INTERVAL } from '../shared/constants';
import type { ExtensionSettings } from '../types';
import { initMessageActions, destroyMessageActions } from '../modules/message-actions';
import { initManualReadControl, destroyManualReadControl } from '../modules/manual-read-control';
import { initLinkFormatter, destroyLinkFormatter } from '../modules/link-formatter';
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
        initMessageActions(workspaceId, settings);
      } else {
        destroyMessageActions();
      }

      if (settings.manualThreadReadControl) {
        initManualReadControl();
      } else {
        destroyManualReadControl();
      }

      if (settings.autoFormatLinks) {
        initLinkFormatter(settings);
      } else {
        destroyLinkFormatter();
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

    // Listen for OPEN_THREAD messages from the background script
    browser.runtime.onMessage.addListener((message: { type: string; ts?: string }) => {
      if (message.type === 'OPEN_THREAD' && message.ts) {
        openThreadByTs(message.ts);
      }
    });

    async function openThreadByTs(dataTs: string) {
      // Wait for the target message to render (retry for up to 15s)
      let targetMsg: Element | null = null;
      const deadline = Date.now() + 15000;
      while (!targetMsg && Date.now() < deadline) {
        targetMsg =
          document.querySelector(`[data-msg-ts="${dataTs}"]`) ??
          document.querySelector(`[data-ts="${dataTs}"]`);
        if (!targetMsg) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!targetMsg) return;

      // Try clicking the reply bar first (for messages with existing replies)
      for (const selector of ['[data-qa="reply_bar_count"]', '[data-qa="reply_bar_view_thread"]', '[data-qa="reply_bar"]']) {
        const btn = targetMsg.querySelector(selector);
        if (btn instanceof HTMLElement) {
          btn.click();
          return;
        }
      }

      // Otherwise, hover and click the thread button from the action bar
      const hoverTarget =
        targetMsg.querySelector('[class*="c-message_kit__hover"]') ?? targetMsg;
      hoverTarget.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      hoverTarget.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      const searchRoot = targetMsg.parentElement ?? targetMsg;
      const btnDeadline = Date.now() + 3000;
      while (Date.now() < btnDeadline) {
        for (const selector of ['[data-qa="start_thread"]', '[data-qa="reply_in_thread"]', 'button[aria-label="Reply in thread"]', 'button[aria-label="View thread"]']) {
          const btn = searchRoot.querySelector(selector);
          if (btn instanceof HTMLElement) {
            btn.click();
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      initialize();
    }
  },
});
