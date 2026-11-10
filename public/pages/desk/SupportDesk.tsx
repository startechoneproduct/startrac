import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  Headphones, Inbox, User as UserIcon, UserX, Clock, ListChecks, BarChart3, ArrowLeft, LogOut, Paperclip, Send, FileText,
  Image as ImageIcon, X, Lock, Building2, Mail, Phone, CheckCircle2, Timer, Hourglass, MessageSquare, ChevronDown,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/EmptyState";
import { Select, TextArea } from "@/components/ui/Field";
import { Pager } from "@/components/ui/Pager";
import { api, openFile } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { useOpenParam } from "@/lib/useOpenParam";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, BarChart, EmptyBlock, KpiCard, Panel, Pill, SearchBox, Segmented } from "@/pages/platform/ui";

type Attachment = { fileId: string; name: string; mime: string; size: number };
type Msg = { byId: string; byName: string; body: string; at: string; side: "business" | "startrack"; internal: boolean; attachments: Attachment[] };
type Row = {
  id: string; ref: string; subject: string; description: string; category: string; priority: "low" | "normal" | "high";
  status: "open" | "in_progress" | "resolved" | "closed"; awaiting: "startrack" | "business" | null;
  businessName: string; raisedBy: { userId: string; name: string }; assignee: { id: string; name: string } | null;
  attachments: Attachment[]; messages: number; lastMessageAt: string; escalatedAt: string; firstResponseAt: string | null; createdAt: string;
  comments?: Msg[];
};
type Detail = {
  ticket: Row & { comments: Msg[] };
  business: { name: string; trade: string; plan: string; accountStatus: string; customerSince: string | null; contact: { name: string; email: string; phone: string } };
  history: { id: string; ref: string; subject: string; status: string; at: string }[];
};
type View = "waiting" | "mine" | "unassigned" | "open" | "all";

const VIEWS: { key: View; label: string; icon: typeof Inbox; count?: "waiting" | "mine" | "unassigned" | "open" }[] = [
  { key: "waiting", label: "Waiting on us", icon: Clock, count: "waiting" },
  { key: "mine", label: "Assigned to me", icon: UserIcon, count: "mine" },
  { key: "unassigned", label: "Unassigned", icon: UserX, count: "unassigned" },
  { key: "open", label: "All open", icon: Inbox, count: "open" },
  { key: "all", label: "Everything", icon: ListChecks },
];
const STATUS_LABEL: Record<Row["status"], string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
const STATUS_TONE: Record<Row["status"], "warning" | "brand" | "success" | "neutral"> = { open: "warning", in_progress: "brand", resolved: "success", closed: "neutral" };
const CATEGORY: Record<string, string> = { technical: "Not working", billing: "Plan or payment", question: "How to", complaint: "Complaint", other: "Other" };
const PLAN: Record<string, string> = { free: "Freemium", pro: "Pro", business: "Business", legacy: "Full access" };
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const PER = 20;

function ago(at: string | null) {
  if (!at) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (m < 60) return `${m || 1}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
const hoursLabel = (h: number | null) => (h == null ? "None yet" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h} h` : `${Math.round(h / 24)} days`);

/**
 * StarTrack's support desk, at /desk. Its own frame and workflow, apart from
 * the admin console: a queue of requests businesses sent to StarTrack, the
 * conversation with each, and how the team is doing.
 */
