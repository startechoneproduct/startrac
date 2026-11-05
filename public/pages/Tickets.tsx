import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LifeBuoy, Plus, Search, Clock, Loader2, CheckCircle2, Archive, Send,
  ArrowUpRight, User,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pager, ROWS_PER_PAGE } from "@/components/ui/Pager";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Comment = { byId: string; byName: string; body: string; at: string };
type Ticket = {
  id: string; ticketNo: string; subject: string; description: string;
  category: "complaint" | "question" | "billing" | "technical" | "other";
  priority: "low" | "normal" | "high";
  status: "open" | "in_progress" | "resolved" | "closed";
  customerId: string | null; customerName: string; customerPhone: string;
  raisedBy: { userId: string; name: string };
  assignedToId: string | null; assignedToName: string;
  comments: Comment[];
  scope: "business" | "platform"; escalatedAt: string | null;
  resolvedAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string;
};

const PAGE = ROWS_PER_PAGE;

const STATUS_META: Record<Ticket["status"], { label: string; icon: any; tone: "neutral" | "brand" | "success" | "warning" }> = {
  open: { label: "Open", icon: Clock, tone: "warning" },
  in_progress: { label: "In progress", icon: Loader2, tone: "brand" },
  resolved: { label: "Resolved", icon: CheckCircle2, tone: "success" },
  closed: { label: "Closed", icon: Archive, tone: "neutral" },
};
// Full literal class strings — Tailwind's scanner can't see a name built
// with a template literal (e.g. `bg-${tone}-soft`), so this stays a map.
const STATUS_ICON_CLS: Record<Ticket["status"], string> = {
  open: "bg-warning-soft text-warning",
  in_progress: "bg-primary-soft text-primary",
  resolved: "bg-success-soft text-success",
  closed: "bg-surface-3 text-t3",
};
const PRIORITY_TONE: Record<Ticket["priority"], "neutral" | "warning" | "danger"> = {
  low: "neutral", normal: "neutral", high: "danger",
};

