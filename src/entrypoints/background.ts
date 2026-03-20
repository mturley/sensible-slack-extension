export default defineBackground(() => {
  // Capture API tokens by observing any Slack API request (non-blocking)
  const tabTokens = new Map<number, { token: string; url: string }>();

  browser.webRequest.onBeforeRequest.addListener(
    (details): undefined => {
      if (tabTokens.has(details.tabId)) return;

      const formData = details.requestBody?.formData;
      const token = formData?.token?.[0];
      if (typeof token === 'string') {
        tabTokens.set(details.tabId, {
          token,
          url: details.url.replace(/\/api\/.*$/, '/api/subscriptions.thread.mark'),
        });
      }
    },
    {
      urls: ['*://*.slack.com/api/*'],
      types: ['xmlhttprequest'],
    },
    ['requestBody']
  );

  // Handle messages from content scripts
  browser.runtime.onMessage.addListener(
    (message: { type: string; [key: string]: unknown }, sender, sendResponse) => {
      const tabId = sender.tab?.id;

      switch (message.type) {
        case 'GET_TOKEN': {
          const tokenInfo = tabId ? tabTokens.get(tabId) : null;
          if (tokenInfo) {
            sendResponse({ token: tokenInfo.token, url: tokenInfo.url });
          } else {
            sendResponse({ error: 'no token captured yet' });
          }
          return true;
        }
        case 'SET_BADGE_DEGRADED': {
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
          if (tabId) {
            browser.action.setBadgeText({ text: '', tabId });
          }
          break;
        }
      }
      return false;
    }
  );

  // Clean up when tabs are closed
  browser.tabs.onRemoved.addListener((tabId) => {
    tabTokens.delete(tabId);
  });
});
