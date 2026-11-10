import { useState } from "react";
import {
  ClipboardList, Plus, Search, Clock, PlayCircle, CheckCircle2, PackageCheck,
  XCircle, AlertTriangle, Trash2, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pager, ROWS_PER_PAGE } from "@/components/ui/Pager";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Line = { productId: string | null; name: string; kind: "part" | "labour"; qty: number; unitPrice: number; lineNet: number };
type Job = {
  id: string; jobNo: string; title: string; reference: string; notes: string;
  stage: "received" | "in_progress" | "ready" | "collected" | "cancelled";
  customerName: string; customerPhone: string;
  lines: Line[];
  subtotal: number; discount: number; vat: number; total: number;
  deposit: number; depositMethod: string; balance: number;
  promisedAt: string | null; receivedAt: string; readyAt: string | null; collectedAt: string | null;
  staffName: string; partsConsumed: boolean; overdue: boolean;
  stageHistory: { stage: string; at: string; byName: string; note: string }[];
};
type Product = { id: string; name: string; price: number; stock: number | null; archetype?: string };

const PAGE = ROWS_PER_PAGE;

// The workflow is one thing; only the words change by trade.
const STAGES = [
  { k: "received", label: "Received", icon: Clock, tone: "text-t2 bg-surface-3" },
  { k: "in_progress", label: "In progress", icon: PlayCircle, tone: "text-primary bg-primary-soft" },
  { k: "ready", label: "Ready", icon: CheckCircle2, tone: "text-success bg-success-soft" },
  { k: "collected", label: "Collected", icon: PackageCheck, tone: "text-t3 bg-surface-3" },
  { k: "cancelled", label: "Cancelled", icon: XCircle, tone: "text-danger bg-danger-soft" },
] as const;

const stageMeta = (k: string) => STAGES.find((s) => s.k === k) || STAGES[0];

