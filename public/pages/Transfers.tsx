import { useState } from "react";
import { ArrowLeftRight, ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";

type Product = { id: string; name: string; stock: number };
type Movement = { id: string; productName: string; type: string; qty: number; reason: string; actorName: string; at: string };

export function Transfers() {
  const { activeBranch, branchesForActive } = useSession();
  const others = branchesForActive.filter((b) => b.id !== activeBranch?.id);
  const { data: prodData, reload: reloadProducts } = useApi<{ products: Product[] }>("/products", [activeBranch?.id]);
  const { data: moveData, loading, reload: reloadMoves } = useApi<{ movements: Movement[] }>(
    "/inventory/movements?type=TRANSFER_OUT&limit=25",
    [activeBranch?.id]
  );
  const products = prodData?.products || [];
  const paged = usePaged(moveData?.movements || []);

  const [toBranchId, setToBranchId] = useState("");
  const [lines, setLines] = useState<{ productId: string; qty: number }[]>([{ productId: "", qty: 1 }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  const setLine = (i: number, patch: Partial<{ productId: string; qty: number }>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const items = lines.filter((l) => l.productId && l.qty > 0);
    if (!toBranchId || !items.length) { setError("Choose a destination and at least one product."); return; }
    setBusy(true); setError(""); setDone("");
    try {
      const res = await api<{ toBranch: string; items: { name: string; qty: number }[] }>("/inventory/transfer", {
        method: "POST",
        body: JSON.stringify({ toBranchId, items, note }),
      });
      setDone(`Sent to ${res.toBranch}: ${res.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}`);
      setLines([{ productId: "", qty: 1 }]);
      setNote("");
      reloadProducts();
      reloadMoves();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (others.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
        <PageHeader title="Transfers" subtitle="Move stock between branches" />
        <Card>
          <EmptyState
            icon={ArrowLeftRight}
            title="You only have one branch"
            body="Transfers light up when your business grows to a second branch. Add one under Settings → Branches."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader title="Transfers" subtitle={`Send stock from ${activeBranch?.name} to another branch — both ledgers record it`} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 p-5 self-start">
          <form onSubmit={submit} className="space-y-3">
            <ErrorBanner message={error} />
            {done && <div className="px-3 py-2.5 rounded-ctl bg-success-soft text-success text-[12px] font-semibold">{done}</div>}

            <div className="flex items-center gap-2 px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-[13px] font-semibold text-t1">
              {activeBranch?.name}
              <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              <Select value={toBranchId} onChange={(e) => setToBranchId(e.target.value)} required className="flex-1 !h-8">
                <option value="">Destination…</option>
                {others.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </div>

            {lines.map((line, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label={i === 0 ? "Product" : ""} className="flex-1">
                  <Select value={line.productId} onChange={(e) => setLine(i, { productId: e.target.value })} required>
                    <option value="">Choose product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.stock} here)</option>
                    ))}
                  </Select>
                </Field>
                <Field label={i === 0 ? "Qty" : ""} className="w-20">
                  <Input type="number" min="1" value={line.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                </Field>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="h-10 w-10 shrink-0 rounded-ctl border border-line-2 flex items-center justify-center text-t4 hover:text-danger">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setLines((ls) => [...ls, { productId: "", qty: 1 }])} className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add another line
            </button>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Weekly restock" /></Field>
            <Button type="submit" className="w-full" disabled={busy}>
              <ArrowLeftRight className="w-4 h-4" /> {busy ? "Transferring…" : "Transfer stock"}
            </Button>
          </form>
        </Card>

        <Card className="lg:col-span-3 overflow-hidden self-start">
          <div className="p-4 pb-2 text-[14px] font-semibold text-t1">Recent transfers out</div>
          {loading ? (
            <Spinner />
          ) : !moveData?.movements.length ? (
            <EmptyState icon={ArrowLeftRight} title="No transfers yet" body="Outgoing transfers from this branch will show here." />
          ) : (
            <>
              <div className="divide-y divide-line">
                {paged.rows.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
                      <ArrowLeftRight className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-t1 truncate">{m.productName}</div>
                      <div className="text-[11px] text-t3 truncate">{m.reason} · {m.actorName} · {fmtDateTime(m.at)}</div>
                    </div>
                    <div className="font-mono text-[13px] font-semibold text-t1 tabular-nums shrink-0">{m.qty}</div>
                  </div>
                ))}
              </div>
              <Pager {...paged} onPage={paged.setPage} noun="transfers" />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
