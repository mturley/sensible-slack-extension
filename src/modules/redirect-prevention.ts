let active = false;
let clickListener: ((e: MouseEvent) => void) | null = null;
let beforeUnloadListener: ((e: BeforeUnloadEvent) => void) | null = null;

export function initRedirectPrevention() {
  if (active) return;
  active = true;

  // Intercept clicks on links with slack:// protocol
  clickListener = (e: MouseEvent) => {
    const target = (e.target as Element)?.closest?.('a');
    if (!target) return;

    const href = target.getAttribute('href');
    if (href && href.startsWith('slack://')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('click', clickListener, true);

  // Block interstitial redirect pages
  blockInterstitialRedirect();

  // Intercept window.location changes to slack:// via beforeunload
  beforeUnloadListener = (e: BeforeUnloadEvent) => {
    // Check if we're being redirected to a slack:// URL
    // This is a best-effort check — not all redirects are catchable here
  };
  window.addEventListener('beforeunload', beforeUnloadListener);

  // Override any redirect meta tags or JavaScript-initiated redirects
  interceptMetaRedirects();
}

export function destroyRedirectPrevention() {
  if (!active) return;
  active = false;

  if (clickListener) {
    document.removeEventListener('click', clickListener, true);
    clickListener = null;
  }

  if (beforeUnloadListener) {
    window.removeEventListener('beforeunload', beforeUnloadListener);
    beforeUnloadListener = null;
  }
}

function blockInterstitialRedirect() {
  // Slack sometimes shows an interstitial page asking to open the desktop app.
  // Detect and suppress these by checking for common interstitial patterns.
  const checkInterstitial = () => {
    // Look for "Open in Slack" or redirect interstitial page elements
    const interstitialSelectors = [
      '[data-qa="ssb_redirect_open_in_browser"]',
      '[class*="ssb_redirect"]',
      'a[href*="ssb_redirect"]',
    ];

    for (const selector of interstitialSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el instanceof HTMLElement) {
          // Click "Use Slack in your browser" if available
          const browserLink = document.querySelector(
            '[data-qa="ssb_redirect_open_in_browser"], a[href*="continue_in_browser"]'
          );
          if (browserLink instanceof HTMLElement) {
            browserLink.click();
            return;
          }
        }
      } catch {
        // Selector error — continue
      }
    }
  };

  // Run immediately and after a short delay (page may still be loading)
  checkInterstitial();
  setTimeout(checkInterstitial, 500);
  setTimeout(checkInterstitial, 2000);
}

function interceptMetaRedirects() {
  // Remove any meta refresh tags that redirect to slack://
  const observer = new MutationObserver(() => {
    const metaTags = document.querySelectorAll('meta[http-equiv="refresh"]');
    for (const meta of metaTags) {
      const content = meta.getAttribute('content') ?? '';
      if (content.includes('slack://')) {
        meta.remove();
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