export function Jobs() {
  const { activeBranch, currency } = useSession();
  const [stage, setStage] = useState<string>("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Job | null>(null);

  const query = `/jobs?${stage === "open" ? "open=1" : stage === "overdue" ? "overdue=1" : `stage=${stage}`}` +
    `${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page}&limit=${PAGE}`;
  const { data, loading, reload } = useApi<{
    jobs: Job[]; page: number; pages: number; total: number; stageCounts: Record<string, number>;
  }>(query, [activeBranch?.id]);

  const jobs = data?.jobs || [];
  const counts = data?.stageCounts || {};
  const openCount = (counts.received || 0) + (counts.in_progress || 0) + (counts.ready || 0);

  const setFilter = (v: string) => { setStage(v); setPage(1); };

  const tabs = [
    { k: "open", label: "Open", n: openCount },
    { k: "overdue", label: "Overdue", n: undefined },
    ...STAGES.map((s) => ({ k: s.k, label: s.label, n: counts[s.k] || 0 })),
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Job Tickets"
        subtitle={`${activeBranch?.name || ""} · work taken in, tracked through, collected`}
        actions={<Button onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Take in work</Button>}
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 p-1 rounded-ctl bg-surface-2 border border-line overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setFilter(t.k)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition-colors",
                stage === t.k ? "bg-primary text-white" : "text-t3 hover:text-t1"
              )}
            >
              {t.label}
              {t.n !== undefined && t.n > 0 && (
                <span className={cn("text-[10px] font-semibold px-1.5 rounded-full", stage === t.k ? "bg-white/20" : "bg-surface-3")}>{t.n}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Ticket no., name, plate…"
            className="!w-56 !pl-9"
          />
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title={q ? "Nothing matches that" : "No jobs here"}
            body={q ? "Try a different ticket number, name or reference." : "Take in a piece of work and it will appear here with a ticket number."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {jobs.map((j) => {
              const meta = stageMeta(j.stage);
              const Icon = meta.icon;
              return (
                <button
                  key={j.id}
                  onClick={() => setSelected(j)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
                >
                  <span className={cn("w-9 h-9 shrink-0 rounded-xl flex items-center justify-center", meta.tone)}>
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[12px] font-semibold text-primary">{j.jobNo}</span>
                      <span className="text-[13px] font-semibold text-t1 truncate">{j.title}</span>
                      {j.overdue && <Badge tone="danger">Overdue</Badge>}
                    </div>
                    <div className="text-[11.5px] text-t3 truncate mt-0.5">
                      {[j.customerName || "Walk-in", j.reference, j.promisedAt ? `due ${fmtDate(j.promisedAt)}` : ""]
                        .filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-[13px] font-semibold text-t1 tabular-nums">{fmtMoney(j.total, currency)}</div>
                    {j.balance > 0 && j.stage !== "cancelled" && (
                      <div className="text-[11px] text-warning font-semibold">{fmtMoney(j.balance, currency)} owing</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <Pager
            page={data!.page} pages={data!.pages} total={data!.total}
            from={(data!.page - 1) * PAGE + 1} to={(data!.page - 1) * PAGE + jobs.length}
            onPage={setPage} noun="jobs"
          />
        </Card>
      )}

      <NewJob open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
      <JobDetail job={selected} currency={currency} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); reload(); }} />
    </div>
  );
}

// ── Taking work in ───────────────────────────────────────────────────

type DraftLine = { productId: string; name: string; qty: number; price: number };

function NewJob({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { currency } = useSession();
  const { data: pd } = useApi<{ products: Product[] }>(open ? "/products" : null, []);
  const products = pd?.products || [];
  const [form, setForm] = useState({ title: "", reference: "", customer: "", phone: "", promisedAt: "", notes: "", deposit: 0 });
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);

  const addLine = () => setLines((l) => [...l, { productId: "", name: "", qty: 1, price: 0 }]);
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setLine(i, { productId: id, name: p?.name || "", price: p?.price ?? 0 });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          reference: form.reference,
          notes: form.notes,
          ...(form.customer ? { customer: { name: form.customer, phone: form.phone } } : {}),
          promisedAt: form.promisedAt || undefined,
          deposit: Number(form.deposit) || 0,
          lines: lines
            .filter((l) => (l.productId || l.name.trim()) && l.qty > 0)
            .map((l) => (l.productId ? { productId: l.productId, qty: l.qty, price: l.price } : { name: l.name, qty: l.qty, price: l.price })),
        }),
      });
      setForm({ title: "", reference: "", customer: "", phone: "", promisedAt: "", notes: "", deposit: 0 });
      setLines([]);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Take in work" subtitle="A ticket number is assigned automatically" wide>
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="What is the job?"><Input autoFocus required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Brake service · 3 shirts · Screen replacement" /></Field>
          <Field label="Reference" hint="Plate, tag, IMEI — what you call out on collection">
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="ABC-123-XY" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Customer"><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Promised for"><Input type="date" value={form.promisedAt} onChange={(e) => setForm({ ...form, promisedAt: e.target.value })} /></Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-t3">Parts & labour</span>
            <button type="button" onClick={addLine} className="text-[12px] font-semibold text-primary hover:underline">+ Add line</button>
          </div>
          {lines.length === 0 ? (
            <div className="text-[12px] text-t4 py-3 text-center rounded-ctl border border-dashed border-line-2">
              Add parts from stock, or type a labour charge. You can price it later.
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Select value={l.productId} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">— Labour / free text —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                    {!l.productId && (
                      <Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Describe the work" />
                    )}
                  </div>
                  <Input type="number" min="0.01" step="0.01" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} className="!w-20" />
                  <Input type="number" min="0" value={l.price} onChange={(e) => setLine(i, { price: Number(e.target.value) || 0 })} className="!w-28" />
                  <button type="button" onClick={() => setLines((rows) => rows.filter((_, idx) => idx !== i))} className="h-9 px-2 text-t4 hover:text-danger">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Deposit taken now" hint="Held against the job — it becomes revenue on collection">
            <Input type="number" min="0" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></Field>
        </div>

        <div className="flex items-center justify-between px-3 py-2.5 rounded-ctl bg-surface-2 border border-line">
          <span className="text-[12px] text-t3">Estimated total (before VAT)</span>
          <span className="font-mono font-semibold text-[15px] text-t1 tabular-nums">{fmtMoney(subtotal, currency)}</span>
        </div>

        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</Button>
      </form>
    </Modal>
  );
}

// ── The ticket itself ────────────────────────────────────────────────

