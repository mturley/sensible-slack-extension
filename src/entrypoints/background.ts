export default defineBackground(() => {
  // Handle messages from content scripts and popup
  browser.runtime.onMessage.addListener(
    (message: { type: string; [key: string]: unknown }, _sender, sendResponse) => {
      switch (message.type) {
        case 'GET_THREADS': {
          // Forward to storage — handled by popup directly
          break;
        }
        case 'NAVIGATE_TO_THREAD': {
          const url = message.url as string;
          if (url) {
            browser.tabs.create({ url });
          }
          break;
        }
        case 'SET_BADGE_DEGRADED': {
          const tabId = message.tabId as number | undefined;
          if (tabId) {
            browser.action.setBadgeText({ text: '!', tabId });
            browser.action.setBadgeBackgroundColor({
              color: '#FF9800',
              tabId,
            });
          }
          break;
        }
        case 'CLEAR_BADGE': {
          const tabId = message.tabId as number | undefined;
          if (tabId) {
            browser.action.setBadgeText({ text: '', tabId });
          }
          break;
        }
      }
      // Return true for async response if needed
      return false;
    }
  );
});
