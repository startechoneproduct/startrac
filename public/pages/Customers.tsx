import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Plus, Upload, Search, Phone, ChevronRight, Coins, Truck, HandCoins, QrCode, Copy, Check, MessageCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { SpreadsheetImport } from "@/components/import/SpreadsheetImport";
import { requestUpgrade } from "@/components/plan/PlanUi";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDate, fmtMoney, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { qrDataUrl } from "@/lib/qrcode";
import { toIntlPhone } from "@/lib/phone";

type Customer = {
  id: string; name: string; phone: string; whatsapp: string; notes: string;
  totalSpend: number; visits: number; firstSeen: string; lastSeen: string;
  creditBalance: number;
  source?: "pos" | "website"; email?: string; address?: string;
};
type LedgerEntry = {
  id: string; type: "sale" | "payment" | "adjustment"; amount: number; balanceAfter: number;
  method?: string; refType: string; note: string; byName: string; at: string;
};
type CustomerSale = { id: string; saleNo: string; at: string; total: number; status: string; summary: string };
type LoyaltyStatus = { sachetBagQty: number; tokens: number; tokensRedeemed: number; redeemable: number };
type SupplySchedule = { interval: "none" | "daily" | "weekly" | "biweekly" | "monthly"; nextDueAt: string | null };

