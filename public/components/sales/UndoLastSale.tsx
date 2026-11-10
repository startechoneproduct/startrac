import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { fmtMoney, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type UndoSale = {
  id: string; saleNo: string; at: string; total: number; customerName?: string;
  items: { name: string; qty: number; lineNet: number }[];
  undoRequest: { status: "pending" | "approved" | "rejected"; byName: string; reason: string; decidedByName?: string; note?: string } | null;
  undoUntil: string;
};

const REASONS = ["Wrong item", "Wrong quantity", "Wrong payment method", "Customer changed mind", "Sold by mistake"];

/**
 * Sits under the till's Complete Sale button. For a few minutes after a sale
 * the person who rang it up can undo it: at once if they may void sales,
 * otherwise as a request a manager approves. `refresh` changes after every
 * checkout so the link always points at the latest sale.
 */
export function UndoLastSale({ refresh, currency, onUndone }: { refresh: unknown; currency: string; onUndone: () => void }) {
  const [sale, setSale] = useState<UndoSale | null>(null);
  const [canVoid, setCanVoid] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api<{ sale: UndoSale | null; canVoid: boolean }>("/sales/undo/last")
      .then((r) => { setSale(r.sale); setCanVoid(r.canVoid); setNow(Date.now()); })
      .catch(() => setSale(null));
  }, []);

  useEffect(load, [load, refresh]);
  // Tick so the minutes left count down, and check back while a request waits.
  useEffect(() => {
    if (!sale) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    const poll = sale.undoRequest?.status === "pending" ? setInterval(load, 20_000) : undefined;
    return () => { clearInterval(t); if (poll) clearInterval(poll); };
  }, [sale, load]);

  if (!sale) return null;
  const left = new Date(sale.undoUntil).getTime() - now;
  const req = sale.undoRequest;

  if (req?.status === "pending") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-warning-soft text-warning px-3 py-2 text-[12px] font-semibold">
        <Clock className="w-4 h-4 shrink-0" />
        <span className="min-w-0">Waiting for a manager to approve undoing {sale.saleNo}.</span>
      </div>
    );
  }
  if (req?.status === "approved") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success-soft text-success px-3 py-2 text-[12px] font-semibold">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span className="min-w-0">{sale.saleNo} was undone{req.decidedByName && req.decidedByName !== req.byName ? ` by ${req.decidedByName}` : ""}. Stock is back on the shelf.</span>
      </div>
    );
  }
  if (req?.status === "rejected") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-danger-soft text-danger px-3 py-2 text-[12px] font-semibold">
        <XCircle className="w-4 h-4 shrink-0" />
        <span className="min-w-0">{req.decidedByName} kept {sale.saleNo}{req.note ? `: “${req.note}”` : "."}</span>
      </div>
    );
  }
  if (left <= 0) return null;

  const why = reason === "Other" ? other.trim() : reason;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (why.length < 3) { setError("Pick a reason."); return; }
    setBusy(true); setError("");
    try {
      const r = await api<{ done: boolean; sale: UndoSale }>(`/sales/${sale!.id}/undo`, { method: "POST", body: JSON.stringify({ reason: why }) });
      setSale(r.sale);
      setOpen(false); setReason(""); setOther("");
      if (r.done) onUndone();
    } catch (err: any) {
      setError(err.message || "Couldn't undo that sale.");
      load();
    } finally {
      setBusy(false);
    }
  }

  const mins = Math.max(1, Math.ceil(left / 60_000));
  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl text-[12.5px] font-semibold text-t3 hover:text-danger hover:bg-danger-soft transition-colors"
      >
        <Undo2 className="w-4 h-4" /> Undo last sale · {sale.saleNo} <span className="font-medium text-t4">({mins} min left)</span>
      </button>

      <Modal
        open={open} onClose={() => setOpen(false)}
        title={`Undo ${sale.saleNo}?`}
        subtitle={canVoid
          ? "The sale is cancelled, stock goes back on the shelf, and it stays in the Archive marked voided."
          : "A manager has to approve this. Until then the sale stands. Once approved, stock goes back on the shelf."}
      >
        <form onSubmit={submit} className="space-y-4">
          <ErrorBanner message={error} />
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <div className="flex items-center justify-between text-[12px] text-t3 mb-2">
              <span>{fmtTime(sale.at)}{sale.customerName ? ` · ${sale.customerName}` : ""}</span>
              <span className="font-mono font-bold text-[14px] text-t1">{fmtMoney(sale.total, currency)}</span>
            </div>
            <ul className="space-y-1">
              {sale.items.map((i, n) => (
                <li key={n} className="flex justify-between gap-3 text-[13px] text-t2">
                  <span className="truncate">{i.qty} × {i.name}</span>
                  <span className="font-mono tabular-nums shrink-0">{fmtMoney(i.lineNet, currency)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[12.5px] font-semibold text-t2 mb-2">Why?</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
              {[...REASONS, "Other"].map((r) => (
                <button
                  key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                  className={cn("h-9 px-3 rounded-full border text-[12.5px] font-semibold transition-colors",
                    reason === r ? "border-primary bg-primary-soft text-primary" : "border-line-2 text-t2 hover:border-primary")}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === "Other" && (
              <Input autoFocus className="mt-2" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Say what went wrong" maxLength={200} />
            )}
          </div>

          <Button type="submit" variant="danger" className="w-full" disabled={busy || why.length < 3}>
            <Undo2 className="w-4 h-4" /> {busy ? "Sending…" : canVoid ? "Undo this sale" : "Ask a manager to undo"}
          </Button>
        </form>
      </Modal>
    </>
  );
}
