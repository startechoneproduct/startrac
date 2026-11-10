import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TourStep = {
  /** A `data-tour="<target>"` element to spotlight, or "center" for an intro/outro card with no target. */
  target: string;
  title: string;
  body: string;
  /** Which side of the target the tooltip sits on. Ignored for "center". */
  placement?: "top" | "bottom" | "left" | "right";
};

const TOOLTIP_WIDTH = 316;

/** Window event that opens (detail: true) or closes the phone sidebar drawer. */
export const SIDEBAR_EVENT = "st:sidebar";
// Below lg the sidebar is a slide-in drawer, and the tour must open it to
// point at anything inside it.
const isDrawerLayout = () => window.innerWidth < 1024;
const setDrawer = (open: boolean) => window.dispatchEvent(new CustomEvent(SIDEBAR_EVENT, { detail: open }));
const DRAWER_SLIDE_MS = 340; // a touch longer than the drawer's own slide
/** The card's width: its usual size, or the screen less a margin on a phone. */
const cardWidth = () => Math.min(TOOLTIP_WIDTH, window.innerWidth - MARGIN * 2);
const GAP = 14;
const MARGIN = 12;
const PAD = 8; // spotlight padding around the target's own box

function place(rect: DOMRect, placement: TourStep["placement"], height: number) {
  const width = cardWidth();
  // Narrow screens: there's no room beside anything, so the card goes below
  // the target, or above it, or failing both, along the bottom of the screen.
  if (window.innerWidth < 640) {
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const top = below + height <= window.innerHeight - MARGIN ? below
      : above >= MARGIN ? above
      : window.innerHeight - height - MARGIN;
    return { top, left: (window.innerWidth - width) / 2 };
  }
  let top: number, left: number;
  switch (placement) {
    case "left":
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.left - GAP - TOOLTIP_WIDTH;
      break;
    case "top":
      top = rect.top - GAP - height;
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      break;
    case "right":
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.right + GAP;
      break;
    default: // bottom
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  }
  top = Math.min(Math.max(top, MARGIN), window.innerHeight - height - MARGIN);
  left = Math.min(Math.max(left, MARGIN), window.innerWidth - width - MARGIN);
  return { top, left };
}

/**
 * A small, self-contained "walk me around" overlay: a spotlight cut out of a
 * dimmed backdrop around one real element at a time (found by its
 * `data-tour` attribute), with a tooltip explaining it and Back/Next/Skip.
 *
 * Deliberately not a library — the whole thing is ~150 lines because it only
 * ever needs to do one thing: point at something already on screen. If a
 * step's target isn't there (a permission hides it, the layout differs, the
 * user navigated away mid-tour), that step is skipped rather than breaking
 * the tour — see the retry-then-skip logic below.
 */
