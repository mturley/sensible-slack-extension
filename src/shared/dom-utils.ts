/**
 * Try a chain of selectors and return the first match.
 * Each selector is wrapped in try-catch for resilience.
 */
export function querySelector(
  selectors: readonly string[],
  root: ParentNode = document
): Element | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // Invalid selector or DOM error — try next
    }
  }
  return null;
}

/**
 * Try a chain of selectors and return all matches from the first selector that returns results.
 */
export function querySelectorAll(
  selectors: readonly string[],
  root: ParentNode = document
): Element[] {
  for (const selector of selectors) {
    try {
      const els = root.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    } catch {
      // Invalid selector or DOM error — try next
    }
  }
  return [];
}

/**
 * Observe a container for changes and call the callback when mutations occur.
 * Returns a disconnect function.
 */
export function observeDOM(
  target: Node,
  callback: MutationCallback,
  options: MutationObserverInit = { childList: true, subtree: true }
): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(target, options);
  return () => observer.disconnect();
}

/**
 * Wait for an element matching the selector chain to appear in the DOM.
 */
export function waitForElement(
  selectors: readonly string[],
  timeout = 10000,
  root: ParentNode = document
): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = querySelector(selectors, root);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = querySelector(selectors, root);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(root as Node, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * Get text content from an element, trimmed and truncated.
 */
export function getTextContent(
  el: Element,
  maxLength?: number
): string {
  const text = (el.textContent ?? '').trim();
  if (maxLength && text.length > maxLength) {
    return text.slice(0, maxLength) + '…';
  }
  return text;
}
