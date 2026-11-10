import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Banknote, Copy, Download, FileText, Link2, Mail, MessageCircle, Plus, Search, Send, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Modal } from "@/components/ui/Modal";
import { Pager } from "@/components/ui/Pager";
import { api, apiDownload } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDate, fmtMoney, todayStr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "draft" | "issued" | "partial" | "paid" | "void" | "overdue";
type Line = { productId: string | null; name: string; description: string; qty: number; unitPrice: number; lineNet: number };
type Pay = { id: string; method: "cash" | "pos" | "transfer"; amount: number; at: string; by?: string; note?: string };
type Inv = {
  id: string; invoiceNo: string; status: Exclude<Status, "overdue">; displayStatus: Status; daysOverdue: number;
  customerId: string | null; customer: { name?: string; phone?: string; email?: string; address?: string };
  items: Line[]; subtotal: number; discount: number; vatRate: number; vat: number; total: number; amountPaid: number; balance: number;
  issueDate: string; dueDate: string | null; notes: string; terms: string; payments: Pay[];
  sends: { via: string; kind: string; at: string }[]; viewedAt: string | null; viewCount: number; shareUrl: string;
  voidInfo?: { reason?: string; by?: string; at?: string };
};
type Settings = { dueDays: number; terms: string; footer: string; bankName: string; accountName: string; accountNumber: string };
type Summary = { outstanding: number; outstandingCount: number; overdue: number; overdueCount: number; collectedThisMonth: number; drafts: number };