export function ProductTour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(170);

  const step = steps[index];
  const isCenter = !step || step.target === "center";

  // Reset to the first step every time the tour is (re)opened, and on a
  // phone, put the drawer away again once it ends.
  useEffect(() => {
    if (open) setIndex(0);
    else if (isDrawerLayout()) setDrawer(false);
  }, [open]);

  // Locate the current step's target, scrolling it into view first. Retries
  // briefly (data can still be loading in), then gives up and moves on.
  useEffect(() => {
    if (!open || !step) return;
    let cancelled = false;
    setReady(false);
    setRect(null);

    if (step.target === "center") {
      if (isDrawerLayout()) setDrawer(false);
      setReady(true);
      return;
    }

    let attempts = 0;
    const tryFind = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      // Present but hidden at this screen size (display:none) is as good as missing.
      if (el && el.getClientRects().length > 0) {
        // On a phone, sidebar items live in the drawer: open it and let it
        // slide in before measuring. Anything else: make sure it's shut.
        const inDrawer = isDrawerLayout() && !!el.closest("aside");
        if (isDrawerLayout()) setDrawer(inDrawer);
        const measure = () => {
          if (cancelled) return;
          el.scrollIntoView({ block: "center", behavior: inDrawer ? "auto" : "smooth" });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (cancelled) return;
              setRect(el.getBoundingClientRect());
              setReady(true);
            })
          );
        };
        if (inDrawer) setTimeout(measure, DRAWER_SLIDE_MS); else measure();
      } else if (el) {
        // Exists but hidden at this screen size (e.g. the search box on a
        // phone): it isn't going to appear, so move on without the wait.
        attempts = Infinity;
        if (index < steps.length - 1) setIndex((i) => i + 1);
        else onClose();
      } else if (attempts++ < 10) {
        setTimeout(tryFind, 150);
      } else if (!cancelled) {
        // This step's element genuinely isn't on screen — skip it rather
        // than leaving the tour stuck pointing at nothing.
        if (index < steps.length - 1) setIndex((i) => i + 1);
        else onClose();
      }
    };
    tryFind();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // Keep the spotlight glued to its target through resizes/scrolling.
  useEffect(() => {
    if (!open || !ready || isCenter) return;
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, ready, isCenter, step?.target]);

  // Measure the card's real height once it has content, for tighter placement.
  useEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [index, ready]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // `ready` alone isn't a safe guard: when `index` changes, this render
  // happens BEFORE the locate-target effect (below) has had a chance to run
  // and reset it — so a step transition from a "center" step (ready=true,
  // rect=null) into a real spotlighted one briefly renders with the NEW
  // step's isCenter=false but the OLD render's stale rect. Guard on rect
  // directly for non-center steps rather than trusting ready's timing.
  if (!open || !step || !ready || (!isCenter && !rect)) return null;

  const isLast = index === steps.length - 1;
  function next() { if (isLast) finish(); else setIndex((i) => i + 1); }
  function back() { setIndex((i) => Math.max(0, i - 1)); }
  function finish() { onClose(); }

  const tooltipPos = isCenter
    ? { top: window.innerHeight / 2 - cardHeight / 2, left: window.innerWidth / 2 - cardWidth() / 2 }
    : place(rect!, step.placement || "bottom", cardHeight);

  return createPortal(
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Dimmed backdrop with a spotlight cut around the target — the giant
          box-shadow trick, so no SVG mask or second overlay layer is needed. */}
      {isCenter ? (
        <div className="fixed inset-0 bg-black/50" />
      ) : (
        <div
          className="fixed rounded-xl ring-2 ring-primary transition-all duration-200 pointer-events-none"
          style={{
            top: rect!.top - PAD, left: rect!.left - PAD,
            width: rect!.width + PAD * 2, height: rect!.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
          }}
        />
      )}

      <div
        ref={cardRef}
        className="fixed pop border border-line-2 rounded-card shadow-e2 p-4 animate-fade-in"
        style={{ top: tooltipPos.top, left: tooltipPos.left, width: cardWidth() }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-primary" : "w-1.5 bg-surface-3")} />
            ))}
          </div>
          <button onClick={finish} aria-label="Close tour" className="text-t4 hover:text-t2 -mt-1 -mr-1 p-1 rounded-md hover:bg-surface-2 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-[13.5px] font-semibold text-t1 mb-1">{step.title}</div>
        <p className="text-[12.5px] text-t3 leading-relaxed mb-3.5">{step.body}</p>
        <div className="flex items-center justify-between">
          <button onClick={finish} className="text-[11.5px] font-semibold text-t4 hover:text-t2 transition-colors">
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button onClick={back} className="h-8 px-3 rounded-ctl border border-line-2 text-[12px] font-semibold text-t2 hover:bg-surface-2 transition-colors">
                Back
              </button>
            )}
            <button onClick={next} className="h-8 px-3.5 rounded-ctl bg-primary text-white text-[12px] font-semibold hover:bg-primary-hover transition-colors">
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Has this browser already dismissed a given (versioned) tour? */
export function tourSeen(key: string) {
  try { return localStorage.getItem(`startrack.tour.${key}`) === "1"; } catch { return true; }
}

export function markTourSeen(key: string) {
  try { localStorage.setItem(`startrack.tour.${key}`, "1"); } catch { /* private browsing etc. — just re-shows next time */ }
}