export function SupportDesk() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const { view: page } = useParams();
  const reports = page === "reports";
  // The top bar's back arrow steps back one level at a time: from a chat to
  // the queue, from reports to the queue, and from the queue to the
  // console's Support tab. Never straight out to the dashboard.
  const [openTicket, , closeTicket] = useOpenParam("t");
  const back = openTicket
    ? { label: "Back to the queue", text: "Queue", go: closeTicket }
    : reports
      ? { label: "Back to the queue", text: "Queue", go: () => navigate("/desk") }
      : { label: "Back to the console's support page", text: "Console", go: () => navigate("/admin/support") };

  return (
    <div className="admin-theme h-full flex flex-col bg-canvas">
      <header className="shrink-0 h-14 px-3 sm:px-6 flex items-center gap-2 sm:gap-4 text-white" style={{ background: "var(--st-nav-bg)" }}>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-white/10" title="Support desk"><Headphones className="w-4 h-4" /></span>
          {/* On a phone the icon alone carries the brand; the room goes to the controls. */}
          <div className="leading-tight whitespace-nowrap max-sm:hidden">
            <div className="text-[13.5px] font-semibold">Support desk</div>
            <div className="text-[10.5px] text-white/55">StarTrack</div>
          </div>
        </div>
        <nav className="flex items-center gap-1 sm:ml-2" aria-label="Desk sections">
          {[{ to: "/desk", label: "Queue", icon: Inbox, end: true }, { to: "/desk/reports", label: "Reports", icon: BarChart3, end: false }].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}
              className={({ isActive }) => cn("inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition-colors", isActive ? "bg-white/15 text-white" : "text-white/65 hover:text-white")}>
              <n.icon className="w-4 h-4" /> <span className="max-[419px]:hidden">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Always reachable: on a phone it's just the arrow. */}
          <button type="button" onClick={back.go} aria-label={back.label} title={back.label} className="inline-flex items-center gap-1.5 h-8 px-2 sm:px-3 rounded-lg text-[12.5px] font-semibold text-white/70 hover:text-white"><ArrowLeft className="w-4 h-4" /> <span className="max-sm:hidden">{back.text}</span></button>
          <ThemeToggle className="!text-white/70 hover:!bg-white/10 hover:!text-white" />
          <span className="hidden md:flex items-center gap-2 text-[12.5px] text-white/80"><Avatar name={session?.user.name || "?"} size={28} /> {session?.user.name}</span>
          <button onClick={() => { logout(); navigate("/login", { replace: true }); }} aria-label="Sign out" className="grid place-items-center w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/10"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>
      <div className="flex-1 min-h-0">{reports ? <Reports /> : <Queue />}</div>
    </div>
  );
}

// ── Queue ─────────────────────────────────────────────────────────────

function Queue() {
  // The open ticket is a history step: Back closes the chat and returns to the queue.
  const [selected, openTicket, closeTicket] = useOpenParam("t");
  const [view, setView] = useState<View>("waiting");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);

  const qs = new URLSearchParams({ view, page: String(page), limit: String(PER) });
  if (q) qs.set("q", q);
  if (priority) qs.set("priority", priority);
  const { data, loading } = useApi<{ tickets: Row[]; page: number; pages: number; total: number; counts: Record<string, number> }>(`/desk/tickets?${qs}`, [version]);


  return (
    <div className="h-full flex">
      {/* Views */}
      <aside className="hidden lg:flex w-[210px] shrink-0 flex-col gap-0.5 p-3 border-r border-line bg-surface">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => { setView(v.key); setPage(1); }} aria-pressed={view === v.key}
            className={cn("flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] font-medium text-left transition-colors", view === v.key ? "bg-primary-soft text-primary" : "text-t2 hover:bg-surface-2")}>
            <v.icon className="w-4 h-4 shrink-0" /><span className="flex-1 truncate">{v.label}</span>
            {v.count && <span className="text-[11px] font-semibold tabular-nums text-t3">{data?.counts[v.count] ?? ""}</span>}
          </button>
        ))}
      </aside>

      {/* List */}
      <section className={cn("w-full md:w-[360px] xl:w-[400px] shrink-0 flex-col border-r border-line bg-surface", selected ? "hidden md:flex" : "flex")}>
        <div className="p-3 space-y-2 border-b border-line">
          <div className="lg:hidden">
            <Select value={view} onChange={(e) => { setView(e.target.value as View); setPage(1); }}>
              {VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}{v.count ? ` (${data?.counts[v.count] ?? 0})` : ""}</option>)}
            </Select>
          </div>
          <div className="flex gap-2">
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Reference, subject, business…" className="flex-1" />
            <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="!w-[108px]" aria-label="Priority">
              <option value="">Any priority</option><option value="high">Urgent</option><option value="normal">Normal</option><option value="low">Low</option>
            </Select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && !data ? <div className="py-16"><Spinner /></div> : !data || data.tickets.length === 0 ? (
            <EmptyBlock icon={CheckCircle2} title="Nothing here" hint={view === "waiting" ? "Every business has an answer. Nice work." : "No requests match."} />
          ) : (
            <ul className="divide-y divide-line">
              {data.tickets.map((t) => (
                <li key={t.id}>
                  <button onClick={() => openTicket(t.id)} aria-current={selected === t.id}
                    className={cn("relative w-full text-left px-4 py-3 transition-colors", selected === t.id ? "bg-primary-soft" : "hover:bg-surface-2")}>
                    {t.priority === "high" && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-danger" aria-hidden />}
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11.5px] font-semibold text-primary">{t.ref}</span>
                      {t.awaiting === "startrack" && t.status !== "resolved" && t.status !== "closed" && <span className="w-1.5 h-1.5 rounded-full bg-warning" title="Waiting on StarTrack" />}
                      <span className="ml-auto text-[11px] text-t4 tabular-nums" title={fmtDateTime(t.lastMessageAt)}>{ago(t.lastMessageAt)}</span>
                    </div>
                    <div className="text-[13px] font-semibold text-t1 truncate mt-0.5">{t.subject}</div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11.5px] text-t3 min-w-0">
                      <span className="truncate">{t.businessName}</span>
                      <span>·</span><span className="shrink-0">{CATEGORY[t.category] || t.category}</span>
                      {t.priority === "high" && <><span>·</span><span className="text-danger font-semibold shrink-0">Urgent</span></>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
                      <span className="text-[11px] text-t4 truncate">{t.assignee ? t.assignee.name : "Unassigned"}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data && data.pages > 1 && (
          <Pager page={data.page} pages={data.pages} total={data.total} from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.tickets.length} onPage={setPage} noun="requests" />
        )}
      </section>

      {/* Conversation */}
      <section className={cn("flex-1 min-w-0", selected ? "flex" : "hidden md:flex")}>
        {selected ? <TicketPane key={selected} id={selected} onBack={closeTicket} onChanged={() => setVersion((v) => v + 1)} /> : (
          <div className="m-auto"><EmptyBlock icon={MessageSquare} title="Pick a request" hint="Its conversation and the business's details open here." /></div>
        )}
      </section>
    </div>
  );
}

