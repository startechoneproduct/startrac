import { useState } from "react";
import { Bird, Plus, Skull, Wheat, Package } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";

type Cohort = {
  id: string; name: string; species: string; startDate: string;
  initialCount: number; currentCount: number; mortalityCount: number;
  status: "active" | "closed"; ageInDays: number; notes: string; at: string;
};
type Product = { id: string; name: string; category: string; archetype?: string };
type Event = { type: "mortality" | "harvest" | "note"; count?: number; productName: string; note: string; at: string };
type Detail = { cohort: Cohort; events: Event[]; totals: { feedQty: number; birdsHarvested: number; feedConversionRatio: number | null } };

// Living batches — a flock is never Product stock, only what's harvested
// from it is. Feed and harvest move real stock through the ordinary ledger;
// mortality doesn't, since a dead bird was never inventory.
export function Cohorts() {
  const { activeBranch, can } = useSession();
  const { data, loading, reload } = useApi<{ cohorts: Cohort[] }>("/cohorts", [activeBranch?.id]);
  const cohorts = data?.cohorts || [];
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader
        title="Batches"
        subtitle="Flocks fed daily, tracked through mortality, and harvested into real stock"
        actions={can("stock") ? <Button onClick={() => setStarting(true)}><Plus className="w-4 h-4" /> Start batch</Button> : undefined}
      />

      {loading ? (
        <Spinner />
      ) : cohorts.length === 0 ? (
        <Card>
          <EmptyState icon={Bird} title="No batches yet" body="Bring in a batch to start tracking feed, mortality and harvest against it." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cohorts.map((c) => (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left bg-surface border border-line rounded-card p-4 hover:border-brand-400 hover:shadow-e1 transition-all">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold text-t1">{c.name}</span>
                <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge>
              </div>
              <div className="text-[11px] text-t3 mb-2">{c.species || "—"} · Day {c.ageInDays} · started {fmtDate(c.startDate)}</div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="font-mono text-[16px] font-semibold text-t1">{c.currentCount}</div>
                  <div className="text-[10px] text-t4">in batch</div>
                </div>
                <div>
                  <div className="font-mono text-[16px] font-semibold text-danger">{c.mortalityCount}</div>
                  <div className="text-[10px] text-t4">mortality</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <StartCohortModal open={starting} onClose={() => setStarting(false)} onStarted={() => { setStarting(false); reload(); }} />
      <CohortDetailModal cohortId={openId} onClose={() => setOpenId(null)} onChanged={reload} canManage={can("stock")} />
    </div>
  );
}

function StartCohortModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [form, setForm] = useState({ name: "", species: "", startDate: new Date().toISOString().slice(0, 10), initialCount: 100, notes: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/cohorts", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", species: "", startDate: new Date().toISOString().slice(0, 10), initialCount: 100, notes: "" });
      onStarted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Start a batch" subtitle="A flock brought in together, tracked as one unit">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Name"><Input autoFocus required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Batch 12 — Broilers" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Species" hint="Optional"><Input value={form.species} onChange={(e) => setForm((f) => ({ ...f, species: e.target.value }))} placeholder="Broiler" /></Field>
          <Field label="Start date"><Input type="date" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></Field>
        </div>
        <Field label="Number of birds"><Input type="number" min="1" required value={form.initialCount} onChange={(e) => setForm((f) => ({ ...f, initialCount: Number(e.target.value) || 0 }))} /></Field>
        <Field label="Notes" hint="Optional"><TextArea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Starting…" : "Start batch"}</Button>
      </form>
    </Modal>
  );
}

function CohortDetailModal({ cohortId, onClose, onChanged, canManage }: {
  cohortId: string | null; onClose: () => void; onChanged: () => void; canManage: boolean;
}) {
  const { data, reload } = useApi<Detail>(cohortId ? `/cohorts/${cohortId}` : null, [cohortId]);
  const { data: prodData } = useApi<{ products: Product[] }>(cohortId ? "/products" : null, [cohortId]);
  const products = (prodData?.products || []).filter((p) => p.archetype !== "made_to_order");
  const [tab, setTab] = useState<"feed" | "mortality" | "harvest">("feed");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [feedForm, setFeedForm] = useState({ productId: "", qty: 1, note: "" });
  const [mortForm, setMortForm] = useState({ count: 1, note: "" });
  const [harvestForm, setHarvestForm] = useState({ productId: "", qty: 1, harvestType: "birds" as "birds" | "produce", note: "" });

  if (!cohortId) return null;
  const c = data?.cohort;

  async function act(path: string, body: any, resetTo?: () => void) {
    setBusy(true); setError("");
    try {
      await api(`/cohorts/${cohortId}${path}`, { method: "POST", body: JSON.stringify(body) });
      resetTo?.();
      reload(); onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!cohortId} onClose={onClose} title={c?.name || "Batch"} subtitle={c ? `${c.species || "—"} · Day ${c.ageInDays}` : undefined} wide>
      {!c ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { l: "In batch", v: c.currentCount },
              { l: "Mortality", v: c.mortalityCount },
              { l: "Feed given", v: data?.totals.feedQty ?? 0 },
              { l: "FCR", v: data?.totals.feedConversionRatio ?? "—" },
            ].map((s) => (
              <div key={s.l} className="rounded-xl bg-surface-2 border border-line p-3 text-center">
                <div className="text-[15px] font-semibold font-mono text-t1">{s.v}</div>
                <div className="text-[10px] font-medium text-t3 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>

          {canManage && c.status === "active" && (
            <div>
              <div className="flex gap-1.5 mb-3 p-1 rounded-ctl bg-surface-2 border border-line">
                {([
                  { key: "feed", label: "Feed", icon: Wheat },
                  { key: "mortality", label: "Mortality", icon: Skull },
                  { key: "harvest", label: "Harvest", icon: Package },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => animateSwitch("tab", () => setTab(t.key))}
                    className={cn("flex-1 h-8 rounded-md text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors", tab === t.key ? "bg-surface text-t1 shadow-e1" : "text-t3 hover:text-t1")}
                  >
                    <t.icon className="w-3.5 h-3.5" /> {t.label}
                  </button>
                ))}
              </div>

              {tab === "feed" && (
                <div className="flex items-end gap-2">
                  <Field label="Feed product" className="flex-1">
                    <Select value={feedForm.productId} onChange={(e) => setFeedForm({ ...feedForm, productId: e.target.value })}>
                      <option value="">Choose…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Qty" className="w-24"><Input type="number" min="0.01" step="0.01" value={feedForm.qty} onChange={(e) => setFeedForm({ ...feedForm, qty: Number(e.target.value) })} /></Field>
                  <Button disabled={!feedForm.productId || busy} onClick={() => act("/feed", { productId: feedForm.productId, qty: feedForm.qty, note: feedForm.note }, () => setFeedForm({ productId: "", qty: 1, note: "" }))}>
                    <Wheat className="w-4 h-4" /> Feed
                  </Button>
                </div>
              )}
              {tab === "mortality" && (
                <div className="flex items-end gap-2">
                  <Field label="Birds lost" className="flex-1"><Input type="number" min="1" value={mortForm.count} onChange={(e) => setMortForm({ ...mortForm, count: Number(e.target.value) })} /></Field>
                  <Field label="Note" className="flex-1"><Input value={mortForm.note} onChange={(e) => setMortForm({ ...mortForm, note: e.target.value })} placeholder="Optional" /></Field>
                  <Button variant="danger" disabled={busy} onClick={() => act("/mortality", mortForm, () => setMortForm({ count: 1, note: "" }))}>
                    <Skull className="w-4 h-4" /> Record
                  </Button>
                </div>
              )}
              {tab === "harvest" && (
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <Field label="Into product" className="flex-1">
                      <Select value={harvestForm.productId} onChange={(e) => setHarvestForm({ ...harvestForm, productId: e.target.value })}>
                        <option value="">Choose…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Qty" className="w-24"><Input type="number" min="0.01" step="0.01" value={harvestForm.qty} onChange={(e) => setHarvestForm({ ...harvestForm, qty: Number(e.target.value) })} /></Field>
                    <Select value={harvestForm.harvestType} onChange={(e) => setHarvestForm({ ...harvestForm, harvestType: e.target.value as any })} className="!w-32">
                      <option value="birds">Birds</option>
                      <option value="produce">Produce</option>
                    </Select>
                  </div>
                  <p className="text-[11px] text-t4">"Birds" reduces the batch's live count (meat); "produce" (eggs) doesn't — the flock is still laying.</p>
                  <Button className="w-full" disabled={!harvestForm.productId || busy} onClick={() => act("/harvest", harvestForm, () => setHarvestForm({ productId: "", qty: 1, harvestType: "birds", note: "" }))}>
                    <Package className="w-4 h-4" /> Harvest
                  </Button>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-[11px] font-medium text-t3 mb-2">History</div>
            {!data?.events.length ? (
              <div className="text-[12px] text-t4 py-3 text-center">Nothing recorded yet.</div>
            ) : (
              <div className="divide-y divide-line">
                {data.events.slice().reverse().map((e, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 text-[12px]">
                    <Badge tone={e.type === "mortality" ? "danger" : e.type === "harvest" ? "success" : "neutral"}>{e.type}</Badge>
                    <span className="flex-1 text-t2">
                      {e.type === "mortality" && `${e.count} lost`}
                      {e.type === "harvest" && `${e.count} → ${e.productName}`}
                      {e.note && ` — ${e.note}`}
                    </span>
                    <span className="text-t4">{fmtDateTime(e.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
