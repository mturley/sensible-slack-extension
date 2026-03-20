export default defineBackground(() => {
  // Track which tabs have read-control blocking enabled
  const blockedTabs = new Set<number>();

  // Store captured tokens and request URLs per tab for replaying mark-as-read
  const tabTokens = new Map<number, { token: string; url: string }>();
  // Store the latest ts value per channel/thread for each tab
  const tabThreadTs = new Map<number, Map<string, string>>();

  // Block subscriptions.thread.mark requests that mark threads as read
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!blockedTabs.has(details.tabId)) return {};

      // Allow our own intentional mark-as-read requests through
      if (details.url.includes('_se_allow=1')) return {};

      // Parse the request body to check if this is a read=1 (mark-as-read) call
      const formData = details.requestBody?.formData;
      if (formData?.read?.[0] === '1') {
        const channel = formData.channel?.[0];
        const threadTs = formData.thread_ts?.[0];
        const token = formData.token?.[0];
        const ts = formData.ts?.[0];

        // Capture token from the first blocked request so we can replay later
        if (token && !tabTokens.has(details.tabId)) {
          tabTokens.set(details.tabId, { token, url: details.url });
        }

        // Store the ts value for this specific thread
        if (channel && threadTs && ts) {
          if (!tabThreadTs.has(details.tabId)) {
            tabThreadTs.set(details.tabId, new Map());
          }
          tabThreadTs.get(details.tabId)!.set(`${channel}-${threadTs}`, ts);
        }

        if (channel && threadTs) {
          // Notify the content script that a call was blocked
          browser.tabs.sendMessage(details.tabId, {
            type: 'THREAD_MARK_BLOCKED',
            channel,
            threadTs,
          }).catch(() => {
            // Tab may have closed
          });
        }
        return { cancel: true };
      }

      return {};
    },
    {
      urls: ['*://*.slack.com/api/subscriptions.thread.mark*'],
      types: ['xmlhttprequest'],
    },
    ['blocking', 'requestBody']
  );

  // Handle messages from content scripts and popup
  browser.runtime.onMessage.addListener(
    (message: { type: string; [key: string]: unknown }, sender, sendResponse) => {
      const tabId = sender.tab?.id;

      switch (message.type) {
        case 'ENABLE_READ_CONTROL': {
          if (tabId) blockedTabs.add(tabId);
          break;
        }
        case 'DISABLE_READ_CONTROL': {
          if (tabId) blockedTabs.delete(tabId);
          break;
        }
        case 'MARK_THREAD_READ': {
          const tokenInfo = tabId ? tabTokens.get(tabId) : null;
          if (tokenInfo) {
            const ch = message.channel as string;
            const tTs = message.threadTs as string;
            const ts = tabId ? tabThreadTs.get(tabId)?.get(`${ch}-${tTs}`) : undefined;
            sendResponse({ token: tokenInfo.token, url: tokenInfo.url, ts: ts ?? tTs });
          } else {
            sendResponse({ error: 'no token captured yet' });
          }
          return true; // async response
        }
        case 'NAVIGATE_TO_THREAD': {
          const url = message.url as string;
          if (url) {
            browser.tabs.create({ url });
          }
          break;
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
    blockedTabs.delete(tabId);
    tabTokens.delete(tabId);
    tabThreadTs.delete(tabId);
  });
});
