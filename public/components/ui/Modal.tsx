import { useCallback, useEffect, useRef } from "react";
import { animateSwitch } from "@/lib/viewTransition";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Closing from inside the dialog (X, backdrop, Esc) animates it away rather
  // than having it vanish: the closing dialog is tagged so index.css can
  // fade and shrink just that one out over the page.
  const shell = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    const el = shell.current;
    el?.setAttribute("data-vt-closing", "");
    animateSwitch("modal", onClose, () => el?.removeAttribute("data-vt-closing"));
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", esc);
    // Stop the page behind scrolling under the dialog, and put the width back
    // afterwards so the layout doesn't jump as the scrollbar disappears.
    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [open, close]);

  if (!open) return null;

  /**
   * Rendered into <body> rather than in place.
   *
   * `position: fixed` is resolved against the nearest ancestor with a
   * transform, filter or backdrop-filter — not the viewport. The landing
   * page has both (a blurred sticky header, and fade-up animations that
   * leave a transform behind), which trapped this dialog inside a short
   * ancestor: it ran off the screen with its close button out of reach.
   * A portal sidesteps the whole class of bug for every modal in the app.
   */
  return createPortal(
    <div
      ref={shell}
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="st-modal-backdrop fixed inset-0 bg-ink/55 backdrop-blur-[3px]" onClick={close} />
      <div
        className={cn(
          "st-modal-panel relative w-full pop border border-line rounded-[24px] shadow-e2",
          "my-auto max-h-[calc(100dvh-2rem)] flex flex-col",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        {/* Sticky so the way out is always on screen, however long the body. */}
        <div className="flex items-start justify-between gap-3 p-5 pb-3 shrink-0 sticky top-0 rounded-t-card z-10">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-t1">{title}</h2>
            {subtitle && <p className="text-[12px] text-t3 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-t3 hover:bg-surface-3 hover:text-t1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body
  );
}
