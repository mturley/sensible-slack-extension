export interface SpaNavRequest {
  id: string;
  action: 'openThread' | 'jumpToMessage';
  channelId: string;
  threadTs?: string;
  replyTs?: string;
  messageTs?: string;
  highlightRoot?: boolean;
}

export interface SpaNavResult {
  id: string;
  success: boolean;
  error?: string;
}

let requestCounter = 0;

export function requestSpaNav(
  opts: Omit<SpaNavRequest, 'id'>,
  timeoutMs = 5000,
): Promise<SpaNavResult> {
  return new Promise((resolve, reject) => {
    const id = `se-nav-${++requestCounter}-${Date.now()}`;
    let settled = false;

    const onResult = ((e: CustomEvent<SpaNavResult>) => {
      if (e.detail?.id !== id) return;
      settled = true;
      document.removeEventListener('se-spa-nav-result', onResult as EventListener);
      resolve(e.detail);
    }) as EventListener;

    document.addEventListener('se-spa-nav-result', onResult);

    document.dispatchEvent(
      new CustomEvent('se-spa-nav-request', {
        detail: { ...opts, id },
      }),
    );

    setTimeout(() => {
      if (settled) return;
      document.removeEventListener('se-spa-nav-result', onResult);
      reject(new Error('SPA navigation timed out'));
    }, timeoutMs);
  });
}

export function parseSlackThreadUrl(
  url: string,
): { channelId: string; threadTs?: string; replyTs?: string; messageTs?: string } | null {
  const match = url.match(
    /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?.*thread_ts=([\d.]+))?/,
  );
  if (!match) return null;

  const channelId = match[1];
  const ts = `${match[2]}.${match[3]}`;
  const threadTs = match[4];

  if (threadTs) {
    return { channelId, threadTs, replyTs: ts };
  }
  return { channelId, messageTs: ts, threadTs: ts };
}

export async function spaNavOrFallback(
  opts: Omit<SpaNavRequest, 'id'>,
  fallbackUrl: string,
): Promise<boolean> {
  try {
    const result = await requestSpaNav(opts);
    if (result.success) return true;
  } catch (_e) {
    // timed out or other error
  }
  window.location.href = fallbackUrl;
  return false;
}