function TicketPane({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { session } = useSession();
  const { data, loading, error, reload } = useApi<Detail>(`/desk/tickets/${id}`, []);
  const { data: team } = useApi<{ team: { id: string; name: string; role: string }[] }>("/desk/team", []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Phone: the ticket's fields fold into one summary line so the chat keeps the room.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const t = data?.ticket;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [t?.comments.length]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setErr("");
    try { await api(`/desk/tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) }); reload(); onChanged(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (loading && !data) return <div className="m-auto"><Spinner /></div>;
  if (!t || !data) return <div className="m-auto text-[13px] text-danger">{error || "Couldn't open this request."}</div>;
  const b = data.business;
  const file = (a: Attachment) => openFile(`/desk/tickets/${t.id}/files/${a.fileId}`).catch((e) => setErr(e.message));

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="shrink-0 px-4 sm:px-5 py-3 sm:py-3.5 border-b border-line bg-surface">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onBack} className="md:hidden grid place-items-center w-8 h-8 -ml-2 rounded-lg hover:bg-surface-2" aria-label="Back to the queue"><ArrowLeft className="w-4 h-4" /></button>
            <span className="font-mono text-[12px] font-semibold text-primary">{t.ref}</span>
            <Pill tone={STATUS_TONE[t.status]} dot>{STATUS_LABEL[t.status]}</Pill>
            {t.awaiting === "startrack" && t.status !== "resolved" && t.status !== "closed" && <Pill tone="warning">Waiting {ago(t.lastMessageAt)}</Pill>}
          </div>
          <h2 className="text-[16px] font-semibold text-t1 mt-1 truncate">{t.subject}</h2>
          <button
            type="button"
            onClick={() => setFieldsOpen((v) => !v)}
            aria-expanded={fieldsOpen}
            className="sm:hidden mt-2 w-full flex items-center gap-2 h-9 px-3 rounded-ctl border border-line bg-surface-2 text-[12.5px] text-t2 text-left"
          >
            <span className="min-w-0 flex-1 truncate">
              {[STATUS_LABEL[t.status], t.priority === "high" ? "Urgent" : t.priority === "low" ? "Low" : "Normal", CATEGORY[t.category], t.assignee?.name || "Unassigned"].filter(Boolean).join(" · ")}
            </span>
            <ChevronDown className={cn("w-4 h-4 text-t3 shrink-0 transition-transform", fieldsOpen && "rotate-180")} />
          </button>
          <div className={cn("grid grid-cols-2 gap-2 mt-2 sm:mt-2.5 sm:flex sm:items-center sm:flex-wrap", !fieldsOpen && "max-sm:hidden", fieldsOpen && "animate-fade-in")}>
            <Select value={t.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })} className="!w-full sm:!w-[130px] !h-9 sm:!h-8 !text-[12.5px]" aria-label="Status">
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={t.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value })} className="!w-full sm:!w-[110px] !h-9 sm:!h-8 !text-[12.5px]" aria-label="Priority">
              <option value="high">Urgent</option><option value="normal">Normal</option><option value="low">Low</option>
            </Select>
            <Select value={t.category} disabled={busy} onChange={(e) => patch({ category: e.target.value })} className="!w-full sm:!w-[140px] !h-9 sm:!h-8 !text-[12.5px]" aria-label="Category">
              {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={t.assignee?.id || ""} disabled={busy} onChange={(e) => patch({ assigneeId: e.target.value || null })} className="!w-full sm:!w-[160px] !h-9 sm:!h-8 !text-[12.5px]" aria-label="Assigned to">
              <option value="">Unassigned</option>
              {(team?.team || []).map((m) => <option key={m.id} value={m.id}>{m.id === session?.user.id ? `${m.name} (me)` : m.name}</option>)}
            </Select>
            {err && <span className="max-sm:hidden text-[12px] text-danger">{err}</span>}
          </div>
          {err && <div className="sm:hidden mt-1.5 text-[12px] text-danger">{err}</div>}
        </div>

        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3 bg-canvas">
          <DeskBubble side="business" name={t.raisedBy.name} sub={t.businessName} at={t.escalatedAt || t.createdAt} body={t.description || t.subject} files={t.attachments} onFile={file} />
          {t.comments.map((m, i) => <DeskBubble key={i} side={m.side} internal={m.internal} name={m.byName} at={m.at} body={m.body} files={m.attachments} onFile={file} />)}
          <div ref={end} />
        </div>

        <Composer id={t.id} status={t.status} onSent={() => { reload(); onChanged(); }} />
      </div>

      {/* Who is asking */}
      <aside className="hidden xl:block w-[280px] shrink-0 border-l border-line bg-surface overflow-y-auto p-4 space-y-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-t4 mb-2">Business</div>
          <div className="flex items-center gap-2.5">
            <Avatar name={b.name} size={36} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-t1 truncate">{b.name}</div>
              <div className="text-[11.5px] text-t3 truncate">{b.trade}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <Pill tone={b.plan === "free" ? "neutral" : "brand"}>{PLAN[b.plan] || b.plan}</Pill>
            {b.accountStatus === "suspended" && <Pill tone="danger">Suspended</Pill>}
          </div>
          {b.customerSince && <div className="text-[11.5px] text-t3 mt-2 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Customer since {fmtDate(b.customerSince)}</div>}
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-t4 mb-2">Contact</div>
          <div className="text-[13px] font-semibold text-t1">{b.contact.name}</div>
          {b.contact.email && <a href={`mailto:${b.contact.email}`} className="text-[12px] text-primary flex items-center gap-1.5 mt-1 break-all"><Mail className="w-3.5 h-3.5 shrink-0" /> {b.contact.email}</a>}
          {b.contact.phone && <a href={`tel:${b.contact.phone}`} className="text-[12px] text-t2 flex items-center gap-1.5 mt-1"><Phone className="w-3.5 h-3.5 shrink-0" /> {b.contact.phone}</a>}
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-t4 mb-2">Timeline</div>
          <dl className="text-[12px] space-y-1.5">
            <div className="flex justify-between gap-2"><dt className="text-t3">Received</dt><dd className="text-t1">{fmtDateTime(t.escalatedAt || t.createdAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-t3">First reply</dt><dd className="text-t1">{t.firstResponseAt ? fmtDateTime(t.firstResponseAt) : "Not yet"}</dd></div>
          </dl>
        </div>
        {data.history.length > 0 && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-t4 mb-2">Earlier requests</div>
            <ul className="space-y-1.5">
              {data.history.map((h) => (
                <li key={h.id} className="text-[12px]">
                  <Link to={`/desk?t=${h.id}`} className="text-primary font-mono font-semibold">{h.ref}</Link>
                  <span className="text-t2"> {h.subject}</span>
                  <span className="text-t4"> · {STATUS_LABEL[h.status as Row["status"]] || h.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function DeskBubble({ side, internal, name, sub, at, body, files, onFile }: {
  side: "business" | "startrack"; internal?: boolean; name: string; sub?: string; at: string; body: string; files: Attachment[]; onFile: (a: Attachment) => void;
}) {
  const ours = side === "startrack";
  return (
    <div className={cn("flex", ours ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[88%] sm:max-w-[80%] min-w-0 rounded-2xl px-3.5 py-2.5 border",
        internal ? "bg-warning-soft border-warning/40 rounded-br-md" : ours ? "bg-primary text-white border-primary rounded-br-md" : "bg-surface border-line rounded-bl-md")}>
        <div className={cn("flex items-center flex-wrap gap-x-2 gap-y-0.5 mb-0.5 text-[11px]", ours && !internal ? "text-white/75" : "text-t3")}>
          {internal && <Lock className="w-3 h-3 text-warning" />}
          <span className="font-semibold">{name}</span>{sub && <span>· {sub}</span>}<span>{fmtDateTime(at)}</span>
          {internal && <span className="font-semibold text-warning">Internal note</span>}
        </div>
        {body && <div className={cn("text-[13px] leading-relaxed whitespace-pre-wrap break-words", ours && !internal ? "text-white" : "text-t1")}>{body}</div>}
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((a) => (
              <button key={a.fileId} type="button" onClick={() => onFile(a)}
                className={cn("inline-flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11.5px] max-w-[220px] border",
                  ours && !internal ? "bg-white/15 border-white/20 text-white hover:bg-white/25" : "bg-surface-2 border-line text-t2 hover:border-primary hover:text-primary")}>
                {a.mime === "application/pdf" ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}<span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ id, status, onSent }: { id: string; status: Row["status"]; onSent: () => void }) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    setErr("");
    const next = [...files];
    for (const f of Array.from(list || [])) {
      if (!ACCEPT.split(",").includes(f.type)) { setErr(`${f.name}: JPG, PNG, WEBP or PDF only.`); continue; }
      if (f.size > 3 * 1024 * 1024) { setErr(`${f.name} is over 3 MB.`); continue; }
      if (next.length >= 5) { setErr("Up to 5 files at a time."); break; }
      next.push(f);
    }
    setFiles(next);
  }

  async function send(resolve: boolean) {
    if (!body.trim() && !files.length) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("body", body.trim());
      if (mode === "note") fd.append("internal", "true");
      if (resolve) fd.append("status", "resolved");
      files.forEach((f) => fd.append("files", f));
      await api(`/desk/tickets/${id}/reply`, { method: "POST", body: fd });
      setBody(""); setFiles([]);
      onSent();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const note = mode === "note";
  return (
    <div className={cn("shrink-0 border-t p-3 space-y-2", note ? "bg-warning-soft border-warning/40" : "bg-surface border-line")}>
      <div className="flex items-center gap-2">
        <Segmented value={mode} onChange={setMode} options={[{ value: "reply", label: "Reply to business" }, { value: "note", label: "Internal note" }]} />
        <span className="text-[11.5px] text-t3 hidden sm:block">{note ? "Only StarTrack staff see notes." : "The business gets a notification and an email."}</span>
      </div>
      <TextArea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={note ? "Note for the team…" : "Write your reply…"} />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-lg bg-surface-2 border border-line text-[11.5px] text-t2 max-w-[220px]">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, n) => n !== i))} aria-label={`Remove ${f.name}`} className="grid place-items-center w-5 h-5 rounded hover:bg-surface-3"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <Button variant="ghost" size="sm" onClick={() => input.current?.click()}><Paperclip className="w-4 h-4" /> Attach</Button>
        {err && <span className="text-[12px] text-danger">{err}</span>}
        <div className="ml-auto flex gap-2">
          {!note && status !== "resolved" && status !== "closed" && (
            <Button variant="outline" size="sm" disabled={busy || (!body.trim() && !files.length)} onClick={() => send(true)}><CheckCircle2 className="w-4 h-4" /> Send and resolve</Button>
          )}
          <Button size="sm" disabled={busy || (!body.trim() && !files.length)} onClick={() => send(false)}>
            {note ? <Lock className="w-4 h-4" /> : <Send className="w-4 h-4" />} {busy ? "Sending…" : note ? "Add note" : "Send reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Reports ───────────────────────────────────────────────────────────

type Stats = {
  days: number;
  totals: { received: number; resolved: number; open: number; waitingOnUs: number; unassigned: number; medianFirstResponseHours: number | null; medianResolutionHours: number | null; answeredWithin24hPct: number | null; oldestWaitingSince: string | null };
  byCategory: { key: string; count: number }[];
  byPriority: { key: string; count: number }[];
  series: { date: string; created: number; resolved: number }[];
  agents: { name: string; resolved: number; open: number }[];
};

function Reports() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data: s } = useApi<Stats>(`/desk/stats?days=${days}`, []);
  const labels = (s?.series || []).map((d) => fmtDate(d.date));
  const topCat = Math.max(1, ...(s?.byCategory || []).map((c) => c.count));
  const topPri = Math.max(1, ...(s?.byPriority || []).map((c) => c.count));
  const PRI: Record<string, string> = { high: "Urgent", normal: "Normal", low: "Low" };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1280px] mx-auto animate-fade-up">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="font-display text-[30px] leading-tight font-semibold text-t1">How support is doing</h1>
            <p className="text-[13px] text-t3 mt-1">Requests businesses sent to StarTrack in the last {days} days.</p>
          </div>
          <Segmented value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        </div>
        {!s ? <div className="py-20"><Spinner /></div> : (
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard icon={Inbox} tone="brand" label="Requests received" value={s.totals.received.toLocaleString()} sub={`${s.totals.resolved} resolved in the same period`} />
              <KpiCard icon={Clock} tone={s.totals.waitingOnUs ? "warning" : "success"} label="Waiting on us now" value={s.totals.waitingOnUs.toLocaleString()}
                sub={s.totals.oldestWaitingSince ? `Oldest waiting ${ago(s.totals.oldestWaitingSince)}` : "Nobody is waiting"} />
              <KpiCard icon={Timer} tone="brand" label="Typical first reply" value={hoursLabel(s.totals.medianFirstResponseHours)}
                sub={s.totals.answeredWithin24hPct == null ? "No replies yet" : `${s.totals.answeredWithin24hPct}% answered within 24 hours`} />
              <KpiCard icon={Hourglass} tone="neutral" label="Typical time to resolve" value={hoursLabel(s.totals.medianResolutionHours)} sub={`${s.totals.open} open, ${s.totals.unassigned} unassigned`} />
            </div>

            <Panel className="col-span-12 lg:col-span-8" title="Requests received per day" subtitle={`${s.totals.received} in ${days} days`}>
              <BarChart values={s.series.map((d) => d.created)} labels={labels} height={200} color="var(--st-primary)" format={(n) => `${n} received`} />
              <div className="flex justify-between text-[11px] text-t4 mt-2"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
            </Panel>

            <Panel className="col-span-12 lg:col-span-4" title="What businesses ask about">
              <div className="space-y-3">
                {s.byCategory.map((c) => (
                  <div key={c.key}>
                    <div className="flex justify-between text-[12.5px] mb-1.5"><span className="text-t2 font-medium">{CATEGORY[c.key] || c.key}</span><span className="font-semibold text-t1 tabular-nums">{c.count}</span></div>
                    <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${c.count ? Math.max(4, (c.count / topCat) * 100) : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="col-span-12 lg:col-span-8" title="Requests resolved per day" subtitle={`${s.totals.resolved} in ${days} days`}>
              <BarChart values={s.series.map((d) => d.resolved)} labels={labels} height={160} color="var(--st-success)" format={(n) => `${n} resolved`} />
            </Panel>

            <Panel className="col-span-12 lg:col-span-4" title="How urgent">
              <div className="space-y-3">
                {s.byPriority.map((c) => (
                  <div key={c.key}>
                    <div className="flex justify-between text-[12.5px] mb-1.5"><span className="text-t2 font-medium">{PRI[c.key]}</span><span className="font-semibold text-t1 tabular-nums">{c.count}</span></div>
                    <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className={cn("h-full rounded-full transition-all duration-700", c.key === "high" ? "bg-danger" : "bg-primary")} style={{ width: `${c.count ? Math.max(4, (c.count / topPri) * 100) : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="col-span-12" title="The team" subtitle="Resolved in this period, and what each person has open now" flush>
              {s.agents.length === 0 ? <EmptyBlock icon={Headphones} title="No resolved requests yet" hint="Resolved requests are credited to whoever has them assigned." /> : (
                <table className="w-full text-[13px]">
                  <thead><tr className="bg-surface-2 border-b border-line text-[11px] font-bold uppercase tracking-[0.1em] text-t4"><th className="text-left px-5 h-10">Person</th><th className="text-right px-5">Resolved</th><th className="text-right px-5">Open now</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {s.agents.map((a) => (
                      <tr key={a.name}><td className="px-5 py-3"><span className="flex items-center gap-2.5"><Avatar name={a.name} size={28} /><span className="font-semibold text-t1">{a.name}</span></span></td><td className="px-5 text-right tabular-nums text-t1">{a.resolved}</td><td className="px-5 text-right tabular-nums text-t2">{a.open}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
