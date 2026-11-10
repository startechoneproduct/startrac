import { useState } from "react";
import {
  FolderKanban, Plus, Search, ArrowLeft, Wallet, Clock, CheckCircle2, Circle, Trash2, AlertTriangle, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { MethodPicker, Meter, SectionTitle, Tabs, Tile, PersonFields, type PayMethod } from "@/components/services/ServiceKit";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDate, fmtMoney, todayStr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "proposal" | "active" | "on_hold" | "completed" | "cancelled";
type Project = {
  id: string; projectNo: string; customerId: string; clientName: string; title: string; type: string; lead: string; status: Status;
  budget: number; amountPaid: number; outstanding: number; earned: number; dueNow: number;
  startDate: string; dueDate: string; milestonesDone: number; milestonesTotal: number; overdueMilestones: number;
  lateProject: boolean; hours: number;
};
type Milestone = { id: string; title: string; amount: number; dueDate: string; status: "pending" | "done"; overdue: boolean };
type Detail = Project & {
  description: string; milestoneValue: number; milestones: Milestone[]; effectiveRate: number | null;
  payments: { saleId: string; saleNo: string; amount: number; method: string; note: string; at: string; byName: string; reversed: boolean }[];
  timeLogs: { id: string; date: string; who: string; hours: number; note: string }[];
};
type Overview = {
  counts: { proposal: number; active: number; onHold: number; completed: number; late: number };
  value: { pipeline: number; underway: number; collected: number; outstanding: number; dueNow: number; revenue30d: number };
  hours30d: number;
  toInvoice: { projectId: string; projectNo: string; project: string; client: string; amount: number }[];
  overdueMilestones: { projectId: string; projectNo: string; project: string; client: string; milestone: string; amount: number; dueDate: string }[];
  byType: { type: string; projects: number; budget: number; collected: number }[];
};

const STATUS: Record<Status, { label: string; tone: "brand" | "success" | "warning" | "danger" | "neutral" }> = {
  proposal: { label: "Proposal", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  on_hold: { label: "On hold", tone: "warning" },
  completed: { label: "Completed", tone: "brand" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

type Tab = "overview" | "projects";

export function Projects() {
  const { can, currency, activeBranch } = useSession();
  const [tab, setTab] = useState<Tab>(can("dashboard_ops") ? "overview" : "projects");
  const [open, setOpen] = useState<string | null>(null);
  const tabs: { key: Tab; label: string }[] = [
    ...(can("dashboard_ops") ? [{ key: "overview" as Tab, label: "Overview" }] : []),
    { key: "projects", label: "Projects" },
  ];
  const go = (id: string) => { setTab("projects"); setOpen(id); };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader title="Projects" subtitle={`${activeBranch?.name || ""} · client work, milestones and payments`} />
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setOpen(null); }} />
      {tab === "overview" && <OverviewTab currency={currency} onOpen={go} />}
      {tab === "projects" && (open ? <ProjectDetail id={open} currency={currency} onBack={() => setOpen(null)} /> : <ProjectList currency={currency} onOpen={setOpen} />)}
    </div>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

function OverviewTab({ currency, onOpen }: { currency: string; onOpen: (id: string) => void }) {
  const { data, loading, error } = useApi<Overview>("/agency/overview");
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  const { counts, value, toInvoice, overdueMilestones, byType } = data;
  if (!counts.proposal && !counts.active && !counts.onHold && !counts.completed) {
    return <Card><EmptyState icon={FolderKanban} title="No projects yet" body="Add the work you've agreed with a client — its budget, milestones and payments — and this page will show what's owed and what's late." /></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <Tile label="In progress" value={counts.active + counts.onHold} hint={`${counts.proposal} proposals · ${counts.completed} done`} />
        <Tile label="Late projects" value={counts.late} tone={counts.late ? "danger" : "success"} />
        <Tile label="Pipeline (proposals)" value={fmtMoney(value.pipeline, currency)} />
        <Tile label="Underway value" value={fmtMoney(value.underway, currency)} />
        <Tile label="Collected" value={fmtMoney(value.collected, currency)} tone="success" />
        <Tile label="Still owed" value={fmtMoney(value.outstanding, currency)} tone={value.outstanding ? "warning" : "success"} hint="on live and finished projects" />
        <Tile label="Invoice now" value={fmtMoney(value.dueNow, currency)} tone={value.dueNow ? "warning" : undefined} hint="delivered but unpaid" />
        <Tile label="Income, 30 days" value={fmtMoney(value.revenue30d, currency)} hint={`${data.hours30d}h logged`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <SectionTitle>Ready to invoice</SectionTitle>
          <Card className="overflow-hidden">
            {toInvoice.length === 0 ? <div className="px-4 py-8 text-center text-[12px] text-t4">Nothing delivered is waiting on payment.</div> : (
              <div className="divide-y divide-line">
                {toInvoice.map((r) => (
                  <button key={r.projectId} onClick={() => onOpen(r.projectId)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <FileText className="w-4 h-4 text-t4 shrink-0" />
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold truncate">{r.project}</div><div className="text-[11px] text-t3">{r.projectNo} · {r.client}</div></div>
                    <div className="font-mono font-semibold text-[13px] text-warning">{fmtMoney(r.amount, currency)}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
        <div>
          <SectionTitle>Overdue milestones</SectionTitle>
          <Card className="overflow-hidden">
            {overdueMilestones.length === 0 ? <div className="px-4 py-8 text-center text-[12px] text-t4">Nothing is behind schedule.</div> : (
              <div className="divide-y divide-line">
                {overdueMilestones.map((m, i) => (
                  <button key={i} onClick={() => onOpen(m.projectId)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold truncate">{m.milestone}</div><div className="text-[11px] text-t3 truncate">{m.project} · {m.client}</div></div>
                    <div className="text-right"><div className="font-mono text-[12.5px]">{fmtMoney(m.amount, currency)}</div><div className="text-[10.5px] text-danger font-semibold">due {fmtDate(m.dueDate)}</div></div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div>
        <SectionTitle>By kind of work</SectionTitle>
        <Card className="overflow-hidden divide-y divide-line">
          {byType.map((t) => {
            const pct = t.budget > 0 ? Math.round((t.collected / t.budget) * 100) : 0;
            return (
              <div key={t.type} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="text-[13px] font-semibold flex-1">{t.type}</div>
                  <div className="text-[11px] text-t3">{t.projects} project{t.projects === 1 ? "" : "s"}</div>
                  <div className="font-mono text-[13px] font-semibold w-28 text-right">{fmtMoney(t.collected, currency)}</div>
                </div>
                <div className="mt-1.5"><Meter pct={pct} tone="success" /></div>
                <div className="text-[10.5px] text-t4 mt-1">{pct}% of {fmtMoney(t.budget, currency)} budgeted</div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── List ───────────────────────── */

function ProjectList({ currency, onOpen }: { currency: string; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<"open" | "completed" | "all">("open");
  const [q, setQ] = useState("");
  const path = `/agency/projects?status=${status === "all" ? "" : status}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
  const { data, loading, reload } = useApi<{ projects: Project[] }>(path);
  const [newOpen, setNewOpen] = useState(false);
  const rows = data?.projects || [];

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" className="!pl-9" />
          </div>
          <div className="flex gap-1.5">
            {([["open", "Open"], ["completed", "Completed"], ["all", "All"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setStatus(k)} className={cn(
                "h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors",
                status === k ? "bg-primary-soft border-brand-400 text-primary" : "border-line-2 text-t3 hover:text-t1"
              )}>{label}</button>
            ))}
          </div>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New project</Button>
      </div>

      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState icon={FolderKanban} title="No projects here" body="A project is work agreed with a client for a budget, delivered in milestones and paid in stages." action={<Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New project</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((p) => {
            const st = STATUS[p.status];
            const paidPct = p.budget > 0 ? Math.round((p.amountPaid / p.budget) * 100) : 0;
            return (
              <Card key={p.id} interactive className="p-4 cursor-pointer" onClick={() => onOpen(p.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono text-t4">{p.projectNo} · {p.type}</div>
                    <div className="text-[14px] font-semibold text-t1 truncate">{p.title}</div>
                    <div className="text-[12px] text-t3 truncate">{p.clientName}{p.lead ? ` · led by ${p.lead}` : ""}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {p.lateProject && <Badge tone="danger">late</Badge>}
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-t3 mb-1"><span>Paid</span><span className="font-mono">{fmtMoney(p.amountPaid, currency)} / {fmtMoney(p.budget, currency)}</span></div>
                  <Meter pct={paidPct} tone="success" />
                </div>
                <div className="flex items-center justify-between mt-3 text-[11.5px] text-t3">
                  <span>{p.milestonesTotal ? `${p.milestonesDone}/${p.milestonesTotal} milestones` : "No milestones"}{p.overdueMilestones ? ` · ${p.overdueMilestones} overdue` : ""}</span>
                  {p.dueNow > 0 ? <span className="font-semibold text-warning">invoice {fmtMoney(p.dueNow, currency)}</span> : p.dueDate ? <span>due {fmtDate(p.dueDate)}</span> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} onDone={(id) => { setNewOpen(false); reload(); onOpen(id); }} />}
    </>
  );
}

function NewProjectModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [form, setForm] = useState({ title: "", type: "", lead: "", budget: "", startDate: "", dueDate: "", status: "proposal", description: "" });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api<{ project: Project }>("/agency/projects", {
        method: "POST",
        body: JSON.stringify({
          customer: { name: name.trim(), phone: phone.trim() }, title: form.title.trim(), type: form.type.trim() || "General",
          lead: form.lead, budget: Number(form.budget), status: form.status, startDate: form.startDate, dueDate: form.dueDate, description: form.description,
        }),
      });
      onDone(r.project.id);
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New project" subtitle="Agree the work first — milestones and payments come next" wide>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <PersonFields label="Client" name={name} phone={phone} onName={setName} onPhone={setPhone} autoFocus />
        <Field label="Project title"><Input required value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Online ordering web app" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Kind of work"><Input value={form.type} onChange={(e) => set({ type: e.target.value })} placeholder="Web App, Data Analysis…" /></Field>
          <Field label="Budget"><Input type="number" min={0} required value={form.budget} onChange={(e) => set({ budget: e.target.value })} /></Field>
          <Field label="Lead"><Input value={form.lead} onChange={(e) => set({ lead: e.target.value })} placeholder="Who runs it" /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Start"><Input type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Deadline"><Input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
          <Field label="Stage"><Select value={form.status} onChange={(e) => set({ status: e.target.value })}><option value="proposal">Proposal</option><option value="active">Already started</option></Select></Field>
        </div>
        <Field label="Scope notes"><TextArea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Button type="submit" className="w-full" disabled={busy || !name.trim() || !form.title.trim() || form.budget === ""}>{busy ? "Creating…" : "Create project"}</Button>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Detail ───────────────────────── */

function ProjectDetail({ id, currency, onBack }: { id: string; currency: string; onBack: () => void }) {
  const { can } = useSession();
  const { data, loading, error, reload } = useApi<{ project: Detail }>(`/agency/projects/${id}`);
  const [local, setLocal] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [msOpen, setMsOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [reversing, setReversing] = useState<Detail["payments"][number] | null>(null);
  const [reason, setReason] = useState("");

  const p = local ?? data?.project ?? null;
  if (loading && !p) return <Spinner />;
  if (error && !p) return <ErrorBanner message={error} />;
  if (!p) return null;

  // Every mutating endpoint returns the fresh project, so the page updates
  // from the response instead of re-fetching.
  async function call(path: string, method: string, body?: unknown) {
    setMsg("");
    try {
      const r = await api<{ project: Detail }>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      setLocal(r.project);
      reload();
      return true;
    } catch (err: any) {
      setMsg(err.message);
      return false;
    }
  }
  const closed = p.status === "completed" || p.status === "cancelled";
  const st = STATUS[p.status];

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-t3 hover:text-t1 mb-3"><ArrowLeft className="w-3.5 h-3.5" /> All projects</button>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="text-[11px] font-mono text-t4">{p.projectNo} · {p.type}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-[18px] font-semibold text-t1">{p.title}</h2>
            <Badge tone={st.tone}>{st.label}</Badge>
            {p.lateProject && <Badge tone="danger">late</Badge>}
          </div>
          <p className="text-[12.5px] text-t3 mt-1">{p.clientName}{p.lead ? ` · led by ${p.lead}` : ""}{p.startDate ? ` · ${fmtDate(p.startDate)}` : ""}{p.dueDate ? ` → ${fmtDate(p.dueDate)}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={p.status} onChange={(e) => call(`/agency/projects/${id}`, "PATCH", { status: e.target.value })} className="!h-9 !w-auto text-[12px]">
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          {p.status !== "cancelled" && p.outstanding > 0 && <Button onClick={() => setPayOpen(true)}><Wallet className="w-4 h-4" /> Receive payment</Button>}
        </div>
      </div>
      {msg && <div className="mb-4"><ErrorBanner message={msg} /></div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Tile label="Budget" value={fmtMoney(p.budget, currency)} />
        <Tile label="Paid" value={fmtMoney(p.amountPaid, currency)} tone="success" hint={`${fmtMoney(p.outstanding, currency)} left`} />
        <Tile label="Delivered value" value={fmtMoney(p.earned, currency)} hint={`${p.milestonesDone}/${p.milestonesTotal} milestones`} />
        <Tile label="Invoice now" value={fmtMoney(p.dueNow, currency)} tone={p.dueNow ? "warning" : undefined} hint={p.dueNow ? "delivered, not yet paid" : "nothing waiting"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div>
            <SectionTitle action={!closed ? <Button size="sm" variant="secondary" onClick={() => setMsOpen(true)}><Plus className="w-3.5 h-3.5" /> Milestone</Button> : undefined}>
              Milestones <span className="text-t4 font-normal">· {fmtMoney(p.milestoneValue, currency)} of {fmtMoney(p.budget, currency)} assigned</span>
            </SectionTitle>
            {p.milestones.length === 0 ? (
              <Card><div className="px-4 py-8 text-center text-[12px] text-t4">Break the work into milestones so you can bill as you deliver.</div></Card>
            ) : (
              <Card className="overflow-hidden divide-y divide-line">
                {p.milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      disabled={p.status === "cancelled" || p.status === "completed"}
                      onClick={() => call(`/agency/projects/${id}/milestones/${m.id}`, "PATCH", { status: m.status === "done" ? "pending" : "done" })}
                      className="shrink-0 disabled:opacity-40"
                      aria-label={m.status === "done" ? "Mark as not delivered" : "Mark as delivered"}
                    >
                      {m.status === "done" ? <CheckCircle2 className="w-5 h-5 text-success" /> : <Circle className="w-5 h-5 text-t4 hover:text-primary" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[13px] font-semibold", m.status === "done" ? "text-t3 line-through" : "text-t1")}>{m.title}</div>
                      {m.dueDate && <div className={cn("text-[11px]", m.overdue ? "text-danger font-semibold" : "text-t4")}>{m.overdue ? "overdue · " : "due "}{fmtDate(m.dueDate)}</div>}
                    </div>
                    <div className="font-mono text-[13px] font-semibold">{fmtMoney(m.amount, currency)}</div>
                    {m.status === "pending" && !closed && (
                      <button onClick={() => call(`/agency/projects/${id}/milestones/${m.id}`, "DELETE")} className="text-t4 hover:text-danger" aria-label="Delete milestone"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div>
            <SectionTitle>Payments</SectionTitle>
            {p.payments.length === 0 ? (
              <Card><div className="px-4 py-8 text-center text-[12px] text-t4">No payments yet.</div></Card>
            ) : (
              <Card className="overflow-hidden divide-y divide-line">
                {p.payments.map((x) => (
                  <div key={x.saleId} className={cn("flex items-center gap-3 px-4 py-2.5", x.reversed && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[13px] font-semibold", x.reversed && "line-through")}>{fmtMoney(x.amount, currency)} <span className="text-t3 font-normal capitalize">· {x.method}{x.note ? ` · ${x.note}` : ""}</span></div>
                      <div className="text-[11px] text-t4">{fmtDate(x.at)} · {x.saleNo} · {x.byName}</div>
                    </div>
                    {x.reversed ? <Badge tone="danger">reversed</Badge>
                      : can("void_sales") && <button onClick={() => { setReversing(x); setReason(""); }} className="text-[11px] font-semibold text-danger hover:underline">Reverse</button>}
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>

        <div>
          <SectionTitle action={!closed ? <Button size="sm" variant="secondary" onClick={() => setTimeOpen(true)}><Clock className="w-3.5 h-3.5" /> Log time</Button> : undefined}>
            Time <span className="text-t4 font-normal">· {p.hours}h</span>
          </SectionTitle>
          {p.effectiveRate !== null && (
            <div className="text-[11.5px] text-t3 mb-2">Effective rate so far: <span className="font-mono font-semibold text-t1">{fmtMoney(p.effectiveRate, currency)}/hour</span> collected</div>
          )}
          <Card className="overflow-hidden">
            {p.timeLogs.length === 0 ? <div className="px-4 py-8 text-center text-[12px] text-t4">No hours logged.</div> : (
              <div className="divide-y divide-line">
                {p.timeLogs.map((t) => (
                  <div key={t.id} className="px-4 py-2.5">
                    <div className="flex justify-between text-[12.5px]"><span className="font-semibold">{t.who}</span><span className="font-mono">{t.hours}h</span></div>
                    <div className="text-[11px] text-t4">{fmtDate(t.date)}{t.note ? ` · ${t.note}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {p.description && (<><div className="mt-5"><SectionTitle>Scope</SectionTitle></div><p className="text-[12.5px] text-t2 whitespace-pre-wrap">{p.description}</p></>)}
        </div>
      </div>

      {payOpen && <PayModal project={p} currency={currency} onClose={() => setPayOpen(false)} onDone={(proj) => { setPayOpen(false); setLocal(proj); reload(); }} />}
      {msOpen && <MilestoneModal onClose={() => setMsOpen(false)} room={p.budget - p.milestoneValue} currency={currency} onSave={async (b) => { if (await call(`/agency/projects/${id}/milestones`, "POST", b)) setMsOpen(false); }} />}
      {timeOpen && <TimeModal onClose={() => setTimeOpen(false)} onSave={async (b) => { if (await call(`/agency/projects/${id}/time`, "POST", b)) setTimeOpen(false); }} />}
      {reversing && (
        <Modal open onClose={() => setReversing(null)} title="Reverse this payment?" subtitle={`${fmtMoney(reversing.amount, currency)} · ${reversing.saleNo}`}>
          <div className="space-y-3">
            <p className="text-[12.5px] text-t3">The money comes off the books and the project's balance goes back up. The receipt stays on record, marked reversed.</p>
            <Field label="Reason"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Refunded / entered twice" /></Field>
            <Button variant="danger" className="w-full" disabled={reason.trim().length < 3}
              onClick={async () => { if (await call(`/agency/projects/${id}/payments/${reversing.saleId}/reverse`, "POST", { reason })) setReversing(null); }}>
              Reverse payment
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PayModal({ project, currency, onClose, onDone }: { project: Detail; currency: string; onClose: () => void; onDone: (p: Detail) => void }) {
  const suggested = project.dueNow > 0 ? project.dueNow : project.outstanding;
  const [amount, setAmount] = useState(String(suggested));
  const [method, setMethod] = useState<PayMethod>("transfer");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api<{ project: Detail }>(`/agency/projects/${project.id}/payments`, { method: "POST", body: JSON.stringify({ method, amount: Number(amount), note }) });
      onDone(r.project);
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Receive a payment" subtitle={`${project.title} · ${fmtMoney(project.outstanding, currency)} still owed`}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        {project.dueNow > 0 && <p className="text-[12px] text-t3">Delivered work worth <b className="text-t1">{fmtMoney(project.dueNow, currency)}</b> is unpaid.</p>}
        <Field label="Amount received"><Input type="number" min={1} max={project.outstanding} step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="What is it for? (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Deposit, milestone 2…" /></Field>
        <Field label="Method"><MethodPicker value={method} onChange={setMethod} /></Field>
        <Button type="submit" className="w-full" disabled={busy || !(Number(amount) > 0)}>{busy ? "Saving…" : `Receive ${fmtMoney(Number(amount) || 0, currency)}`}</Button>
      </form>
    </Modal>
  );
}

function MilestoneModal({ onClose, onSave, room, currency }: { onClose: () => void; onSave: (b: { title: string; amount: number; dueDate: string }) => void; room: number; currency: string }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  return (
    <Modal open onClose={onClose} title="Add a milestone" subtitle={`${fmtMoney(Math.max(0, room), currency)} of the budget is still unassigned`}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ title: title.trim(), amount: Number(amount), dueDate }); }} className="space-y-3">
        <Field label="What gets delivered"><Input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Admin dashboard" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Worth"><Input type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Due"><Input type="date" min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        </div>
        <Button type="submit" className="w-full" disabled={!title.trim() || amount === ""}>Add milestone</Button>
      </form>
    </Modal>
  );
}

function TimeModal({ onClose, onSave }: { onClose: () => void; onSave: (b: { date: string; who: string; hours: number; note: string }) => void }) {
  const { session } = useSession();
  const [date, setDate] = useState(todayStr());
  const [who, setWho] = useState(session?.user.name || "");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title="Log time">
      <form onSubmit={(e) => { e.preventDefault(); onSave({ date, who, hours: Number(hours), note }); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" max={todayStr()} required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Hours"><Input type="number" min={0.1} max={24} step="0.25" required autoFocus value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        </div>
        <Field label="Who"><Input value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="What was done"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button type="submit" className="w-full" disabled={!(Number(hours) > 0)}>Log time</Button>
      </form>
    </Modal>
  );
}
