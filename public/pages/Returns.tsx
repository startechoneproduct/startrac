import { useEffect, useState } from "react";
import { Undo2, Search, Check, X, Clock, Printer, Wallet, PackageX, PackageCheck, UserRound, Receipt as ReceiptIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { ProductTypeahead } from "@/components/ui/ProductTypeahead";
import { StatCard } from "@/components/ui/StatCard";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDate, fmtDateTime, fmtMoney, fmtTime, todayStr } from "@/lib/format";
import { printReport, mono } from "@/lib/printReport";
import { cn } from "@/lib/utils";

type SaleItem = { productId: string; name: string; qty: number; unitPrice: number; lineNet: number; returnedQty: number; custom?: boolean };
type Sale = {
  id: string; saleNo: string; at: string; staffName: string; total: number; subtotal: number; discount: number; vat: number;
  items: SaleItem[]; status: string; customerId: string | null; customerName: string; channel?: string;
};
type Condition = "good" | "damaged";
type Outcome = "refund" | "store_credit" | "exchange";
type ReasonType = "defective" | "wrong_item" | "damaged" | "not_wanted" | "expired" | "other";
type Ret = {
  id: string; returnNo: string; saleNo: string; customerName: string;
  items: { name: string; qty: number; unitPrice: number; condition: Condition; restock: boolean }[];
  refund: { method: string; amount: number }; outcome: Outcome; reasonType: ReasonType;
  reason: string; status: "pending" | "approved" | "rejected"; requestedBy?: string; requestedByName: string;
  decidedByName?: string; decidedAt?: string; decisionNote?: string; createdAt: string;
};
type Totals = { pending: number; refunded: number; credited: number; damagedUnits: number; restockedUnits: number };
type Customer = { id: string; name: string; phone: string; storeCredit: number };

const REASONS: Record<ReasonType, string> = {
  defective: "Faulty or not working", wrong_item: "Wrong item", damaged: "Arrived damaged", not_wanted: "Customer changed their mind", expired: "Expired", other: "Other",
};
const OUTCOME_LABEL: Record<Outcome, string> = { refund: "Refund", store_credit: "Store credit", exchange: "Exchange" };
const METHOD_LABEL: Record<string, string> = { cash: "cash", pos: "POS", transfer: "transfer", store_credit: "store credit" };

