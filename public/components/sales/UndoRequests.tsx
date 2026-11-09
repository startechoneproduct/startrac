import { useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDateTime, fmtMoney } from "@/lib/format";

type Request = {
  id: string; saleNo: string; at: string; total: number; staffName: string; customerName?: string;
  items: { name: string; qty: number; lineNet: number }[];
  undoRequest: { byName: string; reason: string; at: string };
};

/**
 * Undo requests from the till, waiting on someone who can void sales. Shown at
 * the top of Sales history and the dashboard's Archive; renders nothing when
 * there are none. Approving voids the sale, so the list below refreshes.
 */
export function UndoRequests({ currency, branchKey, onDecided }: { currency: string; branchKey?: string; onDecided: () => void }) {
  const { data, reload } = useApi<{ requests: Request[] }>("/sales/undo/requests?status=pending", [branchKey]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState<Request | null>(null);
  const [note, setNote] = useState("");
  const list = data?.requests ?? [];
  if (!list.length && !error) return null;

  async function decide(r: Request, action: "approve" | "reject", body?: object) {
    setBusy(r.id); setError("");
    try {
      await api(`/sales/${r.id}/undo/${action}`, { method: "POST", body: JSON.stringify(body || {}) });
      setRejecting(null); setNote("");
      reload(); onDecided();
    } catch (err: any) {
      setError(err.message || "Couldn't do that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-4 rounded-card border border-warning/30 bg-warning-soft/60 overflow-hidden" aria-label="Undo requests">
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-warning/20">
        <span className="grid place-items-center w-8 h-8 rounded-xl bg-warning text-white"><Undo2 className="w-4 h-4" /></span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-t1">{list.length} {list.length === 1 ? "sale" : "sales"} waiting to be undone</div>
          <div className="text-[12px] text-t3">Salespeople asked to cancel these right after ringing them up.</div>
        </div>
      </header>
      {error && <div className="px-4 pt-3"><ErrorBanner message={error} /></div>}
      <ul className="divide-y divide-warning/15">
        {list.map((r) => (
          <li key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap bg-surface/70">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-t1">
                {r.saleNo} · <span className="font-mono">{fmtMoney(r.total, currency)}</span>
                <span className="text-t3 font-medium"> · {r.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</span>
              </div>
              <div className="text-[12px] text-t3 mt-0.5">
                {r.undoRequest.byName} asked {fmtDateTime(r.undoRequest.at)}: <b className="text-t2">“{r.undoRequest.reason}”</b>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => setRejecting(r)}><X className="w-4 h-4" /> Keep sale</Button>
              <Button size="sm" variant="danger" disabled={busy === r.id} onClick={() => decide(r, "approve")}><Check className="w-4 h-4" /> Approve undo</Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Keep ${rejecting?.saleNo}?`} subtitle="The sale stands. The salesperson sees your note at the till.">
        <form onSubmit={(e) => { e.preventDefault(); if (rejecting) decide(rejecting, "reject", { note }); }} className="space-y-3">
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note, e.g. the customer took the goods" maxLength={200} />
          <Button type="submit" className="w-full" disabled={busy === rejecting?.id}>Keep the sale</Button>
        </form>
      </Modal>
    </section>
  );
}
