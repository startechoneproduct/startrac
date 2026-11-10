import { useState } from "react";
import { Truck, Plus, Search, Phone, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDateTime, fmtMoney } from "@/lib/format";

type Supplier = {
  id: string; name: string; contact: string;
  type: "market" | "distributor" | "one_off"; paymentTerms: "cash" | "credit"; notes: string;
};
type Delivery = { id: string; productName: string; qty: number; unitCost?: number; at: string };

const TYPE_LABEL: Record<Supplier["type"], string> = { market: "Market vendor", distributor: "Distributor", one_off: "One-off" };

export function Suppliers() {
  const { currency, can } = useSession();
  const [q, setQ] = useState("");
  const { data, loading, reload } = useApi<{ suppliers: Supplier[] }>(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`, []);
  const suppliers = data?.suppliers || [];
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const paged = usePaged(suppliers);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy from — market vendors, distributors, one-off deliveries"
        actions={can("stock") ? <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add supplier</Button> : undefined}
      />

      <div className="relative max-w-sm mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface border border-line text-[13px] text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : suppliers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Truck}
            title={q ? "No matches" : "No suppliers yet"}
            body={q ? "Try a different name." : "Add the market vendors and distributors you buy from — attach them at stock-in to track cost and delivery history."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {paged.rows.map((s) => (
              <button key={s.id} onClick={() => setSelected(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-semibold text-[13px] flex items-center justify-center shrink-0">
                  {s.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate">{s.name}</div>
                  <div className="text-[11px] text-t3 flex items-center gap-1">
                    {s.contact && <><Phone className="w-3 h-3" /> {s.contact} · </>}{TYPE_LABEL[s.type]}
                  </div>
                </div>
                <Badge tone={s.paymentTerms === "credit" ? "warning" : "neutral"}>{s.paymentTerms === "credit" ? "Credit" : "Cash"}</Badge>
                <ChevronRight className="w-4 h-4 text-t4 shrink-0" />
              </button>
            ))}
          </div>
          <Pager {...paged} onPage={paged.setPage} noun="suppliers" />
        </Card>
      )}

      <AddSupplier open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
      <SupplierDetail supplier={selected} currency={currency} onClose={() => setSelected(null)} onChanged={reload} canManage={can("stock")} />
    </div>
  );
}

function AddSupplier({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", contact: "", type: "market" as Supplier["type"], paymentTerms: "cash" as Supplier["paymentTerms"], notes: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/suppliers", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", contact: "", type: "market", paymentTerms: "cash", notes: "" });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add supplier">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Name"><Input autoFocus required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Mama Bisi Farms" /></Field>
        <Field label="Phone / WhatsApp" hint="Optional"><Input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Supplier["type"] }))}>
              <option value="market">Market vendor</option>
              <option value="distributor">Distributor</option>
              <option value="one_off">One-off</option>
            </Select>
          </Field>
          <Field label="Payment terms">
            <Select value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value as Supplier["paymentTerms"] }))}>
              <option value="cash">Cash on delivery</option>
              <option value="credit">Credit</option>
            </Select>
          </Field>
        </div>
        <Field label="Notes" hint="Optional"><TextArea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Add supplier"}</Button>
      </form>
    </Modal>
  );
}

function SupplierDetail({ supplier, currency, onClose, onChanged, canManage }: {
  supplier: Supplier | null; currency: string; onClose: () => void; onChanged: () => void; canManage: boolean;
}) {
  const { data, loading } = useApi<{ deliveries: Delivery[] }>(
    supplier ? `/suppliers/${supplier.id}/deliveries` : null,
    [supplier?.id]
  );

  async function remove() {
    if (!supplier || !confirm(`Remove ${supplier.name}? Past deliveries stay in the ledger either way.`)) return;
    await api(`/suppliers/${supplier.id}`, { method: "DELETE" });
    onClose();
    onChanged();
  }

  if (!supplier) return null;

  return (
    <Modal open={!!supplier} onClose={onClose} title={supplier.name} subtitle={supplier.contact || "No phone on file"} wide>
      <div className="flex items-center gap-2 mb-4">
        <Badge tone="neutral">{TYPE_LABEL[supplier.type]}</Badge>
        <Badge tone={supplier.paymentTerms === "credit" ? "warning" : "neutral"}>{supplier.paymentTerms === "credit" ? "Credit terms" : "Cash on delivery"}</Badge>
        {canManage && (
          <button onClick={remove} className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-danger hover:underline">
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
        )}
      </div>
      {supplier.notes && <div className="text-[12px] text-t2 px-3 py-2 rounded-ctl bg-surface-2 border border-line mb-4">{supplier.notes}</div>}
      <div className="text-[12px] font-medium text-t3 mb-2">Recent deliveries</div>
      {loading ? (
        <Spinner />
      ) : !data?.deliveries.length ? (
        <div className="text-[12px] text-t4 py-4 text-center">No deliveries recorded yet — attach this supplier at stock-in.</div>
      ) : (
        <div className="divide-y divide-line">
          {data.deliveries.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-t1 truncate">{d.productName}</div>
                <div className="text-[11px] text-t4">{fmtDateTime(d.at)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-[13px] font-semibold text-t1 tabular-nums">+{d.qty}</div>
                {d.unitCost !== undefined && <div className="text-[11px] text-t4 font-mono">{fmtMoney(d.unitCost, currency)}/unit</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
