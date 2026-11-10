import { flushSync } from "react-dom";

/**
 * Animates an in-page switch (a tab change, a dialog closing) with the
 * browser's View Transitions: the screen is snapshotted, `update` runs, and
 * index.css animates from the old picture to the new one.
 *
 * Page-to-page navigation is animated separately (see main.tsx). The `kind`
 * is set on <html data-vt> for the transition's lifetime so the CSS can give
 * each kind its own motion. Browsers without support, and people who ask
 * for reduced motion, simply get the instant update.
 */
export type SwitchKind = "tab" | "modal";

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function animateSwitch(kind: SwitchKind, update: () => void, cleanup?: () => void) {
  const doc = document as VTDocument;
  const root = document.documentElement;
  // One at a time: a switch fired mid-animation just applies straight away.
  if (!doc.startViewTransition || reduceMotion() || root.dataset.vt) {
    update();
    cleanup?.();
    return;
  }
  root.dataset.vt = kind;
  const t = doc.startViewTransition(() => flushSync(update));
  t.finished.finally(() => {
    delete root.dataset.vt;
    cleanup?.();
  });
}
