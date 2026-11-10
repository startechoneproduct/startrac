import { lazy, type ComponentType } from "react";

/**
 * Pages load on demand: each page (and the libraries only it uses: charts,
 * the barcode scanner, spreadsheet export…) is its own file, fetched the
 * first time it's opened. The app's first load stays small, which matters
 * most on a phone, and keeps every file inside the offline cache's size
 * limit.
 *
 * Once the app has settled, the remaining pages are fetched quietly in the
 * background (see prefetchPages), so moving around later is still instant
 * and the app keeps working offline.
 */
type Loader = () => Promise<Record<string, unknown>>;
const loaders: Loader[] = [];

// A deploy renames every file, so a tab left open from before can ask for
// one that no longer exists. Reload once to pick up the new version rather
// than showing a broken page; the flag stops a reload loop if it's offline.
const RELOAD_FLAG = "startrack.chunk-reload";

export function lazyPage<P = object>(load: Loader, name: string) {
  loaders.push(load);
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* storage blocked */ }
      return { default: mod[name] as ComponentType<P> };
    } catch (err) {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem(RELOAD_FLAG) === "1"; } catch { /* storage blocked */ }
      if (!reloaded) {
        try { sessionStorage.setItem(RELOAD_FLAG, "1"); } catch { /* storage blocked */ }
        window.location.reload();
        return new Promise<never>(() => {}); // the reload takes over
      }
      throw err;
    }
  });
}

/**
 * Fetch every page in the background, a few at a time, once the browser is
 * idle. Called by the signed-in shells only, so a visitor on the landing page
 * or a shop's storefront never downloads the back office. Runs once.
 */
let prefetched = false;
export function prefetchPages() {
  if (prefetched) return;
  prefetched = true;
  const idle = (cb: () => void) =>
    "requestIdleCallback" in window ? (window as any).requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500);
  // Respect a phone's data saver: then pages load only when opened.
  if ((navigator as any).connection?.saveData) return;
  idle(async () => {
    const queue = [...loaders];
    const worker = async () => { for (let l = queue.shift(); l; l = queue.shift()) await l().catch(() => {}); };
    await Promise.all([worker(), worker(), worker()]);
  });
}
