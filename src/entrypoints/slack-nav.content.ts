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

    let probeSeq = 0;

    function getWebpackRequire(): WebpackRequire {
      if (wr) return wr;
      // Slack migrated its bundler webpack -> rspack, which renamed the chunk
      // global from `webpackChunkwebapp` to `rspackChunkwebapp`. Accept any
      // `*Chunk*` global that yields a require with a module map, so this keeps
      // working across that (and future) bundler renames.
      const chunkGlobals = Object.keys(window).filter((k) => /Chunk/i.test(k));
      for (const key of chunkGlobals) {
        let captured: WebpackRequire | null = null;
        try {
          // Unique chunk id per attempt: a bundler ignores the runtime callback
          // for an already-installed chunk id, so a fixed id fails on retry.
          (window as any)[key].push([
            [`__sensible_slack_probe_${++probeSeq}__`],
            {},
            function (require: WebpackRequire) {
              captured = require;
            },
          ]);
        } catch (_e) {
          // probe chunk may throw after giving us require
        }
        if (captured && (captured as WebpackRequire).m) {
          wr = captured;
          return wr;
        }
      }
      throw new Error('Failed to obtain __webpack_require__ (no *Chunk* global)');
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

    // Resolve a module id as it appears in minified source — webpack hex
    // (`0x2a3`), decimal, or an rspack quoted string id (`"k2p9"`) — to the key
    // the bundler actually registers in `r.m`.
    function resolveModuleId(r: WebpackRequire, raw: string): string | null {
      const candidates = [raw];
      if (/^0x[0-9a-f]+$/i.test(raw)) candidates.push(parseInt(raw, 16).toString());
      if (/^\d+$/.test(raw)) candidates.push(String(Number(raw)));
      for (const c of candidates) {
        if (Object.prototype.hasOwnProperty.call(r.m, c)) return c;
      }
      return null;
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

        // Find the navigate call pattern: DISP((0,VAR1.KEY1)((0,VAR2.KEY2)({...})))
        // This matches the nested call where navigate wraps the view constructor.
        // DISP is whatever the minifier named the dispatch param — don't assume `e`.
        const nestedMatch = src.match(
          /[\w$]+\(\(0,([\w$]+)\.([\w$]+)\)\(\(0,([\w$]+)\.([\w$]+)\)\(\{/,
        );
        if (!nestedMatch) continue;

        const navVar = nestedMatch[1];
        const navKey = nestedMatch[2];
        const viewVar = nestedMatch[3];
        const viewKey = nestedMatch[4];

        // Map local variables to their import module IDs. webpack minifies these
        // as hex (`i=a(0x2a3)`); rspack uses STRING ids (`i=a("k2p9")`). Accept
        // both (plus decimal), and don't assume the require alias is `a`.
        const importRe = (v: string) =>
          src.match(new RegExp(`[^\\w$]${v}\\s*=\\s*[\\w$]+\\(\\s*(["']?)([\\w$.-]+)\\1\\s*\\)`));
        const navImport = importRe(navVar);
        const viewImport = importRe(viewVar);
        if (!navImport || !viewImport) continue;

        const navModId = resolveModuleId(r, navImport[2]);
        const viewModId = resolveModuleId(r, viewImport[2]);
        if (!navModId || !viewModId) continue;

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
        replyTs: detail.replyTs || detail.threadTs,
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