function JobDetail({ job, currency, onClose, onChanged }: {
  job: Job | null; currency: string; onClose: () => void; onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"cash" | "pos" | "transfer">("cash");
  if (!job) return null;

  const meta = stageMeta(job.stage);
  const open = job.stage !== "collected" && job.stage !== "cancelled";

  async function move(stage: string) {
    setBusy(true); setError("");
    try {
      await api(`/jobs/${job!.id}/stage`, { method: "POST", body: JSON.stringify({ stage }) });
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    setBusy(true); setError("");
    try {
      const r = await api<{ saleNo: string }>(`/jobs/${job!.id}/collect`, {
        method: "POST",
        body: JSON.stringify({ payments: job!.balance > 0 ? [{ method, amount: job!.balance }] : [] }),
      });
      alert(`Collected. Receipt ${r.saleNo}`);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!job} onClose={onClose} title={job.jobNo} subtitle={job.title} wide>
      <div className="space-y-4">
        <ErrorBanner message={error} />

        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[12px] font-semibold", meta.tone)}>
            <meta.icon className="w-3.5 h-3.5" /> {meta.label}
          </span>
          {job.overdue && (
            <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[12px] font-semibold bg-danger-soft text-danger">
              <AlertTriangle className="w-3.5 h-3.5" /> Past its promised date
            </span>
          )}
          {job.partsConsumed && (
            <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[12px] font-semibold bg-surface-3 text-t3">
              <Wrench className="w-3.5 h-3.5" /> Parts issued
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
          {[
            ["Customer", job.customerName || "Walk-in"],
            ["Reference", job.reference || "—"],
            ["Taken in", fmtDate(job.receivedAt)],
            ["Promised", job.promisedAt ? fmtDate(job.promisedAt) : "—"],
          ].map(([l, v]) => (
            <div key={l} className="rounded-ctl bg-surface-2 border border-line px-3 py-2">
              <div className="text-[11.5px] font-medium text-t4">{l}</div>
              <div className="text-t1 font-semibold truncate mt-0.5">{v}</div>
            </div>
          ))}
        </div>

        <div className="rounded-ctl border border-line overflow-hidden">
          {job.lines.length === 0 ? (
            <div className="px-4 py-4 text-[12px] text-t4 text-center">Nothing priced on this ticket yet.</div>
          ) : (
            job.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-line last:border-0">
                <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0",
                  l.kind === "part" ? "bg-primary-soft text-primary" : "bg-surface-3 text-t3")}>{l.kind}</span>
                <span className="text-[13px] text-t1 flex-1 truncate">{l.name}</span>
                <span className="text-[12px] text-t3 font-mono">×{l.qty}</span>
                <span className="text-[13px] font-mono font-semibold text-t1 tabular-nums w-24 text-right">{fmtMoney(l.lineNet, currency)}</span>
              </div>
            ))
          )}
        </div>

        <div className="rounded-ctl bg-surface-2 border border-line px-4 py-3 space-y-1.5">
          <Row label="Subtotal" value={fmtMoney(job.subtotal, currency)} />
          {job.discount > 0 && <Row label="Discount" value={`−${fmtMoney(job.discount, currency)}`} tone="text-danger" />}
          {job.vat > 0 && <Row label="VAT" value={fmtMoney(job.vat, currency)} />}
          <div className="pt-1.5 border-t border-line"><Row label="Total" value={fmtMoney(job.total, currency)} bold /></div>
          {job.deposit > 0 && <Row label={`Deposit (${job.depositMethod})`} value={`−${fmtMoney(job.deposit, currency)}`} tone="text-success" />}
          {open && <Row label="Balance owing" value={fmtMoney(job.balance, currency)} bold tone="text-warning" />}
        </div>

        {open && (
          <div className="flex flex-wrap gap-2">
            {job.stage === "received" && (
              <Button onClick={() => move("in_progress")} disabled={busy}><PlayCircle className="w-4 h-4" /> Start work</Button>
            )}
            {job.stage === "in_progress" && (
              <Button onClick={() => move("ready")} disabled={busy}><CheckCircle2 className="w-4 h-4" /> Mark ready</Button>
            )}
            {job.stage === "ready" && (
              <>
                <Select value={method} onChange={(e) => setMethod(e.target.value as any)} className="!w-32">
                  <option value="cash">Cash</option>
                  <option value="pos">POS</option>
                  <option value="transfer">Transfer</option>
                </Select>
                <Button variant="success" onClick={collect} disabled={busy}>
                  <PackageCheck className="w-4 h-4" /> Collect · {fmtMoney(job.balance, currency)}
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={() => move("cancelled")} disabled={busy}>
              <XCircle className="w-4 h-4" /> Cancel job
            </Button>
          </div>
        )}

        <div>
          <div className="text-[11px] font-medium text-t3 mb-1.5">History</div>
          <div className="space-y-1">
            {job.stageHistory.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[11.5px] text-t3">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                <span className="font-semibold text-t2 capitalize">{h.stage.replace("_", " ")}</span>
                <span>{fmtDateTime(h.at)}</span>
                {h.byName && <span>· {h.byName}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className={cn("text-[12px]", bold ? "font-semibold text-t1" : "text-t2")}>{label}</span>
      <span className={cn("font-mono tabular-nums", bold ? "text-[15px] font-semibold" : "text-[12px]", tone || "text-t1")}>{value}</span>
    </div>
  );
}
