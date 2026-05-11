export default defineContentScript({
  matches: ['*://*.slack.com/*'],
  runAt: 'document_idle',
  world: 'MAIN',

  main() {
    type WebpackRequire = ((id: string) => any) & { m: Record<string, Function> };

    let wr: WebpackRequire | null = null;
    let wsStore: any = null;
    let viewMod: any = null;
    let navMod: any = null;
    let threadViewKey: string | null = null;
    let channelViewKey: string | null = null;
    let navigateKey: string | null = null;

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

    function getViewMod() {
      if (viewMod && threadViewKey && channelViewKey) return viewMod;

      const r = getWebpackRequire();
      const modules = r.m;
      for (const id of Object.keys(modules)) {
        const src = modules[id].toString();
        if (!src.includes('dangerouslyOverrideRouting') || !src.includes('highlightRoot')) continue;

        const mod = r(id);
        let tvKey: string | null = null;
        let cvKey: string | null = null;

        for (const key of Object.keys(mod)) {
          if (typeof mod[key] !== 'function') continue;
          try {
            const result = mod[key]({ channelId: '_test_', threadTs: '_test_' });
            if (result?.params?.dangerouslyOverrideRouting !== undefined) {
              tvKey = key;
            }
          } catch (_e) { /* continue */ }

          if (!cvKey) {
            try {
              const result = mod[key]('_test_', '_test_', '_test_');
              if (result?.viewType === 'Channel' && result?.params?.startTs) {
                cvKey = key;
              }
            } catch (_e) { /* continue */ }
          }
        }

        if (tvKey) {
          viewMod = mod;
          threadViewKey = tvKey;
          channelViewKey = cvKey;
          return viewMod;
        }
      }
      throw new Error('View constructor module not found');
    }

    function getNavMod() {
      if (navMod && navigateKey) return navMod;

      const r = getWebpackRequire();
      const modules = r.m;
      const desc = 'Handle navigation click from attachment footer';

      for (const id of Object.keys(modules)) {
        const src = modules[id].toString();
        if (!src.includes(desc)) continue;

        const importMatches = [...src.matchAll(/a\((0x[0-9a-f]+)\)/g)];
        for (const match of importMatches) {
          const hexId = parseInt(match[1], 16).toString();
          try {
            const candidate = r(hexId);
            if (!candidate) continue;
            for (const key of Object.keys(candidate)) {
              if (typeof candidate[key] !== 'function') continue;
              try {
                const result = candidate[key]({ id: '_test_', viewType: 'Channel' });
                if (typeof result === 'function') {
                  navMod = candidate;
                  navigateKey = key;
                  return navMod;
                }
              } catch (_e) { /* continue */ }
            }
          } catch (_e) { /* continue */ }
        }
      }
      throw new Error('Navigate module not found');
    }

    function handleOpenThread(detail: any) {
      const vm = getViewMod();
      const nm = getNavMod();
      const store = getWorkspaceStore();

      const threadView = vm[threadViewKey!]({
        channelId: detail.channelId,
        threadTs: detail.threadTs,
        replyTs: detail.replyTs,
        highlightRoot: detail.highlightRoot ?? true,
      });

      store.dispatch(nm[navigateKey!](threadView));
    }

    function handleJumpToMessage(detail: any) {
      const vm = getViewMod();
      const nm = getNavMod();
      const store = getWorkspaceStore();

      const ts = detail.messageTs || detail.threadTs || detail.replyTs;
      if (!ts) throw new Error('messageTs, threadTs, or replyTs is required');

      if (channelViewKey) {
        const channelView = vm[channelViewKey](detail.channelId, ts, ts);
        store.dispatch(nm[navigateKey!](channelView));
      } else {
        throw new Error('Channel view constructor not found');
      }
    }

    document.addEventListener('se-spa-nav-request', ((e: CustomEvent) => {
      const detail = e.detail;
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
          detail: { id, success: true },
        }));
      } catch (err: any) {
        viewMod = null;
        navMod = null;
        threadViewKey = null;
        channelViewKey = null;
        navigateKey = null;
        wsStore = null;
        document.dispatchEvent(new CustomEvent('se-spa-nav-result', {
          detail: { id, success: false, error: err?.message || String(err) },
        }));
      }
    }) as EventListener);
  },
});