export function Tickets() {
  const { can, activeBranch } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Arriving from a notification click (?open=<id>) opens straight to it.
  useEffect(() => {
    const open = searchParams.get("open");
    if (open) {
      setSelectedId(open);
      searchParams.delete("open");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const query = `/tickets?scope=business&${status !== "all" ? `status=${status}&` : ""}${q ? `q=${encodeURIComponent(q)}&` : ""}page=${page}&limit=${PAGE}`;
  const { data, loading, reload } = useApi<{
    tickets: Ticket[]; page: number; pages: number; total: number; canManage: boolean; statusCounts: Record<string, number>;
  }>(query, [activeBranch?.id]);

  const tickets = data?.tickets || [];
  const counts = data?.statusCounts || {};
  const canManage = data?.canManage ?? can("support");

  const tabs = [
    { k: "all", label: "All", n: Object.values(counts).reduce((s, n) => s + n, 0) },
    ...(Object.keys(STATUS_META) as Ticket["status"][]).map((k) => ({ k, label: STATUS_META[k].label, n: counts[k] || 0 })),
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Support"
        subtitle={canManage ? "Every ticket for this business" : "Tickets you raised or were assigned"}
        actions={<Button onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New ticket</Button>}
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 p-1 rounded-ctl bg-surface-2 border border-line overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => { setStatus(t.k); setPage(1); }}
              className={cn(
                "flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition-colors",
                status === t.k ? "bg-primary text-white" : "text-t3 hover:text-t1"
              )}
            >
              {t.label}
              {t.n > 0 && (
                <span className={cn("text-[10px] px-1.5 rounded-full", status === t.k ? "bg-white/20" : "bg-surface-3")}>{t.n}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Subject, ticket no., customer…" className="!w-56 !pl-9" />
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState
            icon={LifeBuoy}
            title={q ? "Nothing matches that" : "No tickets here"}
            body={q ? "Try a different search." : "Raise one for a complaint, a question, or anything that needs tracking to resolution."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {tickets.map((t) => {
              const meta = STATUS_META[t.status];
              const Icon = meta.icon;
              return (
                <button key={t.id} onClick={() => setSelectedId(t.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
                  <span className={cn("w-9 h-9 shrink-0 rounded-xl flex items-center justify-center", STATUS_ICON_CLS[t.status])}>
                    <Icon className={cn("w-[18px] h-[18px]", t.status === "in_progress" && "animate-spin")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[12px] font-semibold text-primary">{t.ticketNo}</span>
                      <span className="text-[13px] font-semibold text-t1 truncate">{t.subject}</span>
                      {t.priority === "high" && <Badge tone="danger">High priority</Badge>}
                      {t.scope === "platform" && <Badge tone="brand"><ArrowUpRight className="w-3 h-3" /> With StarTrack</Badge>}
                    </div>
                    <div className="text-[11.5px] text-t3 truncate mt-0.5">
                      {[t.customerName, `by ${t.raisedBy.name}`, t.assignedToName ? `→ ${t.assignedToName}` : "unassigned", fmtDateTime(t.updatedAt)]
                        .filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
                </button>
              );
            })}
          </div>
          <Pager
            page={data!.page} pages={data!.pages} total={data!.total}
            from={(data!.page - 1) * PAGE + 1} to={(data!.page - 1) * PAGE + tickets.length}
            onPage={setPage} noun="tickets"
          />
        </Card>
      )}

      <NewTicket open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
      <TicketDetail id={selectedId} canManage={canManage} onClose={() => setSelectedId(null)} onChanged={reload} />
    </div>
  );
}

// ── New ticket ───────────────────────────────────────────────────────

function NewTicket({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ subject: "", description: "", category: "other", priority: "normal", customerName: "", customerPhone: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/tickets", { method: "POST", body: JSON.stringify(form) });
      setForm({ subject: "", description: "", category: "other", priority: "normal", customerName: "", customerPhone: "" });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New ticket" subtitle="A ticket number is assigned automatically">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Subject"><Input autoFocus required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="What's this about?" /></Field>
        <Field label="Details"><TextArea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — anything that helps whoever picks this up" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="complaint">Complaint</option>
              <option value="question">Question</option>
              <option value="billing">Billing</option>
              <option value="technical">Technical</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer" hint="Optional"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="If this is about someone" /></Field>
          <Field label="Their phone" hint="Optional"><Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></Field>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</Button>
      </form>
    </Modal>
  );
}

// ── Detail ───────────────────────────────────────────────────────────

function TicketDetail({ id, canManage, onClose, onChanged }: { id: string | null; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useApi<{ ticket: Ticket }>(id ? `/tickets/${id}` : null, [id]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = data?.ticket;

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim() || !id) return;
    setBusy(true); setError("");
    try {
      await api(`/tickets/${id}/comments`, { method: "POST", body: JSON.stringify({ body: comment.trim() }) });
      setComment("");
      reload();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, any>) {
    if (!id) return;
    setBusy(true); setError("");
    try {
      await api(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      reload();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function escalate() {
    if (!id) return;
    setBusy(true); setError("");
    try {
      await api(`/tickets/${id}/escalate`, { method: "POST" });
      reload();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!id} onClose={onClose} title={t?.ticketNo || "Ticket"} subtitle={t?.subject} wide>
      {loading && !t ? (
        <Spinner />
      ) : !t ? null : (
        <div className="space-y-4">
          <ErrorBanner message={error} />

          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={STATUS_META[t.status].tone}>{STATUS_META[t.status].label}</Badge>
            <Badge tone={PRIORITY_TONE[t.priority]} className="capitalize">{t.priority} priority</Badge>
            <Badge tone="neutral" className="capitalize">{t.category}</Badge>
            {t.scope === "platform" && <Badge tone="brand"><ArrowUpRight className="w-3 h-3" /> With StarTrack support</Badge>}
          </div>

          {t.description && <p className="text-[13px] text-t2 leading-relaxed px-3 py-2.5 rounded-ctl bg-surface-2 border border-line">{t.description}</p>}

          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="flex items-center gap-1.5 text-t3"><User className="w-3.5 h-3.5" /> Raised by {t.raisedBy.name}</div>
            <div className="flex items-center gap-1.5 text-t3"><User className="w-3.5 h-3.5" /> {t.assignedToName ? `Assigned to ${t.assignedToName}` : "Unassigned"}</div>
            {t.customerName && <div className="text-t3 col-span-2">Customer: {t.customerName}{t.customerPhone ? ` · ${t.customerPhone}` : ""}</div>}
          </div>

          {canManage && t.scope !== "platform" && (
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-line">
              {(["open", "in_progress", "resolved", "closed"] as const).map((s) => (
                <button
                  key={s}
                  disabled={busy || t.status === s}
                  onClick={() => patch({ status: s })}
                  className={cn(
                    "h-8 px-3 rounded-ctl border text-[12px] font-semibold transition-colors mt-3",
                    t.status === s ? "bg-primary text-white border-primary" : "border-line-2 text-t2 hover:bg-surface-2 disabled:opacity-50"
                  )}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
              <button onClick={escalate} disabled={busy} className="h-8 px-3 mt-3 rounded-ctl border border-line-2 text-[12px] font-semibold text-primary hover:bg-primary-softer flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5" /> Escalate to StarTrack
              </button>
            </div>
          )}

          <div className="pt-2 border-t border-line">
            <div className="text-[11px] font-medium text-t3 mb-2">Conversation</div>
            {t.comments.length === 0 ? (
              <div className="text-[12px] text-t4 py-3 text-center">No replies yet.</div>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {t.comments.map((c, i) => (
                  <div key={i} className="px-3 py-2 rounded-ctl bg-surface-2 border border-line">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold text-t1">{c.byName}</span>
                      <span className="text-[10px] text-t4">{fmtDateTime(c.at)}</span>
                    </div>
                    <div className="text-[12.5px] text-t2 leading-relaxed whitespace-pre-wrap">{c.body}</div>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={postComment} className="flex items-center gap-2 mt-3">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a reply…" className="flex-1" />
              <Button type="submit" disabled={busy || !comment.trim()}><Send className="w-4 h-4" /></Button>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
}
