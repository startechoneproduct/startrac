import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Boxes, ClipboardList, Download, FileDown, FileSpreadsheet, Flame, Hourglass, PackageX, Printer, Search, Sliders, TrendingUp, Upload, Wallet, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pager } from "@/components/ui/Pager";
import { SpreadsheetImport } from "@/components/import/SpreadsheetImport";
import { LockChip, requestUpgrade } from "@/components/plan/PlanUi";
import { api, apiDownload, openFile } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";
import { ReorderTab, OrdersTab } from "@/pages/InventoryOrders";

type Tab = "stock" | "value" | "movers" | "reorder" | "orders";
type Row = { id: string; name: string; sku: string; category: string; unit: string; stock: number; reorderLevel: number; status: "ok" | "low" | "out"; price: number; retailValue: number; cost?: number; stockValue?: number };
type Overview = {
  items: Row[]; categories: string[]; page: number; pages: number; total: number; canSeeCost: boolean;
  summary: { items: number; units: number; low: number; out: number; retailValue: number; stockValue?: number; potentialProfit?: number };
};

const PER = 25;
const STATUS: Record<Row["status"], { label: string; tone: "success" | "warning" | "danger" }> = { ok: { label: "In stock", tone: "success" }, low: { label: "Low", tone: "warning" }, out: { label: "Out", tone: "danger" } };

export function Inventory() {
  const { can, hasFeature, currency } = useSession();
  const canCost = can("*") || can("costs") || can("dashboard_finance");
  const [tab, setTab] = useState<Tab>("stock");
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const tabs: { key: Tab; label: string; icon: typeof Boxes; show: boolean }[] = [
    { key: "stock", label: "Stock", icon: Boxes, show: true },
    { key: "value", label: "Value", icon: Wallet, show: canCost },
    { key: "movers", label: "What's selling", icon: TrendingUp, show: true },
    { key: "reorder", label: "Reorder", icon: ArrowDownToLine, show: true },
    { key: "orders", label: "Purchase orders", icon: ClipboardList, show: canCost },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1240px] mx-auto">
      <PageHeader
        title="Inventory"
        subtitle="What's on the shelf, what it's worth, what's selling, and what to buy next"
        actions={
          <>
            {can("stock_in") && <Button variant="secondary" onClick={() => (hasFeature("csvImport") ? setImporting(true) : requestUpgrade("csvImport"))}><Upload className="w-4 h-4" /> Import stock</Button>}
          </>
        }
      />

      <div className="flex p-1 rounded-2xl border border-line bg-surface-2 gap-1 mb-5 w-full sm:w-fit overflow-x-auto" role="tablist">
        {tabs.filter((t) => t.show).map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => animateSwitch("tab", () => setTab(key))}
            className={cn("flex items-center gap-2 px-4 h-10 rounded-xl text-[13px] font-bold whitespace-nowrap transition-all", tab === key ? "bg-surface text-primary shadow-e1" : "text-t3 hover:text-t1")}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "stock" && <StockTab key={version} canCost={canCost} currency={currency} onChanged={bump} />}
      {tab === "value" && <ValueTab currency={currency} />}
      {tab === "movers" && <MoversTab canCost={canCost} currency={currency} />}
      {tab === "reorder" && <ReorderTab canCost={canCost} currency={currency} goOrders={() => animateSwitch("tab", () => setTab("orders"))} />}
      {tab === "orders" && <OrdersTab currency={currency} onChanged={bump} />}

      <SpreadsheetImport
        open={importing} onClose={() => setImporting(false)} onDone={bump}
        title="Import opening stock" subtitle="Set what's on the shelf from a spreadsheet. Each change goes into the stock history."
        endpoint="/inventory/import"
        fields={[{ key: "name", label: "Product name" }, { key: "sku", label: "SKU" }, { key: "barcode", label: "Barcode" }, { key: "quantity", label: "Quantity on hand", required: true }, { key: "cost", label: "Cost price" }, { key: "price", label: "Selling price" }, { key: "category", label: "Category" }, { key: "reorderLevel", label: "Reorder level" }]}
        options={[{ key: "createMissing", label: "Add products that aren't in my catalog", hint: "needs a selling price on those rows" }]}
        tiles={(r) => [
          { label: "Stock will change", value: r.totals.update ?? 0, tone: "good" },
          { label: "New products", value: r.totals.create ?? 0, tone: r.totals.create ? "good" : undefined },
          { label: "Not in catalog", value: r.totals.missing ?? 0, tone: r.totals.missing ? "warn" : undefined },
          { label: "Unchanged / skipped", value: (r.totals.unchanged ?? 0) + (r.totals.invalid ?? 0) + (r.totals.duplicate ?? 0) },
        ]}
        columns={[{ label: "Product", cell: (r) => <>{r.name} {r.isNew && <Badge tone="brand">new</Badge>}</> }, { label: "Now", cell: (r) => r.before, align: "right" }, { label: "After upload", cell: (r) => r.after, align: "right" }]}
        saveLabel={(r) => `Update ${((r.totals.update ?? 0) + (r.totals.create ?? 0)).toLocaleString()} product${(r.totals.update ?? 0) + (r.totals.create ?? 0) === 1 ? "" : "s"}`}
        done={(r) => <>{(r.updated ?? 0).toLocaleString()} updated{r.created ? `, ${r.created.toLocaleString()} created` : ""}. Your stock history shows each change.</>}
      />
    </div>
  );
}