const LABEL: Record<Status, string> = { draft: "Draft", issued: "Sent · unpaid", partial: "Part paid", paid: "Paid", void: "Void", overdue: "Overdue" };
const TONE: Record<Status, "neutral" | "brand" | "warning" | "success" | "danger"> = { draft: "neutral", issued: "brand", partial: "warning", paid: "success", void: "neutral", overdue: "danger" };
const VIEWS = [["all", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Drafts"]] as const;
const PER = 12;

export function Invoices() {
  const { currency, can } = useSession();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; seed?: Inv } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const money = (n: number) => fmtMoney(n, currency, false);

  const { data, loading } = useApi<{ invoices: Inv[]; summary: Summary; page: number; pages: number; total: number }>(
    `/invoices?status=${view}&limit=${PER}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`, [tick]
  );
  const changed = useCallback(() => setTick((n) => n + 1), []);
  const sum = data?.summary;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Invoices"
        subtitle="Bill a customer now, get paid later. Issuing takes the stock out and puts the amount on their account; payments clear it."
        actions={<>{can("settings") && <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="w-4 h-4" /> Settings</Button>}{can("invoices") && <Button onClick={() => setEditing({ id: null })}><Plus className="w-4 h-4" /> New invoice</Button>}</>}
      />

      {sum && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            ["Outstanding", money(sum.outstanding), `${sum.outstandingCount} unpaid`, "text-t1"],
            ["Overdue", money(sum.overdue), `${sum.overdueCount} late`, sum.overdue ? "text-danger" : "text-t1"],
            ["Collected this month", money(sum.collectedThisMonth), "from invoices", "text-success"],
            ["Drafts", String(sum.drafts), "not sent yet", "text-t1"],
          ].map(([l, v, s, c]) => (
            <Card key={l} className="px-4 py-3.5">
              <div className="text-[11.5px] font-medium text-t4">{l}</div>
              <div className={cn("font-mono font-semibold text-[20px] tabular-nums mt-0.5 truncate", c)}>{v}</div>
              <div className="text-[11px] text-t4">{s}</div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Segmented options={VIEWS} value={view} onChange={(k) => { setView(k); setPage(1); }} />
        <div className="relative ml-auto">
          <Search className="w-4 h-4 text-t4 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Invoice no. or customer…" className="!w-64 !pl-9" />
        </div>
      </div>

      {loading && !data ? <div className="py-16"><Spinner /></div> : !data || !data.invoices.length ? (
        <Card><EmptyState icon={FileText} title={q || view !== "all" ? "No invoices match" : "No invoices yet"} body={q || view !== "all" ? "Try another filter." : "Create your first invoice, send it by WhatsApp, email or link, and record payments as they come in."} action={!q && view === "all" && can("invoices") ? <Button onClick={() => setEditing({ id: null })}><Plus className="w-4 h-4" /> New invoice</Button> : undefined} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {data.invoices.map((i) => (
              <button key={i.id} onClick={() => setOpenId(i.id)} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-surface-2 transition-colors" data-testid="invoice-row">
                <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary-soft text-primary shrink-0"><FileText className="w-[18px] h-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12.5px] font-semibold text-primary">{i.invoiceNo || "Draft"}</span>
                    <Badge tone={TONE[i.displayStatus]}>{i.displayStatus === "overdue" ? `Overdue ${i.daysOverdue}d` : LABEL[i.displayStatus]}</Badge>
                  </div>
                  <div className="text-[13px] font-semibold text-t1 truncate mt-0.5">{i.customer.name || "No customer yet"}</div>
                  <div className="text-[11.5px] text-t3">{i.dueDate ? `Due ${fmtDate(i.dueDate)}` : "No due date"}{i.viewCount ? ` · viewed ${i.viewCount}×` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-semibold text-[14px] tabular-nums">{money(i.total)}</div>
                  {i.balance > 0 && i.status !== "draft" && <div className="text-[11.5px] text-warning font-medium">{money(i.balance)} due</div>}
                </div>
              </button>
            ))}
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.invoices.length} onPage={setPage} noun="invoices" />
        </Card>
      )}

      <InvoiceModal id={openId} money={money} onClose={() => setOpenId(null)} onChanged={changed} onEdit={(i) => { setOpenId(null); setEditing({ id: i.id, seed: i }); }} />
      {editing && <Editor key={editing.id || "new"} seed={editing.seed} money={money} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); changed(); setOpenId(id); }} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// ── the invoice, and everything you can do with it ──────────────────────────

function InvoiceModal({ id, money, onClose, onChanged, onEdit }: { id: string | null; money: (n: number) => string; onClose: () => void; onChanged: () => void; onEdit: (i: Inv) => void }) {
  const { data, loading, reload } = useApi<{ invoice: Inv }>(id ? `/invoices/${id}` : null, [id]);
  const { can } = useSession();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pay, setPay] = useState<{ method: Pay["method"]; amount: string; note: string } | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => { setError(""); setNote(""); setPay(null); setVoiding(false); setReason(""); setEmail(null); }, [id]);
  if (!id) return null;
  const inv = data?.invoice;

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key); setError(""); setNote("");
    try { const r = await fn(); reload(); onChanged(); return r; }
    catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  }
  const post = (path: string, body?: unknown) => api<any>(`/invoices/${id}/${path}`, { method: "POST", body: JSON.stringify(body || {}) });

  async function send(via: "whatsapp" | "email" | "link", kind: "invoice" | "reminder" = "invoice") {
    const r = await run(`send-${via}`, () => post("send", { via, kind, ...(via === "email" && email ? { to: email } : {}) }));
    if (!r) return;
    if (via === "whatsapp") window.open(r.whatsappUrl, "_blank", "noopener");
    if (via === "link") { try { await navigator.clipboard.writeText(r.url); setNote("Link copied. Paste it anywhere to share."); } catch { setNote(r.url); } }
    if (via === "email") { if (r.email?.sent) { setNote("Email sent."); setEmail(null); } else setError(r.email?.reason || "The email couldn't be sent."); }
  }

  return (
    <Modal open onClose={onClose} title={inv ? inv.invoiceNo || "Draft invoice" : "Invoice"} subtitle={inv ? `${inv.customer.name || "No customer"} · ${money(inv.total)}` : ""} wide>
      {loading || !inv ? <div className="py-12"><Spinner /></div> : (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          {note && <div className="px-3 py-2 rounded-ctl bg-success-soft text-success text-[12.5px] font-medium">{note}</div>}

          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={TONE[inv.displayStatus]}>{inv.displayStatus === "overdue" ? `Overdue ${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"}` : LABEL[inv.displayStatus]}</Badge>
            {inv.dueDate && <span className="text-[12px] text-t3">Due {fmtDate(inv.dueDate)}</span>}
            {inv.viewedAt && <span className="text-[12px] text-t3">· customer opened it {inv.viewCount}×</span>}
          </div>

          <div className="rounded-xl border border-line overflow-hidden">
            {inv.items.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-line last:border-0 text-[13px]">
                <span className="text-t1 font-medium">{l.name} <span className="text-t3">× {l.qty}</span>{l.description && <span className="block text-[11.5px] text-t3 font-normal">{l.description}</span>}</span>
                <span className="font-mono tabular-nums text-t1">{money(l.lineNet)}</span>
              </div>
            ))}
            <div className="px-3.5 py-2.5 bg-surface-2 text-[13px] space-y-1">
              <div className="flex justify-between text-t3"><span>Subtotal</span><span className="font-mono">{money(inv.subtotal)}</span></div>
              {inv.discount > 0 && <div className="flex justify-between text-t3"><span>Discount</span><span className="font-mono">−{money(inv.discount)}</span></div>}
              {inv.vat > 0 && <div className="flex justify-between text-t3"><span>VAT ({inv.vatRate}%)</span><span className="font-mono">{money(inv.vat)}</span></div>}
              <div className="flex justify-between font-semibold text-t1 text-[14px]"><span>Total</span><span className="font-mono">{money(inv.total)}</span></div>
              {inv.status !== "draft" && inv.status !== "void" && <>
                <div className="flex justify-between text-success"><span>Paid</span><span className="font-mono">−{money(inv.amountPaid)}</span></div>
                <div className="flex justify-between font-semibold text-t1 text-[14px]" data-testid="balance"><span>Balance due</span><span className="font-mono">{money(inv.balance)}</span></div>
              </>}
            </div>
          </div>

          {inv.status === "void" && <div className="rounded-xl bg-surface-3 text-t2 px-3.5 py-2.5 text-[13px]">Voided{inv.voidInfo?.by ? ` by ${inv.voidInfo.by}` : ""}: {inv.voidInfo?.reason}</div>}

          {/* draft: edit, issue, delete */}
          {inv.status === "draft" && can("invoices") && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => run("issue", () => post("issue"))} disabled={!!busy}><Send className="w-4 h-4" /> {busy === "issue" ? "Issuing…" : "Issue invoice"}</Button>
              <Button variant="outline" onClick={() => onEdit(inv)} disabled={!!busy}>Edit</Button>
              <Button variant="ghost" onClick={async () => { if (await run("del", () => api(`/invoices/${id}`, { method: "DELETE" }))) onClose(); }} disabled={!!busy}><Trash2 className="w-4 h-4" /> Delete</Button>
              <span className="text-[11.5px] text-t4 basis-full">Issuing numbers the invoice, takes the items out of stock and puts the amount on {inv.customer.name || "the customer"}'s account.</span>
            </div>
          )}

          {/* issued: collect + deliver */}
          {["issued", "partial"].includes(inv.status) && (
            <>
              {!pay ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {can("invoice_payments") && <Button onClick={() => setPay({ method: "transfer", amount: String(inv.balance), note: "" })}><Banknote className="w-4 h-4" /> Record payment</Button>}
                  {inv.balance > 0 && <Button variant="outline" onClick={() => send("whatsapp", "reminder")} disabled={!!busy}><MessageCircle className="w-4 h-4" /> Send reminder</Button>}
                </div>
              ) : (
                <div className="rounded-xl border border-line p-3.5 space-y-3 bg-surface-2">
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Field label="Amount"><Input type="number" min={0} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} aria-label="Payment amount" /></Field>
                    <Field label="Paid by"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as Pay["method"] })} aria-label="Payment method"><option value="transfer">Transfer</option><option value="cash">Cash</option><option value="pos">POS</option></Select></Field>
                    <Field label="Note (optional)"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="e.g. deposit" /></Field>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={async () => { if (await run("pay", () => post("payments", { method: pay.method, amount: Number(pay.amount), note: pay.note }))) setPay(null); }} disabled={!!busy || !(Number(pay.amount) > 0)}>{busy === "pay" ? "Saving…" : "Save payment"}</Button>
                    <Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {inv.status !== "draft" && inv.status !== "void" && (
            <div className="rounded-xl border border-line p-3.5 space-y-3">
              <div className="text-[12px] font-semibold text-t1">Send to {inv.customer.name || "customer"}</div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={() => send("whatsapp")} disabled={!!busy}><MessageCircle className="w-4 h-4" /> WhatsApp</Button>
                <Button variant="secondary" size="sm" onClick={() => (email === null ? setEmail(inv.customer.email || "") : setEmail(null))} disabled={!!busy}><Mail className="w-4 h-4" /> Email</Button>
                <Button variant="secondary" size="sm" onClick={() => send("link")} disabled={!!busy}><Link2 className="w-4 h-4" /> Copy link</Button>
                <Button variant="secondary" size="sm" onClick={() => run("pdf", () => apiDownload(`/invoices/${id}/pdf`, `${inv.invoiceNo}.pdf`))} disabled={!!busy}><Download className="w-4 h-4" /> PDF</Button>
              </div>
              {email !== null && (
                <div className="flex gap-2"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" aria-label="Email address" /><Button size="sm" onClick={() => send("email")} disabled={!!busy || !email}>{busy === "send-email" ? "Sending…" : "Send"}</Button></div>
              )}
              {inv.sends.length > 0 && <div className="text-[11.5px] text-t3">Sent: {inv.sends.map((s) => `${s.kind === "reminder" ? "reminder via " : ""}${s.via} ${fmtDate(s.at)}`).join(" · ")}</div>}
            </div>
          )}

          {inv.payments.length > 0 && (
            <div>
              <div className="text-[12px] font-semibold text-t1 mb-2">Payments received</div>
              <ul className="space-y-1.5">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-[12.5px] text-t2">
                    <span className="text-t4 w-[100px] shrink-0">{fmtDate(p.at)}</span>
                    <span className="font-mono font-semibold text-t1">{money(p.amount)}</span>
                    <span className="capitalize">{p.method}</span>{p.note && <span className="text-t3">· {p.note}</span>}
                    {inv.status !== "void" && can("invoices_void") && <button className="ml-auto text-[11.5px] text-t4 hover:text-danger" onClick={() => { if (confirm("Remove this payment? The balance goes back up.")) run("rm", () => api(`/invoices/${id}/payments/${p.id}`, { method: "DELETE" })); }}>Remove</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {["issued", "partial", "paid"].includes(inv.status) && can("invoices_void") && (
            !voiding ? (
              <button className="text-[12px] text-t4 hover:text-danger inline-flex items-center gap-1" onClick={() => setVoiding(true)}><Ban className="w-3.5 h-3.5" /> Void this invoice</button>
            ) : (
              <div className="space-y-2 rounded-xl border border-danger/30 p-3.5">
                <p className="text-[12px] text-t3">Voiding puts the items back in stock and clears the amount from {inv.customer.name || "the customer"}'s account. It can't be undone.</p>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being voided?" aria-label="Reason for voiding" autoFocus />
                <div className="flex gap-2"><Button variant="danger" size="sm" onClick={() => run("void", () => post("void", { reason }))} disabled={!!busy || reason.trim().length < 3}>{busy === "void" ? "Voiding…" : "Void invoice"}</Button><Button variant="ghost" size="sm" onClick={() => setVoiding(false)}>Back</Button></div>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

// ── creating and editing a draft ────────────────────────────────────────────

type Row = { key: number; productId: string | null; name: string; description: string; qty: string; unitPrice: string };
type CatalogProduct = { id: string; name: string; price: number; stock: number | null };

function Editor({ seed, money, onClose, onSaved }: { seed?: Inv; money: (n: number) => string; onClose: () => void; onSaved: (id: string) => void }) {
  const { activeBranch } = useSession();
  const { data: cfg } = useApi<{ settings: { dueDays: number; terms: string }; vatEnabled: boolean; vatRate: number }>("/invoices/settings");
  const { data: prods } = useApi<{ products: CatalogProduct[] }>("/products", [activeBranch?.id]);
  const [cust, setCust] = useState({ name: seed?.customer.name || "", phone: seed?.customer.phone || "", email: seed?.customer.email || "", address: seed?.customer.address || "" });
  const [customerId, setCustomerId] = useState<string | null>(seed?.customerId || null);
  const [custQ, setCustQ] = useState("");
  const { data: found } = useApi<{ customers: { id: string; name: string; phone: string; email: string; address?: string }[] }>(custQ.trim().length >= 2 ? `/customers?q=${encodeURIComponent(custQ.trim())}` : null, [custQ]);
  const [rows, setRows] = useState<Row[]>(() => seed ? seed.items.map((l, i) => ({ key: i, productId: l.productId, name: l.name, description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice) })) : []);
  const [discountPct, setDiscountPct] = useState(seed && seed.subtotal ? String(+((seed.discount / seed.subtotal) * 100).toFixed(2)) : "");
  const [applyVat, setApplyVat] = useState(seed ? seed.vat > 0 : false);
  const [dueDate, setDueDate] = useState(seed?.dueDate ? seed.dueDate.slice(0, 10) : "");
  const [notes, setNotes] = useState(seed?.notes || "");
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nextKey = useMemo(() => ({ n: 100 }), []);

  const products = prods?.products ?? [];
  const matches = pick.trim() ? products.filter((p) => p.name.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 6) : [];
  const sub = rows.reduce((n, r) => n + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  const disc = Math.min(sub, sub * ((Number(discountPct) || 0) / 100));
  const vat = applyVat && cfg?.vatEnabled ? (sub - disc) * ((cfg.vatRate || 0) / 100) : 0;
  const total = sub - disc + vat;

  const addProduct = (p: CatalogProduct) => { setRows((r) => [...r, { key: nextKey.n++, productId: p.id, name: p.name, description: "", qty: "1", unitPrice: String(p.price) }]); setPick(""); };
  const addCustom = () => { setRows((r) => [...r, { key: nextKey.n++, productId: null, name: pick.trim(), description: "", qty: "1", unitPrice: "" }]); setPick(""); };
  const patch = (key: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function save() {
    setSaving(true); setError("");
    const body = {
      customerId, customer: cust,
      items: rows.map((r) => ({ ...(r.productId ? { productId: r.productId } : { name: r.name }), description: r.description || undefined, qty: Number(r.qty), unitPrice: Number(r.unitPrice) })),
      discountPct: Number(discountPct) || 0, applyVat, dueDate: dueDate || null, notes,
    };
    try {
      const r = seed
        ? await api<{ invoice: Inv }>(`/invoices/${seed.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await api<{ invoice: Inv }>("/invoices", { method: "POST", body: JSON.stringify(body) });
      onSaved(r.invoice.id);
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  const ready = rows.length > 0 && rows.every((r) => Number(r.qty) > 0 && r.unitPrice !== "" && Number(r.unitPrice) >= 0 && r.name.trim());

  return (
    <Modal open onClose={onClose} title={seed ? "Edit draft" : "New invoice"} subtitle="Saved as a draft. Nothing changes in stock until you issue it." wide>
      <div className="space-y-5">
        <ErrorBanner message={error} />

        <section className="space-y-3">
          <div className="text-[12px] font-semibold text-t1">Bill to</div>
          <div className="relative">
            <Input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Find an existing customer…" aria-label="Find a customer" />
            {found && found.customers.length > 0 && custQ.trim().length >= 2 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-line bg-surface shadow-lg overflow-hidden">
                {found.customers.slice(0, 5).map((c) => (
                  <button key={c.id} type="button" className="w-full text-left px-3.5 py-2 text-[13px] hover:bg-surface-2" onClick={() => { setCustomerId(c.id); setCust({ name: c.name, phone: c.phone || "", email: c.email || "", address: c.address || "" }); setCustQ(""); }}>
                    <span className="font-semibold text-t1">{c.name}</span> <span className="text-t3">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name"><Input value={cust.name} onChange={(e) => { setCust({ ...cust, name: e.target.value }); setCustomerId(null); }} aria-label="Customer name" /></Field>
            <Field label="Phone / WhatsApp"><Input value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} aria-label="Customer phone" /></Field>
            <Field label="Email"><Input type="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} aria-label="Customer email" /></Field>
            <Field label="Address"><Input value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} aria-label="Customer address" /></Field>
          </div>
          {customerId && <p className="text-[11.5px] text-t3">Linked to an existing customer. The amount goes on their account.</p>}
        </section>

        <section className="space-y-3">
          <div className="text-[12px] font-semibold text-t1">Items</div>
          <div className="relative">
            <Input value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Search a product, or type a service / fee and add it…" aria-label="Add an item" />
            {pick.trim() && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-line bg-surface shadow-lg overflow-hidden">
                {matches.map((p) => (
                  <button key={p.id} type="button" className="w-full flex justify-between px-3.5 py-2 text-[13px] hover:bg-surface-2" onClick={() => addProduct(p)}>
                    <span className="font-semibold text-t1">{p.name}{p.stock !== null && <span className="text-t4 font-normal"> · {p.stock} in stock</span>}</span><span className="font-mono text-t2">{money(p.price)}</span>
                  </button>
                ))}
                <button type="button" className="w-full text-left px-3.5 py-2 text-[13px] text-primary font-semibold hover:bg-surface-2 border-t border-line" onClick={addCustom}>+ Add “{pick.trim()}” as a service / custom line</button>
              </div>
            )}
          </div>
          {rows.length === 0 ? <p className="text-[12.5px] text-t3">No items yet.</p> : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[1fr_72px_110px_auto] gap-2 items-start" data-testid="invoice-line">
                  <div><div className="text-[13px] font-medium text-t1 h-10 flex items-center">{r.name}{!r.productId && <Badge tone="neutral" className="ml-2">custom</Badge>}</div></div>
                  <Input type="number" min={0} value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value })} aria-label={`Quantity for ${r.name}`} />
                  <Input type="number" min={0} value={r.unitPrice} onChange={(e) => patch(r.key, { unitPrice: e.target.value })} aria-label={`Price for ${r.name}`} placeholder="Price" />
                  <button type="button" className="h-10 w-9 grid place-items-center text-t4 hover:text-danger" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} aria-label={`Remove ${r.name}`}><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid sm:grid-cols-3 gap-3">
          <Field label="Discount %"><Input type="number" min={0} max={100} value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} aria-label="Discount percent" /></Field>
          <Field label="Due date" hint={cfg ? `Blank = ${cfg.settings.dueDays} days from issue` : undefined}><Input type="date" min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" /></Field>
          {cfg?.vatEnabled && <label className="flex items-center gap-2 text-[13px] text-t2 sm:mt-7"><input type="checkbox" checked={applyVat} onChange={(e) => setApplyVat(e.target.checked)} /> Add VAT ({cfg.vatRate}%)</label>}
        </section>
        <Field label="Note to the customer (optional)"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery details, thank-you, anything they should know" /></Field>

        <div className="rounded-xl bg-surface-2 border border-line px-4 py-3 text-[13px] space-y-1">
          <div className="flex justify-between text-t3"><span>Subtotal</span><span className="font-mono">{money(sub)}</span></div>
          {disc > 0 && <div className="flex justify-between text-t3"><span>Discount</span><span className="font-mono">−{money(disc)}</span></div>}
          {vat > 0 && <div className="flex justify-between text-t3"><span>VAT</span><span className="font-mono">{money(vat)}</span></div>}
          <div className="flex justify-between font-semibold text-t1 text-[15px]"><span>Total</span><span className="font-mono" data-testid="editor-total">{money(total)}</span></div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !ready}>{saving ? "Saving…" : "Save draft"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── defaults: terms, bank details ───────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { data, loading } = useApi<{ settings: Settings }>("/invoices/settings");
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setS(data.settings); }, [data]);

  async function save() {
    if (!s) return;
    setSaving(true); setError("");
    try { await api("/invoices/settings", { method: "PUT", body: JSON.stringify({ ...s, dueDays: Number(s.dueDays) || 0 }) }); onClose(); }
    catch (e: any) { setError(e.message); setSaving(false); }
  }
  const set = (k: string, v: string) => setS((x) => (x ? { ...x, [k]: v } : x));

  return (
    <Modal open onClose={onClose} title="Invoice settings" subtitle="Defaults for every new invoice, and how customers pay you.">
      {loading || !s ? <div className="py-10"><Spinner /></div> : (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Payment due after (days)"><Input type="number" min={0} value={s.dueDays} onChange={(e) => set("dueDays", e.target.value)} aria-label="Due days" /></Field>
            <Field label="Footer line"><Input value={s.footer} onChange={(e) => set("footer", e.target.value)} placeholder="Thank you for your business." /></Field>
          </div>
          <Field label="Terms (printed on every invoice)"><TextArea rows={2} value={s.terms} onChange={(e) => set("terms", e.target.value)} placeholder="e.g. Goods remain ours until paid in full." /></Field>
          <div className="text-[12px] font-semibold text-t1 pt-1">Where customers pay</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Bank"><Input value={s.bankName} onChange={(e) => set("bankName", e.target.value)} aria-label="Bank name" /></Field>
            <Field label="Account name"><Input value={s.accountName} onChange={(e) => set("accountName", e.target.value)} aria-label="Account name" /></Field>
            <Field label="Account number"><Input value={s.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} aria-label="Account number" /></Field>
          </div>
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
          <p className="text-[11.5px] text-t4 flex items-center gap-1"><Copy className="w-3 h-3" /> Left blank, your online store's bank details are used if you've set them.</p>
        </div>
      )}
    </Modal>
  );
}
