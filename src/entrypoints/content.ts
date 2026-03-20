import { getWorkspaceIdFromCurrentPage } from '../shared/workspace';
import { readSettings, onSettingsChange } from '../shared/settings';
import { SPA_HEALTH_CHECK_INTERVAL } from '../shared/constants';
import type { ExtensionSettings } from '../types';
import { initRedirectPrevention, destroyRedirectPrevention } from '../modules/redirect-prevention';
import { initMessageActions, destroyMessageActions } from '../modules/message-actions';
import { initRecentThreads, destroyRecentThreads } from '../modules/recent-threads';
import { initManualReadControl, destroyManualReadControl } from '../modules/manual-read-control';

export default defineContentScript({
  matches: ['*://*.slack.com/*'],
  runAt: 'document_start',

  main() {
    let currentWorkspaceId: string | null = null;
    let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

    async function initialize() {
      currentWorkspaceId = getWorkspaceIdFromCurrentPage();
      if (!currentWorkspaceId) return;

      const settings = await readSettings();
      applyFeatures(settings, currentWorkspaceId);
    }

    function applyFeatures(settings: ExtensionSettings, workspaceId: string) {
      if (settings.redirectPrevention) {
        initRedirectPrevention();
      } else {
        destroyRedirectPrevention();
      }

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
      if (newWorkspaceId && newWorkspaceId !== currentWorkspaceId) {
        currentWorkspaceId = newWorkspaceId;
        readSettings().then((settings) => {
          applyFeatures(settings, currentWorkspaceId!);
        });
      }
    }

    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);

    // Periodic health check for SPA navigation edge cases
    healthCheckInterval = setInterval(onRouteChange, SPA_HEALTH_CHECK_INTERVAL);

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      initialize();
    }
  },
});