export function Customers() {
  const { currency, hasCapability, hasModule, hasFeature } = useSession();
  const creditOn = hasCapability("credit");
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [debtorsOnly, setDebtorsOnly] = useState(false);
  const [websiteOnly, setWebsiteOnly] = useState(false);

  // The header's global search lands here with ?q= — keep the box in sync.
  useEffect(() => {
    const fromUrl = searchParams.get("q");
    if (fromUrl !== null) setQ(fromUrl);
  }, [searchParams]);
  const query = [q && `q=${encodeURIComponent(q)}`, debtorsOnly && "debtorsOnly=1", websiteOnly && "source=website"].filter(Boolean).join("&");
  const { data, loading, reload } = useApi<{ customers: Customer[]; totalOutstanding: number; usage?: { count: number; cap: number | null } }>(
    `/customers${query ? `?${query}` : ""}`,
    [q, debtorsOnly, websiteOnly]
  );
  const customers = data?.customers || [];
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const paged = usePaged(customers);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Customers"
        subtitle="Everyone who's bought from you — built automatically from sales"
        actions={
          <>
            <Button variant="secondary" onClick={() => (hasFeature("csvImport") ? setImporting(true) : requestUpgrade("csvImport"))}><Upload className="w-4 h-4" /> Import</Button>
            <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add customer</Button>
          </>
        }
      />

      {data?.usage && data.usage.cap !== null && (
        <div className={cn("mb-4 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-[12.5px]", data.usage.count >= data.usage.cap ? "border-warning/40 bg-warning-soft text-warning" : data.usage.count >= data.usage.cap * 0.9 ? "border-warning/30 bg-warning-soft/60 text-t2" : "border-line bg-surface-2 text-t3")}>
          <Users className="w-4 h-4 shrink-0" />
          <span className="flex-1"><b className="text-t1">{data.usage.count.toLocaleString()}</b> of {data.usage.cap.toLocaleString()} customers on your plan{data.usage.count >= data.usage.cap ? ". You can't add more, but nobody is removed." : "."}</span>
        </div>
      )}

      <SpreadsheetImport
        open={importing} onClose={() => setImporting(false)} onDone={reload}
        title="Import customers" subtitle="Upload a list from Excel or CSV. You'll see what happens before anything is saved."
        endpoint="/customers/import"
        fields={[{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "address", label: "Address" }, { key: "notes", label: "Notes" }]}
        tiles={(r) => [
          { label: "Will be added", value: r.totals.add ?? 0, tone: "good" },
          { label: "Already in your book", value: r.totals.duplicate ?? 0 },
          { label: "Skipped (problems)", value: r.totals.invalid ?? 0, tone: r.totals.invalid ? "warn" : undefined },
          { label: "Over your plan's limit", value: r.totals.overLimit ?? 0, tone: r.totals.overLimit ? "bad" : undefined },
        ]}
        columns={[{ label: "Name", cell: (c) => c.name }, { label: "Phone", cell: (c) => c.phone || "—" }, { label: "Email", cell: (c) => c.email || "—" }]}
        saveLabel={(r) => `Add ${(r.totals.add ?? 0).toLocaleString()} customer${r.totals.add === 1 ? "" : "s"}`}
        done={(r) => <>{(r.created ?? 0).toLocaleString()} customer{r.created === 1 ? "" : "s"} added to your book.</>}
      />

      {creditOn && !!data?.totalOutstanding && (
        <Card className="p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-warning-soft text-warning flex items-center justify-center shrink-0">
              <HandCoins className="w-[18px] h-[18px]" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-t1">{fmtMoney(data.totalOutstanding, currency)} owed on credit</div>
              <div className="text-[11px] text-t3">Across every customer with a balance</div>
            </div>
          </div>
          <button
            onClick={() => setDebtorsOnly((v) => !v)}
            className={cn(
              "h-8 px-3 rounded-ctl text-[12px] font-semibold border transition-colors",
              debtorsOnly ? "bg-primary text-white border-primary" : "border-line-2 text-t2 hover:bg-surface-2"
            )}
          >
            {debtorsOnly ? "Showing debtors only" : "Show debtors only"}
          </button>
        </Card>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setWebsiteOnly((v) => !v)}
          aria-pressed={websiteOnly}
          className={cn("h-8 px-3 rounded-ctl text-[12px] font-semibold border transition-colors", websiteOnly ? "bg-primary text-white border-primary" : "border-line-2 text-t2 hover:bg-surface-2")}
        >
          {websiteOnly ? "Showing website sign-ups" : "Website sign-ups only"}
        </button>
      </div>

      <div className="relative max-w-sm mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface border border-line text-[13px] text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={q ? "No matches" : "No customers yet"}
            body={q ? "Try a different name or number." : "Attach a customer during checkout (or add one here) and their spend and visits build automatically."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {paged.rows.map((c) => (
              <button key={c.id} onClick={() => setSelected(c)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-semibold text-[13px] flex items-center justify-center shrink-0">
                  {c.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate flex items-center gap-1.5">{c.name}{c.source === "website" && <Badge tone="brand">website</Badge>}</div>
                  <div className="text-[11px] text-t3 flex items-center gap-1">
                    {c.phone && <><Phone className="w-3 h-3" /> {c.phone} · </>}last seen {fmtDate(c.lastSeen)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-[13px] font-semibold text-t1 tabular-nums">{fmtMoney(c.totalSpend, currency)}</div>
                  <div className="text-[11px] text-t4">{c.visits} visit{c.visits === 1 ? "" : "s"}</div>
                  {c.creditBalance > 0 && (
                    <Badge tone="warning" className="mt-0.5">owes {fmtMoney(c.creditBalance, currency)}</Badge>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-t4 shrink-0" />
              </button>
            ))}
          </div>
          <Pager {...paged} onPage={paged.setPage} noun="customers" />
        </Card>
      )}

      <AddCustomer open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
      <CustomerDetail
        customer={selected}
        currency={currency}
        showLoyalty={hasCapability("loyalty") && hasFeature("loyalty")}
        showLoyaltyCard={hasModule("loyaltyCard") && hasFeature("loyalty")}
        showCredit={creditOn}
        onClose={() => setSelected(null)}
        onChanged={reload}
      />
    </div>
  );
}

function AddCustomer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { activeBranch, branchesForActive } = useSession();
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [shared, setShared] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/customers", { method: "POST", body: JSON.stringify({ ...form, shareWithAllStores: shared }) });
      setForm({ name: "", phone: "", notes: "" });
      setShared(false);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add customer">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Name"><Input autoFocus required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Phone / WhatsApp"><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
        <Field label="Notes"><TextArea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        {branchesForActive.length > 1 && (
          <label className="flex items-start gap-2 text-[12px] text-t2">
            <input type="checkbox" className="mt-0.5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>Known at every branch. Left off, this customer belongs to <b>{activeBranch?.name}</b> only.</span>
          </label>
        )}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Add customer"}</Button>
      </form>
    </Modal>
  );
}

function CustomerDetail({ customer, currency, showLoyalty, showLoyaltyCard, showCredit, onClose, onChanged }: {
  customer: Customer | null; currency: string; showLoyalty: boolean; showLoyaltyCard: boolean; showCredit: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { data, loading } = useApi<{ customer: Customer; sales: CustomerSale[] }>(
    customer ? `/customers/${customer.id}` : null,
    [customer?.id]
  );

  if (!customer) return null;
  const c = data?.customer || customer;

  return (
    <Modal open={!!customer} onClose={onClose} title={c.name} subtitle={c.phone || "No phone on file"} wide>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { l: "Total spend", v: fmtMoney(c.totalSpend, currency) },
          { l: "Visits", v: String(c.visits) },
          { l: "Customer since", v: fmtDate(c.firstSeen) },
        ].map((s) => (
          <div key={s.l} className="rounded-xl bg-surface-2 border border-line p-3 min-w-0">
            <div className="text-[15px] font-semibold font-mono text-t1 truncate">{s.v}</div>
            <div className="text-[10px] font-medium text-t3 mt-0.5 truncate">{s.l}</div>
          </div>
        ))}
      </div>
      {(c.email || c.address || c.source === "website") && (
        <div className="text-[12px] text-t2 px-3 py-2 rounded-ctl bg-surface-2 border border-line mb-4 space-y-0.5">
          {c.source === "website" && <div><Badge tone="brand">signed up on your website</Badge></div>}
          {c.email && <div>Email: <span className="text-t1">{c.email}</span></div>}
          {c.address && <div>Address: <span className="text-t1">{c.address}</span></div>}
        </div>
      )}
      {c.notes && <div className="text-[12px] text-t2 px-3 py-2 rounded-ctl bg-surface-2 border border-line mb-4">{c.notes}</div>}
      {showLoyaltyCard && <LoyaltyCardPanel customerId={customer.id} customerPhone={c.phone || c.whatsapp} />}
      {showLoyalty && <LoyaltySection customerId={customer.id} onChanged={onChanged} />}
      {showCredit && <CreditSection customerId={customer.id} currency={currency} onChanged={onChanged} />}
      <div className="text-[12px] font-medium text-t3 mb-2">Purchase history</div>
      {loading ? (
        <Spinner />
      ) : !data?.sales.length ? (
        <div className="text-[12px] text-t4 py-4 text-center">No purchases recorded yet.</div>
      ) : (
        <div className="divide-y divide-line">
          {data.sales.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold text-primary">{s.saleNo}</span>
                  {s.status === "voided" && <Badge tone="danger">voided</Badge>}
                  <span className="text-[11px] text-t4">{fmtDateTime(s.at)}</span>
                </div>
                <div className="text-[12px] text-t3 truncate">{s.summary}</div>
              </div>
              <span className="font-mono text-[13px] font-semibold text-t1 tabular-nums shrink-0">{fmtMoney(s.total, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Loyalty QR card ──────────────────────────────────────────────────
// Cross-vertical (any business with the loyaltyCard module on) — distinct
// from LoyaltySection below, which is water's sachet/free-pack mechanic.

type LoyaltyCard = { id: string; code: string; status: string; issuedAt: string; issuedVia: string; lastScannedAt: string | null; scanCount: number; url: string };

function LoyaltyCardPanel({ customerId, customerPhone }: { customerId: string; customerPhone: string }) {
  const { activeBusiness } = useSession();
  const [card, setCard] = useState<LoyaltyCard | null | undefined>(undefined); // undefined = still loading
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState("");

  useEffect(() => {
    let live = true;
    api<{ card: LoyaltyCard | null }>(`/loyalty-cards/${customerId}`)
      .then((r) => { if (live) setCard(r.card); })
      .catch(() => { if (live) setCard(null); });
    return () => { live = false; };
  }, [customerId]);

  useEffect(() => {
    if (card) qrDataUrl(card.url).then(setQr);
  }, [card?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailBusy(true); setEmailNote("");
    try {
      const r = await api<{ sent: boolean; reason?: string }>(`/loyalty-cards/${customerId}/email`, {
        method: "POST", body: JSON.stringify({ to: emailTo.trim() }),
      });
      setEmailNote(r.sent ? "Sent!" : "Couldn't send — email isn't set up on this server.");
      if (r.sent) { setEmailing(false); setEmailTo(""); }
    } catch (err: any) {
      setEmailNote(err.message);
    } finally {
      setEmailBusy(false);
    }
  }

  if (card === undefined) return null; // avoid a flash of "no card yet" while loading
  if (!card) {
    return (
      <div className="mb-4 px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-[12px] text-t3">
        No loyalty card yet — issued automatically once this customer qualifies (see Settings → Loyalty Cards).
      </div>
    );
  }

  const waText = encodeURIComponent(`Here's your ${activeBusiness?.name || "loyalty"} card — show it at the till next time: ${card.url}`);
  const waHref = `https://wa.me/${toIntlPhone(customerPhone)}?text=${waText}`;

  return (
    <div className="mb-4 rounded-ctl border border-line bg-surface-2 p-3.5">
      <div className="flex items-center gap-2 mb-3">
        <QrCode className="w-3.5 h-3.5 text-primary" />
        <span className="text-[12px] font-semibold text-t1">Loyalty card</span>
        <span className="ml-auto text-[11px] text-t4">{card.scanCount} scan{card.scanCount === 1 ? "" : "s"}</span>
      </div>
      <div className="flex items-start gap-4 flex-wrap">
        {qr && <img src={qr} width={100} height={100} alt="Loyalty QR code" className="rounded-lg border border-line shrink-0" />}
        <div className="flex-1 min-w-[180px] space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { navigator.clipboard?.writeText(card.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="h-8 px-3 rounded-ctl border border-line-2 bg-surface text-[12px] font-semibold text-t2 hover:text-primary hover:border-brand-400 flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />} Copy link
            </button>
            {customerPhone && (
              <a href={waHref} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-ctl border border-line-2 bg-surface text-[12px] font-semibold text-t2 hover:text-primary hover:border-brand-400 flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </a>
            )}
            <button
              onClick={() => setEmailing((v) => !v)}
              className="h-8 px-3 rounded-ctl border border-line-2 bg-surface text-[12px] font-semibold text-t2 hover:text-primary hover:border-brand-400 flex items-center gap-1.5"
            >
              <Mail className="w-3.5 h-3.5" /> Email
            </button>
          </div>
          {emailing && (
            <form onSubmit={sendEmail} className="flex items-center gap-2">
              <Input type="email" required autoFocus placeholder="Customer's email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className="!h-8 flex-1" />
              <Button type="submit" className="!h-8" disabled={emailBusy}>{emailBusy ? "…" : "Send"}</Button>
            </form>
          )}
          {emailNote && <div className="text-[11px] text-t3">{emailNote}</div>}
        </div>
      </div>
    </div>
  );
}

const INTERVAL_LABEL: Record<SupplySchedule["interval"], string> = {
  none: "Not scheduled", daily: "Daily", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly",
};

// Reward tokens from sachet/bag purchases, plus a recurring supply schedule —
// the "loyalty" capability, water only. Every field this widget needs comes
// back from one GET, so redeeming or rescheduling just reloads it.
function LoyaltySection({ customerId, onChanged }: { customerId: string; onChanged: () => void }) {
  const { data, loading, reload } = useApi<LoyaltyStatus & { supplySchedule: SupplySchedule }>(`/loyalty/${customerId}`, [customerId]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [interval, setInterval_] = useState<SupplySchedule["interval"]>("none");

  if (loading || !data) {
    return <div className="mb-4"><Spinner /></div>;
  }

  async function redeem() {
    setBusy(true); setError("");
    try {
      const r = await api<{ freePacks: number }>(`/loyalty/${customerId}/redeem`, { method: "POST" });
      alert(`Redeemed ${r.freePacks} free pack${r.freePacks === 1 ? "" : "s"}.`);
      reload(); onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setSchedule(next: SupplySchedule["interval"]) {
    setBusy(true); setError("");
    try {
      await api(`/loyalty/${customerId}/schedule`, { method: "PATCH", body: JSON.stringify({ interval: next }) });
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markSupplied() {
    setBusy(true); setError("");
    try {
      await api(`/loyalty/${customerId}/supplied`, { method: "POST" });
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sched = data.supplySchedule;

  return (
    <div className="mb-4 space-y-3">
      <ErrorBanner message={error} />
      <div className="rounded-ctl bg-surface-2 border border-line p-3">
        <div className="flex items-center gap-2 mb-2">
          <Coins className="w-3.5 h-3.5 text-primary" />
          <span className="text-[12px] font-semibold text-t1">Loyalty tokens</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          {[
            { l: "Sachets/bags", v: data.sachetBagQty },
            { l: "Tokens earned", v: data.tokens },
            { l: "Redeemed", v: data.tokensRedeemed },
            { l: "Free packs due", v: data.redeemable },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <div className="font-mono text-[14px] font-semibold text-t1">{s.v}</div>
              <div className="text-[9px] text-t4">{s.l}</div>
            </div>
          ))}
        </div>
        <Button variant="secondary" className="w-full" disabled={busy || data.redeemable < 1} onClick={redeem}>
          {data.redeemable < 1 ? "No free pack due yet" : `Redeem ${data.redeemable} free pack${data.redeemable === 1 ? "" : "s"}`}
        </Button>
      </div>

      <div className="rounded-ctl bg-surface-2 border border-line p-3">
        <div className="flex items-center gap-2 mb-2">
          <Truck className="w-3.5 h-3.5 text-primary" />
          <span className="text-[12px] font-semibold text-t1">Supply schedule</span>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Repeats" className="flex-1">
            <Select
              value={sched.interval === "none" ? interval : sched.interval}
              onChange={(e) => {
                const next = e.target.value as SupplySchedule["interval"];
                // Already scheduled: changing this re-schedules immediately.
                // Not yet scheduled: just picks what "Start" will use.
                if (sched.interval !== "none") setSchedule(next);
                else setInterval_(next);
              }}
            >
              {(Object.keys(INTERVAL_LABEL) as SupplySchedule["interval"][]).map((k) => <option key={k} value={k}>{INTERVAL_LABEL[k]}</option>)}
            </Select>
          </Field>
          {sched.interval === "none" ? (
            <Button variant="secondary" disabled={busy || interval === "none"} onClick={() => setSchedule(interval)}>Start</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={markSupplied}>Mark supplied</Button>
              <Button variant="secondary" disabled={busy} onClick={() => setSchedule("none")}>Stop</Button>
            </>
          )}
        </div>
        {sched.interval !== "none" && sched.nextDueAt && (
          <div className="text-[11px] text-t3 mt-2">Next due {fmtDate(sched.nextDueAt)}</div>
        )}
      </div>
    </div>
  );
}

// The "credit" capability — what this customer currently owes, a way to
// record a repayment, and the statement behind both. Every credit sale
// (coldroom's /sales today) posts to the same ledger this reads.
function CreditSection({ customerId, currency, onChanged }: { customerId: string; currency: string; onChanged: () => void }) {
  const { data, loading, reload } = useApi<{ creditBalance: number; entries: LedgerEntry[] }>(`/customers/${customerId}/ledger`, [customerId]);
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<"cash" | "pos" | "transfer">("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading || !data) {
    return <div className="mb-4"><Spinner /></div>;
  }

  async function recordPayment() {
    setBusy(true); setError("");
    try {
      await api(`/customers/${customerId}/ledger/payments`, { method: "POST", body: JSON.stringify({ amount: Number(amount), method }) });
      setAmount("");
      reload(); onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 space-y-3">
      <ErrorBanner message={error} />
      <div className="rounded-ctl bg-surface-2 border border-line p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <HandCoins className="w-3.5 h-3.5 text-primary" />
            <span className="text-[12px] font-semibold text-t1">Credit balance</span>
          </div>
          <span className={cn("font-mono text-[16px] font-semibold", data.creditBalance > 0 ? "text-warning" : "text-t1")}>
            {fmtMoney(data.creditBalance, currency)}
          </span>
        </div>
        {data.creditBalance > 0 && (
          <div className="flex items-end gap-2">
            <Field label="Payment received" className="flex-1">
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Amount" />
            </Field>
            <Select value={method} onChange={(e) => setMethod(e.target.value as any)} className="!w-28">
              <option value="cash">Cash</option>
              <option value="pos">POS</option>
              <option value="transfer">Transfer</option>
            </Select>
            <Button variant="secondary" disabled={busy || !amount} onClick={recordPayment}>Record</Button>
          </div>
        )}
        {data.entries.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line divide-y divide-line">
            {data.entries.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                <Badge tone={e.amount > 0 ? "warning" : "success"}>{e.amount > 0 ? "sale" : e.type}</Badge>
                <span className="flex-1 text-t3">{e.note || (e.amount > 0 ? "Sold on credit" : "Repayment")}</span>
                <span className="font-mono font-semibold text-t1">{fmtMoney(Math.abs(e.amount), currency)}</span>
                <span className="text-t4">{fmtDate(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
