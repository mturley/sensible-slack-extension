export default defineContentScript({
  matches: ['*://*.slack.com/*'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      (this as any).__seUrl = typeof url === 'string' ? url : url.toString();
      return origOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      // Allow our own intentional mark-as-read requests through
      if ((this as any).__seAllow) {
        return origSend.call(this, body);
      }

      const url = (this as any).__seUrl as string | undefined;

      if (
        url?.includes('/api/subscriptions.thread.mark') &&
        document.documentElement.hasAttribute('data-se-block-thread-marks')
      ) {
        if (isReadOne(body)) {
          // Extract params and notify content script via DOM event
          const params = extractParams(body);
          document.dispatchEvent(new CustomEvent('se-thread-mark-intercepted', {
            detail: JSON.stringify({ ...params, url }),
          }));

          // Redirect to a blob URL returning fake success so Slack doesn't retry
          const blob = new Blob(['{"ok":true}'], { type: 'application/json' });
          const blobUrl = URL.createObjectURL(blob);
          this.addEventListener('loadend', () => URL.revokeObjectURL(blobUrl), { once: true });
          origOpen.call(this, 'GET', blobUrl, true);
          return origSend.call(this, null);
        }
      }

      return origSend.call(this, body);
    };

    // Listen for mark-as-read requests from the content script
    document.addEventListener('se-mark-thread-read', ((e: CustomEvent) => {
      try {
        const { token, url, channel, thread_ts, ts } = JSON.parse(e.detail);
        const xhr = new XMLHttpRequest();
        (xhr as any).__seAllow = true;
        xhr.open('POST', url);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.addEventListener('load', () => {
          document.dispatchEvent(new CustomEvent('se-mark-thread-read-result', {
            detail: xhr.responseText,
          }));
        });
        xhr.addEventListener('error', () => {
          document.dispatchEvent(new CustomEvent('se-mark-thread-read-result', {
            detail: '{"ok":false,"error":"network_error"}',
          }));
        });
        xhr.send(new URLSearchParams({ token, channel, thread_ts, ts, read: '1' }).toString());
      } catch {
        document.dispatchEvent(new CustomEvent('se-mark-thread-read-result', {
          detail: '{"ok":false,"error":"internal_error"}',
        }));
      }
    }) as EventListener);

    function isReadOne(body: Document | XMLHttpRequestBodyInit | null | undefined): boolean {
      if (!body) return false;
      if (typeof body === 'string') return new URLSearchParams(body).get('read') === '1';
      if (body instanceof URLSearchParams) return body.get('read') === '1';
      if (body instanceof FormData) return (body.get('read') as string) === '1';
      return false;
    }

    function extractParams(body: Document | XMLHttpRequestBodyInit | null | undefined): Record<string, string> {
      const params: Record<string, string> = {};
      if (!body) return params;

      if (typeof body === 'string') {
        for (const [k, v] of new URLSearchParams(body)) params[k] = v;
      } else if (body instanceof URLSearchParams) {
        for (const [k, v] of body) params[k] = v;
      } else if (body instanceof FormData) {
        for (const [k, v] of body) {
          if (typeof v === 'string') params[k] = v;
        }
      }
      return params;
    }
  },
});