export function Returns() {
  const { activeBranch, activeBusiness, currency, can, session } = useSession();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 300); return () => clearTimeout(t); }, [qInput]);
  const qs = new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(q ? { q } : {}) }).toString();
  const { data, loading, reload } = useApi<{ returns: Ret[]; totals: Totals }>(`/returns?${qs}`, [activeBranch?.id, qs]);
  const { data: all, reload: reloadAll } = useApi<{ returns: Ret[]; totals: Totals }>("/returns", [activeBranch?.id]);
  const returns = data?.returns || [];
  const totals = all?.totals;
  const paged = usePaged(returns);
  const refresh = () => { reload(); reloadAll(); };
  const printOne = (r: Ret) => printReturn(r, activeBusiness?.name || "", currency);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1250px] mx-auto">
      <PageHeader title="Returns" subtitle="Staff record a return, a manager approves it, and stock and money correct themselves" />

      {totals && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          <StatCard tone="warning" label="Waiting for approval" value={String(totals.pending)} icon={Clock} />
          <StatCard tone="danger" label="Refunded" value={fmtMoney(totals.refunded, currency)} icon={Undo2} hint="cash, POS and transfer" />
          <StatCard tone="brand" label="Given as store credit" value={fmtMoney(totals.credited, currency)} icon={Wallet} hint="credit and exchanges" />
          <StatCard tone="neutral" label="Items back" value={String(totals.restockedUnits + totals.damagedUnits)} icon={PackageCheck} hint={`${totals.restockedUnits} back on the shelf, ${totals.damagedUnits} damaged`} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2">
          <SubmitReturn onSubmitted={refresh} currency={currency} onPrint={printOne} />
        </div>

        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              options={[["pending", `Waiting${totals?.pending ? ` (${totals.pending})` : ""}`], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]] as const}
              value={status} onChange={setStatus}
            />
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-t4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input aria-label="Search returns" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Return no., receipt no., customer or item" className="!pl-9" />
            </div>
          </div>
          <Card className="overflow-hidden">
            {loading ? (
              <Spinner />
            ) : returns.length === 0 ? (
              <EmptyState icon={Undo2} title={q ? "No returns match" : status === "pending" ? "Nothing waiting" : "No returns here yet"}
                body={status === "pending" && !q ? "New returns land here for a manager to approve or reject." : "Try another filter or search."} />
            ) : (
              <div className="divide-y divide-line">
                {paged.rows.map((r) => (
                  <ReturnRow key={r.id} r={r} currency={currency} canDecide={can("approve_returns") && (can("*") || r.requestedBy !== session?.user.id)} ownPending={!can("*") && r.requestedBy === session?.user.id} onDecided={refresh} onPrint={printOne} />
                ))}
              </div>
            )}
            <Pager {...paged} onPage={paged.setPage} noun="returns" />
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A printable return note: what came back, in what condition, and what the customer got. */
function printReturn(r: Ret, businessName: string, currency: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const got = r.outcome === "refund" ? `Refunded by ${METHOD_LABEL[r.refund.method] || r.refund.method}` : r.outcome === "exchange" ? "Exchanged (store credit for the replacement)" : "Given as store credit";
  printReport({
    businessName,
    title: `Return ${r.returnNo || ""}`.trim(),
    subtitle: [`Receipt ${r.saleNo}`, r.customerName && `Customer ${r.customerName}`, `${REASONS[r.reasonType]}${r.reason ? `: ${r.reason}` : ""}`, `${r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : "Waiting for approval"}`, got].filter(Boolean).join(" · "),
    columns: [
      { label: "Item", render: (i: Ret["items"][number]) => esc(i.name) },
      { label: "Condition", render: (i) => (i.condition === "damaged" ? "Damaged" : "Good") },
      { label: "Qty", align: "right", render: (i) => mono(String(i.qty)) },
      { label: "Each", align: "right", render: (i) => mono(esc(fmtMoney(i.unitPrice, currency))) },
    ],
    rows: r.items,
    totals: ["Amount back (incl. VAT)", "", "", fmtMoney(r.refund.amount, currency)],
  });
}

