import { useState } from "react";
import { KeyRound, LifeBuoy, Keyboard, Copy, Check, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * What someone actually needs when they press Help on a till at 7am: the code
 * their staff type to sign in, the shortcuts that speed the day up, and a way
 * to reach a human. Not a link to documentation nobody wrote.
 */
export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, can, activeBusiness } = useSession();
  const { data } = useApi<{ business: { code: string } }>(open && can("settings") ? "/settings" : null, [open]);
  const [copied, setCopied] = useState(false);
  const code = data?.business?.code;

  const shortcuts = [
    ["Ctrl / ⌘ + K", "Jump to search"],
    ["Enter (in POS search)", "Add the scanned or matching item"],
    ["Esc", "Close whatever is open"],
  ];

  const answers = [
    {
      q: "How do my staff sign in?",
      a: "They type the business code once on the till device, then use only their PIN after that. Add staff and set PINs under Staff.",
    },
    {
      q: "Why can't my cashier see profit?",
      a: "Cost and profit are stripped out on the server for staff accounts — not hidden in the page. Give someone the finance permission on their staff record if they should see it.",
    },
    {
      q: "The internet went down mid-sale.",
      a: "Keep selling. Sales queue on the device and sync themselves when the connection returns; the POS shows how many are waiting.",
    },
    {
      q: "A dashboard number looks wrong.",
      a: "Settings → Advanced → Recalculate this period. It reads your sales, returns and expenses back and rewrites the summary. Nothing is deleted.",
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Help" subtitle={activeBusiness?.name} wide>
      <div className="space-y-4">
        {code && (
          <div className="rounded-card border border-line bg-primary-softer p-4">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-4 h-4 text-primary" />
              <span className="text-[13px] font-semibold text-t1">Till login code</span>
            </div>
            <p className="text-[12px] text-t3 mb-3">Staff type this once per device, then sign in with their PIN.</p>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono text-[20px] font-semibold tracking-[0.3em] text-primary text-center py-2.5 rounded-ctl bg-surface border border-line">
                {code}
              </span>
              <button
                onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="w-10 h-10 rounded-ctl border border-line-2 bg-surface flex items-center justify-center text-t3 hover:text-primary hover:border-brand-400 transition-colors"
                title="Copy"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Keyboard className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-semibold text-t1">Shortcuts</span>
          </div>
          <div className="rounded-ctl border border-line overflow-hidden">
            {shortcuts.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-0">
                <kbd className="font-mono text-[11px] font-semibold px-2 py-1 rounded bg-surface-2 border border-line-2 text-t2 shrink-0">{k}</kbd>
                <span className="text-[12.5px] text-t2">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-t1 mb-2">Common questions</div>
          <div className="space-y-2">
            {answers.map((a) => (
              <details key={a.q} className="group rounded-ctl border border-line bg-surface-2 overflow-hidden">
                <summary className="px-3 py-2.5 text-[12.5px] font-semibold text-t1 cursor-pointer list-none flex items-center gap-2">
                  <span className={cn("w-4 h-4 rounded-full bg-primary-soft text-primary text-[10px] font-semibold flex items-center justify-center shrink-0 transition-transform", "group-open:rotate-45")}>+</span>
                  {a.q}
                </summary>
                <p className="px-3 pb-3 pl-9 text-[12px] text-t3 leading-relaxed">{a.a}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-line p-4">
          <div className="flex items-center gap-2 mb-1">
            <LifeBuoy className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-semibold text-t1">Still stuck?</span>
          </div>
          <p className="text-[12px] text-t3 mb-3">
            Send us what happened and which screen you were on — we read every one.
          </p>
          <a
            href={`mailto:support@startrack.app?subject=${encodeURIComponent(`Help — ${activeBusiness?.name || "StarTrack"}`)}&body=${encodeURIComponent(
              `\n\n—\nBusiness: ${activeBusiness?.name || ""}\nSigned in as: ${session?.user.name || ""} (${session?.role || ""})`
            )}`}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-ctl bg-primary text-white text-[12.5px] font-semibold hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Email support
          </a>
        </div>
      </div>
    </Modal>
  );
}