// ── Stock ───────────────────────────────────────────────────────────────────

function Tile({ icon: Icon, label, value, sub, tone, onClick, active }: { icon: typeof Boxes; label: string; value: string; sub?: string; tone?: "warn" | "bad"; onClick?: () => void; active?: boolean }) {
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cn("text-left rounded-2xl border bg-surface px-4 py-3.5 transition-colors", active ? "border-primary shadow-e1" : "border-line", onClick && "hover:border-line-2 cursor-pointer")}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-t4"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className={cn("font-mono font-semibold text-[20px] tabular-nums mt-1 truncate", tone === "warn" && "text-warning", tone === "bad" && "text-danger", !tone && "text-t1")}>{value}</div>
      {sub && <div className="text-[11px] text-t4 mt-0.5 truncate">{sub}</div>}
    </Comp>
  );
}

function StockTab({ canCost, currency, onChanged }: { canCost: boolean; currency: string; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("status");
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const { can, hasFeature } = useSession();
  const money = (n: number) => fmtMoney(n, currency);
  const [exportError, setExportError] = useState("");
  // Every export holds exactly what the filters show.
  const filterQs = `${q ? `&q=${encodeURIComponent(q)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}${status ? `&status=${status}` : ""}`;
  async function exportAs(format: "pdf" | "xlsx" | "csv" | "print") {
    if (format !== "csv" && !hasFeature("reports")) { requestUpgrade("reports"); return; }
    setExportError("");
    try {
      if (format === "print") await openFile(`/inventory/export?format=pdf&inline=1${filterQs}`);
      else await apiDownload(`/inventory/export?format=${format}${filterQs}`, `inventory.${format}`);
    } catch (err: any) { setExportError(err.message); }
  }

  const qs = `limit=${PER}&page=${page}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}${status ? `&status=${status}` : ""}`;
  const { data, loading, reload, error } = useApi<Overview>(`/inventory/overview?${qs}`, []);
  const s = data?.summary;
  const pick = (v: string) => { setStatus(status === v ? "" : v); setPage(1); };

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Tile icon={Boxes} label="Products" value={s.items.toLocaleString()} />
          <Tile icon={Warehouse} label="Units on hand" value={s.units.toLocaleString()} />
          {canCost && s.stockValue !== undefined ? <Tile icon={Wallet} label="Stock value" value={money(s.stockValue)} sub="at cost" /> : <Tile icon={Wallet} label="Retail value" value={money(s.retailValue)} />}
          {canCost && s.potentialProfit !== undefined ? <Tile icon={TrendingUp} label="Potential profit" value={money(s.potentialProfit)} sub={`${money(s.retailValue)} at retail`} /> : <div className="hidden lg:block" />}
          <Tile icon={AlertTriangle} label="Running low" value={String(s.low)} tone={s.low ? "warn" : undefined} onClick={() => pick("low")} active={status === "low"} />
          <Tile icon={PackageX} label="Out of stock" value={String(s.out)} tone={s.out ? "bad" : undefined} onClick={() => pick("out")} active={status === "out"} />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, SKU or barcode…" className="!w-64 !pl-9" />
        </div>
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="!w-44" aria-label="Category">
          <option value="">All categories</option>
          {(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-44" aria-label="Stock status">
          <option value="">Any level</option><option value="instock">Hide zero stock</option><option value="ok">In stock</option><option value="low">Low</option><option value="out">Zero stock only</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="!w-44 ml-auto" aria-label="Sort by">
          <option value="status">Needs attention first</option><option value="name">Name</option><option value="stock">Lowest stock</option><option value="-stock">Highest stock</option>{canCost && <option value="value">Highest value</option>}
        </Select>
      </div>
      {can("inventory_export") && (
        <div className="flex items-center gap-2 flex-wrap -mt-1">
          <span className="text-[12px] text-t3 mr-1">{q || category || status ? "Export what's shown:" : "Export the list:"}</span>
          <Button size="sm" variant="secondary" onClick={() => exportAs("pdf")}><FileDown className="w-3.5 h-3.5" /> PDF <LockChip feature="reports" /></Button>
          <Button size="sm" variant="secondary" onClick={() => exportAs("xlsx")}><FileSpreadsheet className="w-3.5 h-3.5" /> Excel <LockChip feature="reports" /></Button>
          <Button size="sm" variant="secondary" onClick={() => exportAs("print")}><Printer className="w-3.5 h-3.5" /> Print <LockChip feature="reports" /></Button>
          <Button size="sm" variant="ghost" onClick={() => exportAs("csv")}><Download className="w-3.5 h-3.5" /> CSV</Button>
        </div>
      )}
      <ErrorBanner message={exportError} />

      {loading && !data ? <div className="py-16"><Spinner /></div> : !data || data.items.length === 0 ? (
        <Card><EmptyState icon={Boxes} title={q || category || status ? "Nothing matches" : "No products yet"} body={q || category || status ? "Try a different search or filter." : "Add products in the catalog, or import your opening stock."} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[720px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-t4">
                  <th className="px-4 py-2.5">Product</th><th className="px-3 py-2.5 text-right">In stock</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Reorder at</th>
                  <th className="px-3 py-2.5 text-right">Price</th>{canCost && <th className="px-3 py-2.5 text-right">Cost</th>}{canCost && <th className="px-3 py-2.5 text-right">Value</th>}<th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <td className="px-4 py-2.5"><div className="font-semibold text-t1">{p.name}</div><div className="text-[11.5px] text-t3">{p.category}{p.sku ? ` · ${p.sku}` : ""}</div></td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-t1">{p.stock.toLocaleString()} <span className="text-t4 font-normal text-[11px]">{p.unit}</span></td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-t3">{p.reorderLevel}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-t2">{money(p.price)}</td>
                    {canCost && <td className="px-3 py-2.5 text-right font-mono tabular-nums text-t3">{money(p.cost || 0)}</td>}
                    {canCost && <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-t1">{money(p.stockValue || 0)}</td>}
                    <td className="px-3 py-2.5 text-right">{can("stock_adjust") && <Button size="sm" variant="ghost" onClick={() => setAdjusting(p)} aria-label={`Adjust ${p.name}`}><Sliders className="w-3.5 h-3.5" /> Adjust</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.items.length} onPage={setPage} noun="products" />
        </Card>
      )}

      <AdjustModal row={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); reload(); onChanged(); }} />
    </div>
  );
}

function AdjustModal({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("Stock count");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (row) { setQty(String(row.stock)); setReason("Stock count"); setError(""); } }, [row]);
  if (!row) return null;
  const next = Number(qty);
  const delta = Number.isFinite(next) ? next - row.stock : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api("/inventory/adjust", { method: "POST", body: JSON.stringify({ productId: row!.id, newQty: next, reason }) }); onDone(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Adjust ${row.name}`} subtitle={`Currently ${row.stock} ${row.unit} in stock`}>
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="What's really on the shelf now" hint={delta === 0 ? "Same as the system" : delta > 0 ? `That adds ${delta}` : `That removes ${-delta}`}>
          <Input type="number" min={0} step="any" required autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason"><Input required minLength={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button type="submit" className="w-full" disabled={busy || !Number.isFinite(next) || next < 0 || delta === 0}>{busy ? "Saving…" : "Save new count"}</Button>
        <p className="text-[11.5px] text-t4">Recorded in the stock history with your name.</p>
      </form>
    </Modal>
  );
}

