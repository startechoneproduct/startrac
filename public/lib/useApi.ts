import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const REFRESH = "st:refresh";

/**
 * Fetches every list and figure on screen again (the top bar's refresh
 * button). Quiet: what's showing stays put until the new data arrives, and
 * nothing typed into a form is lost. Resolves when all of it is back.
 */
export async function refreshAll(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent(REFRESH, { detail: pending }));
  await Promise.allSettled(pending);
}

/**
 * Tiny fetch-on-mount hook: data, loading, error, and a reload() for after
 * mutations. Re-fetches when the path changes (e.g. branch switch bumps a key),
 * and on refreshAll().
 */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string>("");
  const seq = useRef(0);

  const fetchIt = useCallback(async (quiet: boolean) => {
    if (!path) return;
    const mySeq = ++seq.current;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const result = await api<T>(path);
      if (mySeq === seq.current) setData(result);
    } catch (err: any) {
      if (mySeq === seq.current) setError(err.message || "Failed to load");
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [path, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => fetchIt(false), [fetchIt]);

  useEffect(() => {
    load();
  }, [load]);

  // The refresh button: fetch again in the background, keeping what's shown.
  useEffect(() => {
    const onRefresh = (e: Event) => { (e as CustomEvent<Promise<unknown>[]>).detail.push(fetchIt(true)); };
    window.addEventListener(REFRESH, onRefresh);
    return () => window.removeEventListener(REFRESH, onRefresh);
  }, [fetchIt]);

  return { data, loading, error, reload: load };
}
