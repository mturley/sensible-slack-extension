export default defineContentScript({
  matches: ['*://*.slack.com/*'],
  runAt: 'document_idle',
  world: 'MAIN',

  main() {
    type WebpackRequire = ((id: string) => any) & { m: Record<string, Function> };

    let wr: WebpackRequire | null = null;
    let wsStore: any = null;
    let navigateFn: ((view: any) => any) | null = null;
    let threadViewFn: ((opts: any) => any) | null = null;

    function getWebpackRequire(): WebpackRequire {
      if (wr) return wr;
      let captured: WebpackRequire | null = null;
      try {
        (window as any).webpackChunkwebapp.push([
          ['__sensible_slack_probe__'],
          {},
          function (require: WebpackRequire) {
            captured = require;
          },
        ]);
      } catch (_e) {
        // probe chunk may throw after giving us require
      }
      if (!captured) throw new Error('Failed to obtain __webpack_require__');
      wr = captured;
      return wr;
    }

    function getWorkspaceStore() {
      if (wsStore) {
        try {
          wsStore.getState();
          return wsStore;
        } catch (_e) {
          wsStore = null;
        }
      }

      const container = document.querySelector('.p-client_container');
      if (!container) throw new Error('Slack client container not found');

      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'),
      );
      if (!fiberKey) throw new Error('React fiber not found');

      let fiber = (container as any)[fiberKey];
      let depth = 0;
      while (fiber && depth < 100) {
        if (fiber.memoizedProps?.store) {
          const stateKeys = Object.keys(fiber.memoizedProps.store.getState?.() || {});
          if (stateKeys.includes('bootData')) {
            wsStore = fiber.memoizedProps.store;
            return wsStore;
          }
        }
        fiber = fiber.child;
        depth++;
      }
      throw new Error('Workspace store not found');
    }

    // Find the navigate function and thread view constructor by tracing imports
    // from the "Opens the threads flexpane" thunk, which directly imports both.
    // This thunk's source contains calls like:
    //   e((0,r.o)((0,i.UX)({channelId:a, threadTs:o})))
    // where r.o is the navigate function and i.UX is the thread view constructor.
    function discoverNavFunctions() {
      if (navigateFn && threadViewFn) return;

      const r = getWebpackRequire();
      const desc = 'Opens the threads flexpane';

      for (const id of Object.keys(r.m)) {
        const src = r.m[id].toString();
        if (!src.includes(desc)) continue;

        // Find the navigate call pattern: e((0,VAR1.KEY1)((0,VAR2.KEY2)({...})))
        // This matches the nested call where navigate wraps the view constructor
        const nestedMatch = src.match(
          /e\(\(0,(\w+)\.(\w+)\)\(\(0,(\w+)\.(\w+)\)\(\{/,
        );
        if (!nestedMatch) continue;

        const navVar = nestedMatch[1];
        const navKey = nestedMatch[2];
        const viewVar = nestedMatch[3];
        const viewKey = nestedMatch[4];

        // Map local variables to their import hex IDs
        const navImport = src.match(new RegExp(`(?:^|,)${navVar}=a\\((0x[0-9a-f]+)\\)`));
        const viewImport = src.match(new RegExp(`(?:^|,)${viewVar}=a\\((0x[0-9a-f]+)\\)`));
        if (!navImport || !viewImport) continue;

        const navModId = parseInt(navImport[1], 16).toString();
        const viewModId = parseInt(viewImport[1], 16).toString();

        try {
          const navMod = r(navModId);
          const viewMod = r(viewModId);
          if (typeof navMod?.[navKey] === 'function' && typeof viewMod?.[viewKey] === 'function') {
            navigateFn = navMod[navKey];
            threadViewFn = viewMod[viewKey];
            return;
          }
        } catch (_e) { /* continue searching */ }
      }
      throw new Error('Navigate/view functions not found');
    }

    function handleOpenThread(detail: any) {
      discoverNavFunctions();
      if (!navigateFn || !threadViewFn) throw new Error('Navigation functions not available');
      const store = getWorkspaceStore();
      if (!store) throw new Error('Workspace store not available');

      const threadView = threadViewFn({
        channelId: detail.channelId,
        threadTs: detail.threadTs,
        replyTs: detail.replyTs,
        highlightRoot: detail.highlightRoot ?? true,
      });

      store.dispatch(navigateFn(threadView));
    }

    function handleJumpToMessage(detail: any) {
      discoverNavFunctions();
      if (!navigateFn || !threadViewFn) throw new Error('Navigation functions not available');
      const store = getWorkspaceStore();
      if (!store) throw new Error('Workspace store not available');

      const ts = detail.messageTs || detail.threadTs || detail.replyTs;
      if (!ts) throw new Error('messageTs, threadTs, or replyTs is required');

      const threadView = threadViewFn({
        channelId: detail.channelId,
        threadTs: ts,
        replyTs: ts,
        highlightRoot: true,
      });

      store.dispatch(navigateFn(threadView));
    }

    document.addEventListener('se-spa-nav-request', ((e: CustomEvent) => {
      let detail: any;
      try {
        detail = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      } catch (_e) {
        return;
      }
      const id = detail?.id;
      if (!id) return;

      try {
        if (detail.action === 'openThread') {
          handleOpenThread(detail);
        } else if (detail.action === 'jumpToMessage') {
          handleJumpToMessage(detail);
        } else {
          throw new Error(`Unknown action: ${detail.action}`);
        }
        document.dispatchEvent(new CustomEvent('se-spa-nav-result', {
          detail: JSON.stringify({ id, success: true }),
        }));
      } catch (err: any) {
        navigateFn = null;
        threadViewFn = null;
        wsStore = null;
        document.dispatchEvent(new CustomEvent('se-spa-nav-result', {
          detail: JSON.stringify({ id, success: false, error: err?.message || String(err) }),
        }));
      }
    }) as EventListener);
  },
});
