import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LifeBuoy, Plus, Paperclip, Send, X, FileText, Image as ImageIcon, Headphones, Bug, CreditCard, HelpCircle, MessageSquareWarning, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pager, ROWS_PER_PAGE } from "@/components/ui/Pager";
import { api, openFile } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Attachment = { fileId: string; name: string; mime: string; size: number };
type Message = { byId: string; byName: string; body: string; at: string; side: "business" | "startrack"; attachments: Attachment[] };
type Request = {
  id: string; ref: string; ticketNo: string; subject: string; description: string;
  category: "complaint" | "question" | "billing" | "technical" | "other";
  priority: "low" | "normal" | "high";
  status: "open" | "in_progress" | "resolved" | "closed";
  awaiting: "startrack" | "business" | null; supportAgent: string;
  raisedBy: { userId: string; name: string };
  comments: Message[]; attachments: Attachment[];
  escalatedAt: string | null; createdAt: string; updatedAt: string;
};

const CATEGORIES = [
  { value: "technical", label: "Something isn't working", icon: Bug },
  { value: "billing", label: "Plan or payment", icon: CreditCard },
  { value: "question", label: "How do I…?", icon: HelpCircle },
  { value: "complaint", label: "A complaint", icon: MessageSquareWarning },
  { value: "other", label: "Something else", icon: MoreHorizontal },
] as const;
const STATUS: Record<Request["status"], { label: string; tone: "warning" | "brand" | "success" | "neutral" }> = {
  open: { label: "Sent", tone: "warning" },
  in_progress: { label: "Being worked on", tone: "brand" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_FILES = 5;
const MAX_BYTES = 3 * 1024 * 1024;
const PAGE = ROWS_PER_PAGE;

const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Picks screenshots or PDFs, checking type, size and count before anything is sent. */
function useFilePick() {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  function add(list: FileList | null) {
    setError("");
    const next = [...files];
    for (const f of Array.from(list || [])) {
      if (!ACCEPT.split(",").includes(f.type)) { setError(`${f.name}: attach screenshots or photos (JPG, PNG, WEBP) or PDFs.`); continue; }
      if (f.size > MAX_BYTES) { setError(`${f.name} is over 3 MB.`); continue; }
      if (next.length >= MAX_FILES) { setError(`Up to ${MAX_FILES} files at a time.`); break; }
      next.push(f);
    }
    setFiles(next);
  }
  return { files, error, add, remove: (i: number) => setFiles(files.filter((_, n) => n !== i)), clear: () => { setFiles([]); setError(""); } };
}

function FileChips({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-lg bg-surface-2 border border-line text-[11.5px] text-t2 max-w-[220px]">
          {f.type === "application/pdf" ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`} className="grid place-items-center w-5 h-5 rounded hover:bg-surface-3"><X className="w-3 h-3" /></button>
        </span>
      ))}
    </div>
  );
}

function Attachments({ ticketId, items, tone = "light" }: { ticketId: string; items: Attachment[]; tone?: "light" | "dark" }) {
  const [err, setErr] = useState("");
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((a) => (
        <button
          key={a.fileId} type="button"
          onClick={() => openFile(`/tickets/${ticketId}/files/${a.fileId}`).catch((e) => setErr(e.message))}
          className={cn("inline-flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11.5px] max-w-[220px] border transition-colors",
            tone === "dark" ? "bg-white/15 border-white/20 text-white hover:bg-white/25" : "bg-surface border-line text-t2 hover:border-primary hover:text-primary")}
        >
          {a.mime === "application/pdf" ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">{a.name}</span><span className="opacity-60 shrink-0">{sizeLabel(a.size)}</span>
        </button>
      ))}
      {err && <span className="text-[11px] text-danger self-center">{err}</span>}
    </div>
  );
}

/**
 * Help from StarTrack: requests this business has sent to StarTrack's support
 * team, and the conversation on each. Separate from Internal tickets, which
 * the business's own staff work among themselves.
 */
export function Help() {
  const { activeBranch } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"active" | "done">("active");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A notification click (?open=<id>) goes straight to the conversation.
  useEffect(() => {
    const open = searchParams.get("open");
    if (open) {
      setSelectedId(open);
      searchParams.delete("open");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, loading, reload } = useApi<{ tickets: Request[]; page: number; pages: number; total: number; statusCounts: Record<string, number> }>(
    `/tickets?scope=platform&status=${view}&page=${page}&limit=${PAGE}`, [activeBranch?.id]
  );
  const list = data?.tickets || [];
  const c = data?.statusCounts || {};
  const activeCount = (c.open || 0) + (c.in_progress || 0);
  const doneCount = (c.resolved || 0) + (c.closed || 0);

  return (
    <div className="p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader
        title="Help from StarTrack"
        subtitle="Ask the StarTrack team for help. Every request gets a reference and you can follow the conversation here."
        actions={<Button onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New request</Button>}
      />

      <div className="flex gap-1 p-1 rounded-ctl bg-surface-2 border border-line w-fit mb-4">
        {([["active", "Open", activeCount], ["done", "Resolved", doneCount]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => { setView(k); setPage(1); }}
            className={cn("flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12.5px] font-semibold transition-colors", view === k ? "bg-primary text-white" : "text-t3 hover:text-t1")}>
            {label}{n > 0 && <span className={cn("text-[10px] px-1.5 rounded-full", view === k ? "bg-white/20" : "bg-surface-3")}>{n}</span>}
          </button>
        ))}
      </div>

      {loading && !data ? <Spinner /> : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Headphones}
            title={view === "active" ? "No open requests" : "Nothing resolved yet"}
            body={view === "active" ? "If something isn't working, or you have a question about StarTrack, send a request and the team will reply here." : "Requests StarTrack has resolved will appear here."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {list.map((t) => {
              const replied = t.awaiting === "business" && (t.status === "open" || t.status === "in_progress");
              return (
                <button key={t.id} onClick={() => setSelectedId(t.id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2 transition-colors">
                  <span className={cn("w-9 h-9 shrink-0 rounded-xl grid place-items-center", replied ? "bg-primary text-white" : "bg-primary-soft text-primary")}><LifeBuoy className="w-[18px] h-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[12px] font-semibold text-primary">{t.ref}</span>
                      <span className="text-[13px] font-semibold text-t1 truncate">{t.subject}</span>
                      {replied && <Badge tone="brand">StarTrack replied</Badge>}
                    </div>
                    <div className="text-[11.5px] text-t3 truncate mt-0.5">
                      {[CATEGORIES.find((x) => x.value === t.category)?.label, `by ${t.raisedBy.name}`, t.supportAgent ? `with ${t.supportAgent}` : "", fmtDateTime(t.updatedAt)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Badge tone={STATUS[t.status].tone} className="shrink-0">{STATUS[t.status].label}</Badge>
                </button>
              );
            })}
          </div>
          {data && data.pages > 1 && (
            <Pager page={data.page} pages={data.pages} total={data.total} from={(data.page - 1) * PAGE + 1} to={(data.page - 1) * PAGE + list.length} onPage={setPage} noun="requests" />
          )}
        </Card>
      )}

      <NewRequest open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); reload(); setSelectedId(id); }} />
      <Conversation id={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
    </div>
  );
}

function NewRequest({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const blank = { subject: "", description: "", category: "technical", priority: "normal" };
  const [form, setForm] = useState(blank);
  const pick = useFilePick();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { ticket } = await api<{ ticket: Request }>("/tickets", { method: "POST", body: JSON.stringify({ ...form, toStarTrack: true }) });
      if (pick.files.length) {
        const fd = new FormData();
        pick.files.forEach((f) => fd.append("files", f));
        await api(`/tickets/${ticket.id}/attachments`, { method: "POST", body: fd }).catch((err) => {
          // The request itself is in; say what happened to the files rather than losing it.
          throw new Error(`Request ${ticket.ref} was sent, but the files weren't: ${err.message}`);
        });
      }
      setForm(blank); pick.clear();
      onSaved(ticket.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ask StarTrack for help" subtitle="You'll get a reference number and a reply here, plus an email when the team answers" wide>
      <form onSubmit={save} className="space-y-4">
        <ErrorBanner message={error} />
        <div>
          <div className="text-[12px] font-semibold text-t2 mb-1.5">What is it about?</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="radiogroup">
            {CATEGORIES.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={form.category === c.value} onClick={() => setForm({ ...form, category: c.value })}
                className={cn("flex flex-col items-start gap-1.5 p-2.5 rounded-xl border text-left text-[12px] font-semibold transition-colors",
                  form.category === c.value ? "border-primary bg-primary-soft text-primary" : "border-line text-t2 hover:border-line-2")}>
                <c.icon className="w-4 h-4" />{c.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Subject"><Input required minLength={2} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Receipt printer prints blank pages" /></Field>
        <Field label="Describe the problem" hint="What happened, what you expected, and when it started">
          <TextArea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="The more detail, the faster we can help." />
        </Field>
        <div className="grid sm:grid-cols-[180px_1fr] gap-3 items-start">
          <Field label="How urgent?">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Not urgent</option>
              <option value="normal">Normal</option>
              <option value="high">Urgent, it stops my work</option>
            </Select>
          </Field>
          <div>
            <div className="text-[12px] font-semibold text-t2 mb-1.5">Screenshots or documents</div>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { pick.add(e.target.files); e.target.value = ""; }} />
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={pick.files.length >= MAX_FILES}><Paperclip className="w-4 h-4" /> Attach files</Button>
              <span className="text-[11.5px] text-t4">JPG, PNG, WEBP or PDF, up to 3 MB each</span>
            </div>
            <div className="mt-2"><FileChips files={pick.files} onRemove={pick.remove} /></div>
            {pick.error && <div className="text-[11.5px] text-danger mt-1">{pick.error}</div>}
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send to StarTrack"}</Button>
      </form>
    </Modal>
  );
}

function Conversation({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession();
  const { data, loading, reload } = useApi<{ ticket: Request }>(id ? `/tickets/${id}` : null, [id]);
  const [body, setBody] = useState("");
  const pick = useFilePick();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const t = data?.ticket;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [t?.comments.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!id || (!body.trim() && !pick.files.length)) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("body", body.trim());
      pick.files.forEach((f) => fd.append("files", f));
      await api(`/tickets/${id}/comments`, { method: "POST", body: fd });
      setBody(""); pick.clear();
      reload(); onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const closed = t && (t.status === "resolved" || t.status === "closed");
  return (
    <Modal open={!!id} onClose={onClose} title={t ? `${t.ref} · ${t.subject}` : "Request"} subtitle={t ? `${STATUS[t.status].label}${t.supportAgent ? ` · with ${t.supportAgent}` : ""}` : undefined} wide>
      {loading && !t ? <Spinner /> : !t ? null : (
        <div className="space-y-3">
          <ErrorBanner message={error} />
          <div className="max-h-[52vh] overflow-y-auto pr-1 space-y-3">
            {/* The request itself opens the conversation. */}
            <Bubble mine={t.raisedBy.userId === session?.user.id} name={t.raisedBy.name} at={t.escalatedAt || t.createdAt} body={t.description || t.subject}>
              <Attachments ticketId={t.id} items={t.attachments} tone={t.raisedBy.userId === session?.user.id ? "dark" : "light"} />
            </Bubble>
            {t.comments.map((m, i) => (
              <Bubble key={i} mine={m.side === "business" && m.byId === session?.user.id} startrack={m.side === "startrack"} name={m.byName} at={m.at} body={m.body}>
                <Attachments ticketId={t.id} items={m.attachments} tone={m.side === "business" && m.byId === session?.user.id ? "dark" : "light"} />
              </Bubble>
            ))}
            {t.awaiting === "startrack" && !closed && <div className="text-center text-[11.5px] text-t4 py-1">Waiting for StarTrack to reply. You'll get a notification and an email.</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="pt-3 border-t border-line space-y-2">
            {closed && <div className="text-[12px] text-t3">This request is {t.status}. Replying opens it again.</div>}
            <TextArea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply…" />
            <FileChips files={pick.files} onRemove={pick.remove} />
            {pick.error && <div className="text-[11.5px] text-danger">{pick.error}</div>}
            <div className="flex items-center gap-2">
              <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { pick.add(e.target.files); e.target.value = ""; }} />
              <Button type="button" variant="ghost" size="sm" onClick={() => input.current?.click()} aria-label="Attach files"><Paperclip className="w-4 h-4" /> Attach</Button>
              <Button type="submit" size="sm" className="ml-auto" disabled={busy || (!body.trim() && !pick.files.length)}><Send className="w-4 h-4" /> {busy ? "Sending…" : "Send"}</Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

function Bubble({ mine, startrack, name, at, body, children }: { mine?: boolean; startrack?: boolean; name: string; at: string; body: string; children?: React.ReactNode }) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5",
        mine ? "bg-primary text-white rounded-br-md" : startrack ? "bg-surface-2 border border-primary/30 rounded-bl-md" : "bg-surface-2 border border-line rounded-bl-md")}>
        <div className={cn("flex items-center gap-2 mb-0.5 text-[11px]", mine ? "text-white/75" : "text-t3")}>
          {startrack && <Headphones className="w-3 h-3 text-primary" />}
          <span className="font-semibold">{name}</span><span>{fmtDateTime(at)}</span>
        </div>
        {body && <div className={cn("text-[13px] leading-relaxed whitespace-pre-wrap", mine ? "text-white" : "text-t1")}>{body}</div>}
        {children}
      </div>
    </div>
  );
}