// ── Value ───────────────────────────────────────────────────────────────────

type Valuation = {
  asOf: string; totals: { items: number; units: number; atCost: number; atRetail: number; potentialProfit: number; marginPct: number };
  byCategory: { category: string; items: number; units: number; atCost: number; atRetail: number; sharePct: number }[];
  topByValue: { id: string; name: string; stock: number; cost: number; stockValue: number; sharePct: number }[];
};

function ValueTab({ currency }: { currency: string }) {
  const { data, loading, error } = useApi<Valuation>("/inventory/valuation", []);
  const money = (n: number) => fmtMoney(n, currency);
  if (loading && !data) return <div className="py-16"><Spinner /></div>;
  if (!data) return <ErrorBanner message={error || "Couldn't load the valuation."} />;
  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Wallet} label="Stock at cost" value={money(t.atCost)} sub={`${t.units.toLocaleString()} units · ${t.items} products`} />
        <Tile icon={TrendingUp} label="Stock at retail" value={money(t.atRetail)} />
        <Tile icon={Flame} label="Potential profit" value={money(t.potentialProfit)} sub={`${t.marginPct}% margin`} />
        <Tile icon={Hourglass} label="As of" value={fmtDate(data.asOf)} sub="Counts as recorded in the system" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="text-[14px] font-semibold text-t1 mb-3">Where the money sits</div>
          <div className="space-y-3">
            {data.byCategory.map((c) => (
              <div key={c.category}>
                <div className="flex justify-between text-[12.5px] mb-1"><span className="font-medium text-t2">{c.category} <span className="text-t4">· {c.items}</span></span><span className="font-mono font-semibold text-t1 tabular-nums">{money(c.atCost)} <span className="text-t4 font-normal">({c.sharePct}%)</span></span></div>
                <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, c.sharePct)}%`, background: "var(--st-gradient-primary)" }} /></div>
              </div>
            ))}
            {!data.byCategory.length && <div className="text-[13px] text-t3 py-4 text-center">No stock on the shelf yet.</div>}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-[14px] font-semibold text-t1 mb-3">Biggest holdings</div>
          <ol className="divide-y divide-line">
            {data.topByValue.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className="w-5 text-t4 font-mono text-[12px]">{i + 1}</span>
                <div className="min-w-0 flex-1"><div className="font-semibold text-t1 truncate">{p.name}</div><div className="text-[11.5px] text-t3">{p.stock.toLocaleString()} × {money(p.cost)}</div></div>
                <div className="text-right"><div className="font-mono font-semibold tabular-nums">{money(p.stockValue)}</div><div className="text-[11px] text-t4">{p.sharePct}%</div></div>
              </li>
            ))}
          </ol>
          {!data.topByValue.length && <div className="text-[13px] text-t3 py-4 text-center">Nothing in stock.</div>}
        </Card>
      </div>
    </div>
  );
}

// ── What's selling ──────────────────────────────────────────────────────────

type Mover = { id: string; name: string; stock: number; unit: string; sold: number; revenue: number; perDay: number; coverDays: number | null; lastSoldAt: string | null; stockValue?: number };
type Movers = { days: number; fast: Mover[]; runningOut: Mover[]; dead: Mover[]; slow: Mover[] };

function MoversTab({ canCost, currency }: { canCost: boolean; currency: string }) {
  const [days, setDays] = useState(30);
  const { data, loading } = useApi<Movers>(`/inventory/movers?days=${days}`, []);
  const money = (n: number) => fmtMoney(n, currency);
  const lists: { key: keyof Omit<Movers, "days">; title: string; hint: string; icon: typeof Flame; empty: string; line: (m: Mover) => string }[] = [
    { key: "fast", title: "Selling fast", hint: `Most units sold in ${days} days`, icon: Flame, empty: "No sales in this period yet.", line: (m) => `${m.sold.toLocaleString()} sold · ${money(m.revenue)}` },
    { key: "runningOut", title: "Running out soon", hint: "7 days or less of stock at the current pace", icon: Hourglass, empty: "Nothing is about to run out.", line: (m) => `${m.stock} left · ~${m.coverDays} days` },
    { key: "dead", title: "Not selling", hint: `Stock on the shelf, nothing sold in ${days} days`, icon: PackageX, empty: "Everything on the shelf has sold.", line: (m) => `${m.stock.toLocaleString()} ${m.unit} idle${canCost && m.stockValue ? ` · ${money(m.stockValue)} tied up` : ""}` },
    { key: "slow", title: "Slow movers", hint: "More than 3 months of stock at the current pace", icon: Warehouse, empty: "No overstocked items.", line: (m) => `${m.stock.toLocaleString()} left · ~${Math.round(m.coverDays || 0)} days of cover` },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-t3">Looking at the last</span>
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="!w-32" aria-label="Period">
          <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">12 months</option>
        </Select>
      </div>
      {loading && !data ? <div className="py-16"><Spinner /></div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {lists.map((l) => (
            <Card key={l.key} className="p-5">
              <div className="flex items-center gap-2.5 mb-1"><span className="grid place-items-center w-8 h-8 rounded-xl bg-primary-soft text-primary"><l.icon className="w-4 h-4" /></span><div className="text-[14px] font-semibold text-t1">{l.title}</div></div>
              <div className="text-[12px] text-t3 mb-3">{l.hint}</div>
              {(data?.[l.key] || []).length === 0 ? <div className="text-[13px] text-t3 py-5 text-center">{l.empty}</div> : (
                <ul className="divide-y divide-line">
                  {(data![l.key] as Mover[]).map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-[13px]"><span className="font-medium text-t1 truncate">{m.name}</span><span className="text-t3 text-[12px] shrink-0 tabular-nums">{l.line(m)}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