function ReturnRow({ r, currency, canDecide, ownPending, onDecided, onPrint }: { r: Ret; currency: string; canDecide: boolean; ownPending?: boolean; onDecided: () => void; onPrint: (r: Ret) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    setBusy(true); setError("");
    try {
      await api(`/returns/${r.id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      onDecided();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const tone = r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : "warning";
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
          r.status === "approved" ? "bg-success-soft text-success" : r.status === "rejected" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
          <Undo2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {r.returnNo && <span className="font-mono text-[12.5px] font-bold text-t1">{r.returnNo}</span>}
            <span className="font-mono text-[12px] font-semibold text-primary">{r.saleNo}</span>
            <Badge tone={tone}>{r.status === "pending" ? "waiting" : r.status}</Badge>
            <Badge tone="neutral">{OUTCOME_LABEL[r.outcome]}</Badge>
            <span className="text-[11px] text-t4">{fmtDateTime(r.createdAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {r.items.map((i, k) => (
              <span key={k} className={cn("inline-flex items-center gap-1 px-2 h-6 rounded-md text-[12px]", i.condition === "damaged" ? "bg-danger-soft text-danger" : "bg-surface-2 text-t1")}>
                {i.condition === "damaged" ? <PackageX className="w-3.5 h-3.5" /> : <PackageCheck className="w-3.5 h-3.5 text-success" />}
                {i.name} ×{i.qty}{i.condition === "damaged" ? " · damaged" : ""}
              </span>
            ))}
          </div>
          <div className="text-[12px] text-t3 mt-1">
            {REASONS[r.reasonType]}{r.reason ? `: "${r.reason}"` : ""}{r.customerName ? ` · ${r.customerName}` : ""} · recorded by {r.requestedByName}
            {r.decidedByName && <> · {r.status} by {r.decidedByName}</>}
          </div>
          {error && <div className="text-[11.5px] text-danger font-semibold mt-1">{error}</div>}
          {r.status === "pending" && !canDecide && (
            <div className="text-[11.5px] text-warning font-semibold mt-1">
              {ownPending ? "Waiting for a manager or admin to approve it. Nothing is refunded until then." : "Waiting for a manager or admin to approve it."}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[14px] font-semibold text-t1 tabular-nums">{fmtMoney(r.refund.amount, currency)}</div>
          <div className="text-[11.5px] text-t4">{r.outcome === "refund" ? `${METHOD_LABEL[r.refund.method] || r.refund.method} refund` : r.outcome === "exchange" ? "credit for exchange" : "store credit"}</div>
          <div className="flex gap-1.5 mt-2 justify-end">
            {r.status === "pending" && canDecide && (
              <>
                <Button size="sm" variant="success" disabled={busy} onClick={() => decide("approve")}><Check className="w-3.5 h-3.5" /> Approve</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide("reject")}><X className="w-3.5 h-3.5" /> Reject</Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => onPrint(r)} aria-label={`Print return ${r.returnNo}`}><Printer className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recording a return ───────────────────────────────────────

// Customer search, used both to find a sale and to choose who gets store credit.
function useCustomerSearch(q: string, set: (c: Customer[]) => void) {
  useEffect(() => {
    if (q.trim().length < 2) { set([]); return; }
    let stale = false;
    const t = setTimeout(() => {
      api<{ customers: Customer[] }>(`/customers?q=${encodeURIComponent(q.trim())}`).then((r) => !stale && set(r.customers.slice(0, 6))).catch(() => !stale && set([]));
    }, 250);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
}

function SubmitReturn({ onSubmitted, currency, onPrint }: { onSubmitted: () => void; currency: string; onPrint: (r: Ret) => void }) {
  const [findBy, setFindBy] = useState<"receipt" | "customer" | "date">("receipt");
  const [day, setDay] = useState(todayStr());
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [productId, setProductId] = useState("");
  const [results, setResults] = useState<Sale[] | null>(null);
  const [searching, setSearching] = useState(false);
  const { data: prodData } = useApi<{ products: { id: string; name: string; sku?: string; barcode?: string; category?: string }[] }>(findBy === "date" ? "/products" : null, [findBy]);
  const [receiptNo, setReceiptNo] = useState("");
  const [custQ, setCustQ] = useState("");
  const [custFound, setCustFound] = useState<Customer[]>([]);
  const [custSales, setCustSales] = useState<Sale[] | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [conds, setConds] = useState<Record<string, Condition>>({});
  const [reasonType, setReasonType] = useState<ReasonType>("defective");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("refund");
  const [method, setMethod] = useState<"cash" | "pos" | "transfer">("cash");
  const [creditTo, setCreditTo] = useState<Customer | null>(null);
  const [creditQ, setCreditQ] = useState("");
  const [creditFound, setCreditFound] = useState<Customer[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Ret | null>(null);
  const [busy, setBusy] = useState(false);

  useCustomerSearch(findBy === "customer" ? custQ : "", setCustFound);
  useCustomerSearch(creditQ, setCreditFound);

  function open(s: Sale) {
    if (s.status === "voided") { setError("That sale was voided, so there's nothing to return."); return; }
    setError(""); setDone(null); setSale(s); setQtys({}); setConds({}); setCreditTo(null);
  }

  // Every search goes through the returns lookup, which finds any sale in the
  // branch (not only the ones this person rang up) and never shows costs.
  const lookup = (params: Record<string, string>) => api<{ sales: Sale[] }>(`/returns/sales?${new URLSearchParams(params)}`);

  async function findSale(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setDone(null); setSale(null);
    try {
      const res = await lookup({ saleNo: receiptNo.trim() });
      if (!res.sales[0]) { setError("No sale with that receipt number in this branch."); return; }
      open(res.sales[0]);
    } catch (err: any) { setError(err.message); }
  }

  async function salesOf(c: Customer) {
    setError(""); setSale(null); setCustSales(null);
    try {
      const res = await lookup({ customerId: c.id });
      setCustSales(res.sales);
    } catch (err: any) { setError(err.message); }
  }

  async function findByDate(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setDone(null); setSale(null); setResults(null); setSearching(true);
    try {
      const res = await lookup({ date: day, ...(timeFrom ? { timeFrom } : {}), ...(timeTo ? { timeTo } : {}), ...(productId ? { productId } : {}) });
      setResults(res.sales);
    } catch (err: any) { setError(err.message); } finally { setSearching(false); }
  }

  // The same pricing the server uses, so the person sees roughly what goes back before submitting.
  const estimate = (() => {
    if (!sale) return 0;
    const paidFactor = sale.subtotal > 0 ? (sale.subtotal - sale.discount) / sale.subtotal : 1;
    const vatFactor = sale.subtotal - sale.discount > 0 ? sale.vat / (sale.subtotal - sale.discount) : 0;
    const net = sale.items.reduce((s, i) => s + (qtys[i.productId] || 0) * (i.lineNet / i.qty) * paidFactor, 0);
    return Math.round(net * (1 + vatFactor) * 100) / 100;
  })();
  const needsCustomer = outcome !== "refund" && !sale?.customerId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sale) return;
    const items = Object.entries(qtys).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty, condition: conds[productId] || "good" }));
    if (!items.length) { setError("Set how many of at least one item are coming back."); return; }
    if (reasonType === "other" && reason.trim().length < 3) { setError("Say why the item is coming back."); return; }
    if (needsCustomer && !creditTo) { setError("Choose the customer the store credit goes to."); return; }
    setBusy(true); setError("");
    try {
      const res = await api<{ return: Ret }>("/returns", {
        method: "POST",
        body: JSON.stringify({ saleId: sale.id, items, reasonType, reason, outcome, refundMethod: method, ...(creditTo ? { customerId: creditTo.id } : {}) }),
      });
      setDone(res.return);
      setSale(null); setReceiptNo(""); setReason(""); setQtys({}); setConds({}); setCreditTo(null); setCustSales(null); setCustQ("");
      onSubmitted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 self-start">
      <div className="text-[14px] font-semibold text-t1 mb-3">Record a return</div>
      <ErrorBanner message={error} />
      {done && (
        <div className="px-3.5 py-3 rounded-ctl bg-success-soft border border-success/30 mb-3 text-[12.5px] text-t1">
          <div className="font-semibold"><span className="font-mono">{done.returnNo}</span> recorded for {done.saleNo}: {fmtMoney(done.refund.amount, currency)} {done.outcome === "refund" ? "to refund" : "as store credit"}, waiting for a manager or admin to approve. Nothing is refunded or put back in stock until then.</div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => onPrint(done)}><Printer className="w-3.5 h-3.5" /> Print return note</Button>
        </div>
      )}

      <Segmented options={[["receipt", "Receipt no."], ["customer", "Customer"], ["date", "Date or item"]] as const} value={findBy} onChange={(v) => { setFindBy(v); setSale(null); setCustSales(null); setResults(null); }} />

      {findBy === "date" ? (
        <form onSubmit={findByDate} className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Day"><Input type="date" required max={todayStr()} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            <Field label="From" hint="Optional"><Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} /></Field>
            <Field label="To" hint="Optional"><Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} /></Field>
          </div>
          <Field label="What they bought" hint="Optional">
            <ProductTypeahead products={prodData?.products || []} value={productId} onChange={setProductId} label="What they bought" placeholder="Start typing, e.g. kettle (leave empty for any item)" />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={searching}><Search className="w-4 h-4" /> {searching ? "Searching…" : "Find sales"}</Button>
          {results && (
            results.length === 0 ? <div className="text-[12.5px] text-t3 py-2">No sales match. Try a wider time, or another day.</div> : (
              <div className="rounded-ctl border border-line divide-y divide-line max-h-[300px] overflow-y-auto">
                {results.map((s) => (
                  <button key={s.id} type="button" onClick={() => open(s)} disabled={s.status === "voided"}
                    className={cn("w-full px-3 py-2 text-left text-[12.5px] hover:bg-surface-2", sale?.id === s.id && "bg-primary-softer", s.status === "voided" && "opacity-50")}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-primary">{s.saleNo}</span>
                      <span className="text-t2">{fmtTime(s.at)}</span>
                      {s.customerName && <span className="text-t3 truncate">{s.customerName}</span>}
                      {s.status === "voided" && <Badge tone="neutral">voided</Badge>}
                      <span className="ml-auto font-mono text-t1">{fmtMoney(s.total, currency)}</span>
                    </div>
                    <div className="text-[11.5px] text-t3 truncate">{s.items.map((i) => `${i.name} ×${i.qty}`).join(", ")} · by {s.staffName}</div>
                  </button>
                ))}
              </div>
            )
          )}
        </form>
      ) : findBy === "receipt" ? (
        <form onSubmit={findSale} className="flex gap-2 mt-3">
          <Input aria-label="Receipt number" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="Receipt no. e.g. R-00042" required />
          <Button type="submit" variant="secondary" className="shrink-0"><Search className="w-4 h-4" /> Find</Button>
        </form>
      ) : (
        <div className="mt-3 space-y-2">
          <Input aria-label="Customer name or phone" value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Customer name or phone" />
          {custFound.length > 0 && !custSales && (
            <div className="rounded-ctl border border-line divide-y divide-line">
              {custFound.map((c) => (
                <button key={c.id} type="button" onClick={() => salesOf(c)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2">
                  <UserRound className="w-3.5 h-3.5 text-t3" /><span className="font-semibold text-t1">{c.name}</span><span className="text-t3">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
          {custSales && (
            custSales.length === 0 ? <div className="text-[12.5px] text-t3 py-2">No sales for this customer in this branch.</div> : (
              <div className="rounded-ctl border border-line divide-y divide-line max-h-[240px] overflow-y-auto">
                {custSales.map((s) => (
                  <button key={s.id} type="button" onClick={() => open(s)} disabled={s.status === "voided"}
                    className={cn("w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2", sale?.id === s.id && "bg-primary-softer", s.status === "voided" && "opacity-50")}>
                    <ReceiptIcon className="w-3.5 h-3.5 text-t3" />
                    <span className="font-mono font-semibold text-primary">{s.saleNo}</span>
                    <span className="text-t3">{fmtDate(s.at)}</span>
                    <span className="ml-auto font-mono text-t1">{fmtMoney(s.total, currency)}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {sale && (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="text-[12px] text-t3">
            <span className="font-mono font-semibold text-primary">{sale.saleNo}</span> · {fmtDateTime(sale.at)} · by {sale.staffName} · {fmtMoney(sale.total, currency)}
            {sale.customerName && <> · {sale.customerName}</>}
          </div>

          <div className="space-y-2">
            {sale.items.map((i) => {
              const returnable = i.qty - i.returnedQty;
              const q = qtys[i.productId] ?? 0;
              return (
                <div key={i.productId} className={cn("px-3 py-2.5 rounded-ctl border", q > 0 ? "border-primary/40 bg-primary-softer" : "bg-surface-2 border-line")}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-t1 truncate">{i.name}</div>
                      <div className="text-[11px] text-t4">bought {i.qty}{i.returnedQty > 0 ? ` · ${i.returnedQty} already returned` : ""}{returnable === 0 ? " · nothing left to return" : ""}</div>
                    </div>
                    <Input
                      aria-label={`How many ${i.name} are coming back`}
                      type="number" min="0" max={returnable}
                      value={q}
                      onChange={(e) => setQtys((x) => ({ ...x, [i.productId]: Math.min(returnable, Math.max(0, Math.floor(Number(e.target.value) || 0))) }))}
                      className="!w-16 text-right"
                      disabled={returnable === 0}
                    />
                  </div>
                  {q > 0 && !i.custom && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11.5px]" role="radiogroup" aria-label={`Condition of ${i.name}`}>
                      <span className="text-t3 mr-1">Condition:</span>
                      {(["good", "damaged"] as Condition[]).map((c) => (
                        <button key={c} type="button" role="radio" aria-checked={(conds[i.productId] || "good") === c} onClick={() => setConds((x) => ({ ...x, [i.productId]: c }))}
                          className={cn("px-2.5 h-7 rounded-full font-semibold border", (conds[i.productId] || "good") === c
                            ? c === "good" ? "bg-success-soft border-success/40 text-success" : "bg-danger-soft border-danger/40 text-danger"
                            : "bg-surface border-line-2 text-t3")}>
                          {c === "good" ? "Good, back on the shelf" : "Damaged, can't resell"}
                        </button>
                      ))}
                    </div>
                  )}
                  {q > 0 && i.custom && <div className="mt-1.5 text-[11px] text-t3">Made to measure: refunded, never put back in stock.</div>}
                </div>
              );
            })}
          </div>

          <Field label="Why is it coming back?">
            <Select value={reasonType} onChange={(e) => setReasonType(e.target.value as ReasonType)}>
              {(Object.keys(REASONS) as ReasonType[]).map((k) => <option key={k} value={k}>{REASONS[k]}</option>)}
            </Select>
          </Field>
          <Field label="Comment" hint={reasonType === "other" ? "Required" : "Optional"}>
            <TextArea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Screen cracked when opened" />
          </Field>

          <div>
            <div className="text-[12.5px] font-semibold text-t1 mb-1.5">What does the customer get?</div>
            <Segmented options={[["refund", "Refund"], ["store_credit", "Store credit"], ["exchange", "Exchange"]] as const} value={outcome} onChange={setOutcome} />
            {outcome === "refund" && (
              <Field label="Refund by" className="mt-2">
                <Select value={method} onChange={(e) => setMethod(e.target.value as any)}>
                  <option value="cash">Cash</option>
                  <option value="pos">POS</option>
                  <option value="transfer">Transfer</option>
                </Select>
              </Field>
            )}
            {outcome !== "refund" && (
              <p className="mt-2 text-[12px] text-t3">
                {outcome === "exchange"
                  ? "The value goes onto the customer's store credit once approved. Ring up the replacement at the till and pay with Use store credit."
                  : "The value goes onto the customer's store credit once approved, to spend at the till any time."}
              </p>
            )}
            {needsCustomer && (
              <div className="mt-2 space-y-2">
                {creditTo ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-ctl bg-primary-softer border border-line text-[12.5px]">
                    <UserRound className="w-3.5 h-3.5 text-primary" /><span className="font-semibold text-t1">{creditTo.name}</span>
                    <button type="button" onClick={() => setCreditTo(null)} className="ml-auto text-t4 hover:text-danger" aria-label="Choose someone else"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <>
                    <Input aria-label="Customer for the store credit" value={creditQ} onChange={(e) => setCreditQ(e.target.value)} placeholder="This sale had no customer: search who the credit is for" />
                    {creditFound.length > 0 && (
                      <div className="rounded-ctl border border-line divide-y divide-line">
                        {creditFound.map((c) => (
                          <button key={c.id} type="button" onClick={() => { setCreditTo(c); setCreditQ(""); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2">
                            <span className="font-semibold text-t1">{c.name}</span><span className="text-t3">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="text-[11.5px] text-t4">Not in your customers yet? Add them on the Customers page first.</div>
                  </>
                )}
              </div>
            )}
          </div>

          {estimate > 0 && (
            <div className="flex items-baseline justify-between px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-[13px]">
              <span className="text-t2">{outcome === "refund" ? "Refund" : "Store credit"}, including VAT</span>
              <span className="font-mono font-bold text-t1">about {fmtMoney(estimate, currency)}</span>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}><Undo2 className="w-4 h-4" /> {busy ? "Recording…" : "Record return for approval"}</Button>
        </form>
      )}
    </Card>
  );
}
