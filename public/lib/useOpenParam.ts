import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/**
 * Something opened on top of a page (a ticket's chat, a detail panel) that
 * the Back button should close, rather than leave the page altogether.
 *
 * Opening adds a history step (`?<key>=<id>`), so the browser's Back, a
 * phone's back gesture, and the page's own back arrows all return to the
 * list first. Switching from one open item to another replaces that step
 * instead of piling up more. The open id is also kept in local state so it
 * shows (and closes) instantly, which keeps the dialog animations intact.
 *
 * Returns [openId, open(id), close()].
 */
export function useOpenParam(key: string) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const inUrl = params.get(key);
  const [openId, setOpenId] = useState<string | null>(inUrl);
  // The history step is ours to pop only if we pushed it (not a shared link or a reload).
  const pushedKey = `st:open:${key}`;
  const pushed = (location.state as Record<string, unknown> | null)?.[pushedKey] === true;

  // Back / forward (or any URL change) decide what's open.
  useEffect(() => { setOpenId(inUrl); }, [inUrl]);

  const open = useCallback((id: string) => {
    setOpenId(id);
    const next = new URLSearchParams(params);
    next.set(key, id);
    // No page-change animation for these steps: the item has its own.
    if (inUrl) setParams(next, { replace: true, state: location.state, viewTransition: false });
    else setParams(next, { state: { ...((location.state as object) ?? {}), [pushedKey]: true }, viewTransition: false });
  }, [params, setParams, key, inUrl, location.state, pushedKey]);

  const close = useCallback(() => {
    setOpenId(null);
    if (!inUrl) return;
    if (pushed) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete(key);
      setParams(next, { replace: true, viewTransition: false });
    }
  }, [inUrl, pushed, navigate, params, setParams, key]);

  return [openId, open, close] as const;
}
