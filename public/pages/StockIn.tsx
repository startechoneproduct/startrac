import { useMemo, useRef, useState } from "react";
import {
  PackagePlus, Plus, Trash2, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  Undo2, Wrench, RotateCcw, FlaskConical, Search, FileSpreadsheet, Upload, Paperclip, X,
  Printer, ChevronDown, ChevronRight, Truck, CheckCircle2, AlertTriangle, Download,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { LockChip, requestUpgrade } from "@/components/plan/PlanUi";
import { api, downloadFile, openFile } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDate, fmtDateTime, fmtMoney, todayStr } from "@/lib/format";
import { printReport, mono } from "@/lib/printReport";
import { downloadXlsx, S } from "@/lib/xlsx";
import { cn } from "@/lib/utils";
import { fuzzySearch } from "@/lib/fuzzy";

type Product = {
  id: string; name: string; stock: number; sku?: string; barcode?: string; archetype?: string;
  tracksSerials?: boolean; unit?: string; purchaseUnit?: string; unitsPerPurchase?: number;
};
type Supplier = { id: string; name: string };
type Movement = {
  id: string; productName: string; type: string; qty: number; balanceAfter: number;
  reason: string; actorName: string; at: string; refType?: string;
  unitCost?: number; supplierName?: string; wasteReason?: string;
};
type Receipt = {
  id: string; receiptNo: string; supplierName: string; receivedOn: string; reference: string; note: string; source: string;
  actorName: string; createdAt: string; totalQty: number; lineCount: number; totalCost?: number | null; costedLines?: number;
  lines: { productId: string; name: string; qty: number; stockAfter: number; unitCost?: number | null; lineCost?: number | null }[];
  attachments: { id: string; name: string; mime: string; size: number }[];
};
type Line = { key: string; productId: string; qty: string; unitCost: string; serials: string };
const blankLine = (): Line => ({ key: crypto.randomUUID(), productId: "", qty: "1", unitCost: "", serials: "" });
type ParseResult = {
  fileName: string; lines: { productId: string; name: string; qty: number; unitCost: number | null }[];
  problems: { row: number; reason: string; warning?: boolean }[]; skipped: number;
  totals: { rows: number; matched: number; errors: number };
};

const TYPE_META: Record<string, { label: string; icon: any; tone: "success" | "danger" | "brand" | "warning" | "neutral" }> = {
  IN: { label: "Stock in", icon: ArrowDownToLine, tone: "success" },
  OUT: { label: "Sale", icon: ArrowUpFromLine, tone: "neutral" },
  TRANSFER_IN: { label: "Transfer in", icon: ArrowLeftRight, tone: "brand" },
  TRANSFER_OUT: { label: "Transfer out", icon: ArrowLeftRight, tone: "warning" },
  RETURN: { label: "Return", icon: Undo2, tone: "brand" },
  ADJUST: { label: "Adjustment", icon: Wrench, tone: "warning" },
  VOID_RESTOCK: { label: "Void restock", icon: RotateCcw, tone: "danger" },
};
const WASTE_META = { label: "Waste", icon: FlaskConical, tone: "danger" as const };
const WASTE_REASONS = [
  { key: "spoilage", label: "Spoilage" },
  { key: "staff_meal", label: "Staff meal" },
  { key: "damage", label: "Damage" },
  { key: "expired", label: "Expired" },
  { key: "broken", label: "Broken" },
  { key: "cracked", label: "Cracked" },
  { key: "rotten", label: "Rotten" },
  { key: "contaminated", label: "Contaminated" },
  { key: "other", label: "Other" },
];

const LEDGER_FILTERS = [
  { key: "", label: "All" },
  { key: "IN", label: "Stock in" },
  { key: "OUT", label: "Sales" },
  { key: "TRANSFER_OUT", label: "Transfers" },
  { key: "RETURN", label: "Returns" },
  { key: "ADJUST", label: "Adjustments" },
  { key: "waste", label: "Waste", byRefType: true },
];

type Tab = "receive" | "deliveries" | "waste" | "ledger";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function StockIn() {
  const { activeBranch, activeBusiness, hasModule, hasFeature, currency } = useSession();
  const [tab, setTab] = useState<Tab>("receive");
  const { data: prodData, reload: reloadProducts } = useApi<{ products: Product[] }>("/products", [activeBranch?.id]);
  const { data: supData, reload: reloadSuppliers } = useApi<{ suppliers: Supplier[] }>(hasModule("suppliers") && hasFeature("suppliers") ? "/suppliers" : null, [activeBranch?.id]);
  const [version, setVersion] = useState(0);
  const products = (prodData?.products || []).filter((p) => p.archetype !== "made_to_order");
  const suppliers = supData?.suppliers || [];
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [justReceived, setJustReceived] = useState<string | null>(null);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader title="Stock In" subtitle={`Receive deliveries into ${activeBranch?.name || "this branch"}. Quantities are added to what is already in stock.`} />
      <div className="mb-5">
        <Segmented
          options={[["receive", "Receive stock"], ["deliveries", "Deliveries"], ["waste", "Log waste"], ["ledger", "Movement history"]] as const}
          value={tab} onChange={setTab}
        />
      </div>

      {tab === "receive" && (
        <ReceiveForm
          products={products} productById={productById} suppliers={suppliers} showSuppliers={hasModule("suppliers")} onSuppliersChanged={reloadSuppliers}
          currency={currency}
          onDone={(receiptId) => { reloadProducts(); setVersion((v) => v + 1); setJustReceived(receiptId); }}
          onViewDelivery={() => setTab("deliveries")}
          justReceived={justReceived}
        />
      )}
      {tab === "deliveries" && <Deliveries key={version} currency={currency} businessName={activeBusiness?.name || ""} highlight={justReceived} />}
      {tab === "waste" && <Card className="p-5 max-w-[560px]"><WasteForm products={products} onDone={() => { reloadProducts(); setVersion((v) => v + 1); }} /></Card>}
      {tab === "ledger" && <Ledger key={version} currency={currency} branchKey={activeBranch?.id} />}
    </div>
  );
}

// ── Receive a delivery ───────────────────────────────────────

function ReceiveForm({ products, productById, suppliers, showSuppliers, onSuppliersChanged, currency, onDone, onViewDelivery, justReceived }: {
  products: Product[]; productById: Map<string, Product>; suppliers: Supplier[]; showSuppliers: boolean; onSuppliersChanged: () => void; currency: string;
  onDone: (receiptId: string) => void; onViewDelivery: () => void; justReceived: string | null;
}) {
  const { hasFeature } = useSession();
  const money = (n: number) => fmtMoney(n, currency);
  // Starts with one empty row to pick a product in; more rows are one click away.
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [supplierId, setSupplierId] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayStr());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ receiptNo: string; count: number; units: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fromSheet, setFromSheet] = useState(false);
  const sheetRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const factorOf = (p?: Product) => (p?.unitsPerPurchase && p.unitsPerPurchase > 1 ? p.unitsPerPurchase : 1);
  const matches = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return [];
    const exact = products.filter((p) => p.barcode === search.trim() || p.sku?.toLowerCase() === t);
    return [...exact, ...fuzzySearch(products.filter((p) => !exact.includes(p)), search, (p) => [p.name, p.sku, p.barcode])].slice(0, 8);
  }, [search, products]);

  function addProduct(p: Product, qty = 1, unitCost: number | null = null) {
    setDone(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: String((Number(l.qty) || 0) + qty), unitCost: unitCost !== null ? String(unitCost) : l.unitCost } : l));
      const filled = { productId: p.id, qty: String(qty), unitCost: unitCost !== null ? String(unitCost) : "", serials: "" };
      // Fill an empty row if there is one, otherwise add a new row.
      const blank = ls.findIndex((l) => !l.productId);
      if (blank >= 0) return ls.map((l, j) => (j === blank ? { ...l, ...filled } : l));
      return [...ls, { key: crypto.randomUUID(), ...filled }];
    });
    setSearch("");
  }
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = products.find((p) => p.barcode === search.trim() || (p.sku && p.sku.toLowerCase() === search.trim().toLowerCase()));
    if (exact) addProduct(exact);
    else if (matches.length === 1) addProduct(matches[0]);
  }

  async function uploadSheet(file: File) {
    if (!hasFeature("csvImport")) { requestUpgrade("csvImport"); return; }
    setParsing(true); setError(""); setSheet(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<ParseResult>("/stock-receipts/parse", { method: "POST", body: form });
      setSheet(r);
      for (const l of r.lines) {
        const p = productById.get(String(l.productId));
        if (!p) continue;
        // The sheet is in stock units; the form shows purchase units where a product has them.
        const f = factorOf(p);
        addProduct(p, f > 1 ? l.qty / f : l.qty, l.unitCost !== null ? l.unitCost * f : null);
      }
      if (r.lines.length) setFromSheet(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setParsing(false);
      if (sheetRef.current) sheetRef.current.value = "";
    }
  }

  function pickDocs(list: FileList | null) {
    if (!list) return;
    const ok = [...list].filter((f) => /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(f.type) && f.size <= 3 * 1024 * 1024);
    if (ok.length < list.length) setError("Only photos and PDFs up to 3 MB can be attached.");
    setFiles((cur) => [...cur, ...ok].slice(0, 3));
    if (docRef.current) docRef.current.value = "";
  }

  const allRows = lines.map((l) => {
    const p = productById.get(l.productId);
    const f = factorOf(p);
    const qty = Number(l.qty) || 0;
    const cost = l.unitCost === "" ? null : Number(l.unitCost);
    return { line: l, product: p, factor: f, qty, units: Math.round(qty * f), cost, lineTotal: cost !== null && Number.isFinite(cost) ? cost * qty : null };
  });
  // Rows still waiting for a product are shown but never sent.
  const rows = allRows.filter((x) => x.product);
  const chosen = new Set(lines.map((l) => l.productId).filter(Boolean));
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const costed = rows.filter((r) => r.lineTotal !== null);
  const totalCost = costed.reduce((s, r) => s + (r.lineTotal || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!rows.length) { setError("Add at least one product to this delivery."); return; }
    const bad = rows.find((r) => !(r.qty > 0) || !Number.isInteger(r.units));
    if (bad) { setError(`${bad.product?.name || "A line"}: enter a whole quantity above zero.`); return; }
    const badCost = rows.find((r) => r.cost !== null && (!Number.isFinite(r.cost) || r.cost < 0));
    if (badCost) { setError(`${badCost.product?.name}: the unit cost isn't a valid amount.`); return; }
    for (const r of rows.filter((x) => x.product?.tracksSerials)) {
      const count = r.line.serials.split("\n").map((s) => s.trim()).filter(Boolean).length;
      if (count !== r.units) { setError(`${r.product!.name}: entered ${count} serial number(s) for ${r.units} units.`); return; }
    }

    setBusy(true);
    try {
      const res = await api<{ items: { name: string; added: number; stock: number }[]; receipt: { id: string; receiptNo: string } }>("/inventory/stock-in", {
        method: "POST",
        body: JSON.stringify({
          items: rows.map((r) => ({
            productId: r.line.productId,
            qty: r.units,
            // Bought in one unit, tracked in another: a 50kg bag's cost per kg.
            ...(r.cost !== null ? { unitCost: Number((r.cost / r.factor).toFixed(4)) } : {}),
          })),
          receivedOn, reference, note, source: fromSheet ? "spreadsheet" : "form",
          ...(supplierId ? { supplierId } : {}),
        }),
      });

      const problems: string[] = [];
      for (const r of rows.filter((x) => x.product?.tracksSerials)) {
        const serialNos = r.line.serials.split("\n").map((s) => s.trim()).filter(Boolean);
        try { await api("/serials", { method: "POST", body: JSON.stringify({ productId: r.line.productId, serialNos }) }); }
        catch (err: any) { problems.push(`serial numbers for ${r.product!.name}: ${err.message}`); }
      }
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f, f.name);
        try { await api(`/stock-receipts/${res.receipt.id}/attachments`, { method: "POST", body: fd }); }
        catch (err: any) { problems.push(`attaching ${f.name}: ${err.message}`); }
      }
      if (problems.length) setError(`Stock was received, but there was a problem with ${problems.join("; ")}.`);

      setDone({ receiptNo: res.receipt.receiptNo, count: res.items.length, units: res.items.reduce((s, i) => s + i.added, 0) });
      setLines([blankLine()]); setReference(""); setNote(""); setFiles([]); setSheet(null); setFromSheet(false); setReceivedOn(todayStr());
      onDone(res.receipt.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <ErrorBanner message={error} />
      {done && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-3 rounded-card bg-success-soft border border-success/30">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <div className="text-[13px] text-t1 flex-1"><b>{done.receiptNo}</b> received: {done.count} {done.count === 1 ? "product" : "products"}, {done.units} units added to stock.</div>
          {justReceived && <Button type="button" size="sm" variant="secondary" onClick={onViewDelivery}>View delivery</Button>}
        </div>
      )}

      <Card className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {showSuppliers && (
            <SupplierField
              value={supplierId}
              suppliers={suppliers}
              onChange={setSupplierId}
              onAdded={(id) => { onSuppliersChanged(); setSupplierId(id); }}
            />
          )}
          <Field label="Date received"><Input type="date" required max={todayStr()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></Field>
          <Field label="Supplier invoice no." hint="Optional"><Input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} placeholder="e.g. INV-2041" /></Field>
          <Field label="Note" hint="Optional"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivered by van" /></Field>
        </div>
      </Card>

      <Card className="overflow-visible">
        <div className="p-4 flex items-center gap-2 flex-wrap border-b border-line">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-t4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input aria-label="Add a product" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} placeholder="Type a product name, or scan its barcode, to add it" className="!pl-9" />
            {matches.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-line-2 bg-surface shadow-e2 overflow-hidden">
                {matches.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2">
                    <span className="flex-1 min-w-0 text-[13px] font-semibold text-t1 truncate">{p.name}</span>
                    {p.sku && <span className="text-[11px] font-mono text-t3">{p.sku}</span>}
                    <span className="text-[11.5px] text-t3">{p.stock} in stock</span>
                    <Plus className="w-4 h-4 text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={() => (hasFeature("csvImport") ? sheetRef.current?.click() : requestUpgrade("csvImport"))} disabled={parsing}>
            <Upload className="w-4 h-4" /> {parsing ? "Reading…" : "Upload spreadsheet"} <LockChip feature="csvImport" />
          </Button>
          <Button type="button" variant="ghost" onClick={() => (hasFeature("csvImport") ? downloadFile("/stock-receipts/template.xlsx", "delivery-template.xlsx").catch((e) => setError(e.message)) : requestUpgrade("csvImport"))}>
            <Download className="w-4 h-4" /> Template
          </Button>
          <input ref={sheetRef} type="file" hidden accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && uploadSheet(e.target.files[0])} />
        </div>

        {sheet && (
          <div className={cn("mx-4 mt-4 rounded-xl border px-4 py-3 text-[12.5px]", sheet.totals.errors ? "border-warning/40 bg-warning-soft" : "border-success/30 bg-success-soft")}>
            <div className="flex items-center gap-2 font-semibold text-t1">
              <FileSpreadsheet className="w-4 h-4" /> {sheet.fileName}: {sheet.totals.matched} {sheet.totals.matched === 1 ? "product" : "products"} added below
              {sheet.skipped > 0 && <span className="font-normal text-t3">. {sheet.skipped} {sheet.skipped === 1 ? "row" : "rows"} with no quantity skipped</span>}
              <button type="button" onClick={() => setSheet(null)} className="ml-auto p-1 text-t3 hover:text-t1" aria-label="Dismiss"><X className="w-4 h-4" /></button>
            </div>
            {sheet.problems.length > 0 && (
              <ul className="mt-2 space-y-1 text-t2">
                {sheet.problems.map((p, i) => (
                  <li key={i} className="flex gap-2"><AlertTriangle className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", p.warning ? "text-t3" : "text-warning")} /> Row {p.row}: {p.reason}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-t3">Check the lines below, then press Receive. Nothing is in stock until you do.</div>
          </div>
        )}

        {allRows.length === 0 ? (
          <div className="py-12 text-center">
            <Truck className="w-8 h-8 text-t4 mx-auto mb-2" />
            <div className="text-[13.5px] font-semibold text-t1">No products in this delivery yet</div>
            <div className="text-[12.5px] text-t3 mt-1">Search above to add products one by one, or upload a spreadsheet of the whole delivery.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] mt-1">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-[0.06em] text-t3 border-b border-line">
                  <th className="px-4 py-2.5 font-semibold">Product</th>
                  <th className="px-3 py-2.5 font-semibold text-right">In stock</th>
                  <th className="px-3 py-2.5 font-semibold w-[130px]">Quantity</th>
                  <th className="px-3 py-2.5 font-semibold w-[150px]">Unit cost</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Line total</th>
                  <th className="px-3 py-2.5 font-semibold text-right">After</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {allRows.map((r, i) => (
                  <tr key={r.line.key} className="align-top">
                    <td className="px-4 py-2.5">
                      {r.product ? (
                        <div className="font-semibold text-t1">{r.product.name}</div>
                      ) : (
                        <Select aria-label="Choose a product" value="" onChange={(e) => setLine(i, { productId: e.target.value })} className="min-w-[220px]">
                          <option value="">Choose a product…</option>
                          {products.filter((p) => !chosen.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock} in stock)</option>)}
                        </Select>
                      )}
                      {r.product?.sku && <div className="text-[11px] font-mono text-t4">{r.product.sku}</div>}
                      {r.factor > 1 && r.product?.purchaseUnit && <div className="text-[11px] text-t3">{r.qty} {r.product.purchaseUnit} = {r.units} {r.product.unit || "units"}</div>}
                      {r.product?.tracksSerials && (
                        <TextArea rows={2} className="mt-2" aria-label={`Serial numbers for ${r.product.name}`} value={r.line.serials} onChange={(e) => setLine(i, { serials: e.target.value })} placeholder={`One serial number per line (${r.units})`} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-t3">{r.product ? r.product.stock : ""}</td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Quantity of ${r.product?.name}`} type="number" min="1" step="1" inputMode="numeric" value={r.line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                      {r.factor > 1 && r.product?.purchaseUnit && <div className="text-[10.5px] text-t4 mt-0.5">in {r.product.purchaseUnit}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Unit cost of ${r.product?.name}`} type="number" min="0" step="0.01" inputMode="decimal" value={r.line.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} placeholder="Optional" />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-t1">{!r.product ? "" : r.lineTotal !== null ? money(r.lineTotal) : <span className="text-t4">not set</span>}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-success">{r.product ? r.product.stock + r.units : ""}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${r.product?.name}`} className="h-9 w-9 rounded-ctl flex items-center justify-center text-t4 hover:text-danger hover:bg-danger-soft"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-2 font-bold text-t1">
                  <td className="px-4 py-3">{rows.length} {rows.length === 1 ? "product" : "products"}</td>
                  <td />
                  <td className="px-3 py-3 font-mono">{totalUnits} units</td>
                  <td />
                  <td className="px-3 py-3 text-right font-mono">{costed.length ? money(totalCost) : "None"}</td>
                  <td colSpan={2} className="px-3 py-3 text-[11.5px] font-normal text-t3">{costed.length && costed.length < rows.length ? `${rows.length - costed.length} without a cost` : ""}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-line">
          <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            <Plus className="w-3.5 h-3.5" /> Add another product
          </Button>
        </div>
      </Card>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {files.map((f, i) => (
            <span key={f.name + i} className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-lg border border-line-2 bg-surface text-[12px]">
              <Paperclip className="w-3.5 h-3.5 text-t3" /><span className="max-w-[180px] truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="p-1 text-t4 hover:text-danger"><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
          {files.length < 3 && <Button type="button" variant="secondary" size="sm" onClick={() => docRef.current?.click()}><Paperclip className="w-3.5 h-3.5" /> Attach supplier invoice</Button>}
          <input ref={docRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={(e) => pickDocs(e.target.files)} />
        </div>
        <Button type="submit" disabled={busy || !rows.length}>
          <PackagePlus className="w-4 h-4" /> {busy ? "Receiving…" : rows.length ? `Receive ${rows.length} ${rows.length === 1 ? "product" : "products"}` : "Receive stock"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Who the delivery came from: pick one, or add a new supplier by name right
 * here, without leaving the delivery half typed in.
 */
function SupplierField({ value, suppliers, onChange, onAdded }: {
  value: string; suppliers: Supplier[]; onChange: (id: string) => void; onAdded: (id: string) => void;
}) {
  const { hasFeature, can } = useSession();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = !hasFeature("suppliers");

  async function save() {
    if (!name.trim()) return;
    setBusy(true); setError("");
    try {
      const r = await api<{ supplier: Supplier }>("/suppliers", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      onAdded(r.supplier.id);
      setAdding(false); setName("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <Field label="New supplier" hint={error || "Saved to your suppliers list too"}>
        <div className="flex gap-1.5">
          <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dangote Depot"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setAdding(false); }} />
          <Button type="button" size="sm" className="!h-10" onClick={save} disabled={busy || !name.trim()}>{busy ? "…" : "Add"}</Button>
          <Button type="button" size="sm" variant="ghost" className="!h-10" onClick={() => setAdding(false)} aria-label="Cancel"><X className="w-4 h-4" /></Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Supplier" hint={locked ? "Suppliers are on the Pro plan" : suppliers.length ? "Optional" : "No suppliers yet: add one"}>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value !== "__new") return onChange(e.target.value);
          if (locked) return requestUpgrade("suppliers");
          setAdding(true);
        }}
      >
        <option value="">Not specified</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        {(can("stock") || locked) && <option value="__new">+ Add a new supplier…</option>}
      </Select>
    </Field>
  );
}

// ── Deliveries received ──────────────────────────────────────

function Deliveries({ currency, businessName, highlight }: { currency: string; businessName: string; highlight: string | null }) {
  const money = (n: number) => fmtMoney(n, currency);
  const [qInput, setQInput] = useState("");
  const q = qInput.trim();
  const { data, loading, error } = useApi<{ receipts: Receipt[] }>(`/stock-receipts${q ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  const receipts = data?.receipts || [];
  const paged = usePaged(receipts);
  const [open, setOpen] = useState<string | null>(highlight);
  const seesCost = receipts.some((r) => r.totalCost !== undefined);

  function printOne(r: Receipt) {
    printReport({
      businessName,
      title: `Goods received ${r.receiptNo}`,
      subtitle: [`Received ${fmtDate(r.receivedOn)}`, r.supplierName && `from ${r.supplierName}`, r.reference && `invoice ${r.reference}`, `by ${r.actorName}`].filter(Boolean).join(" · "),
      columns: [
        { label: "Product", render: (l: Receipt["lines"][number]) => esc(l.name) },
        { label: "Quantity", align: "right", render: (l) => mono(String(l.qty)) },
        ...(seesCost ? [
          { label: "Unit cost", align: "right" as const, render: (l: Receipt["lines"][number]) => (l.unitCost != null ? mono(esc(money(l.unitCost))) : "") },
          { label: "Line total", align: "right" as const, render: (l: Receipt["lines"][number]) => (l.lineCost != null ? mono(esc(money(l.lineCost))) : "") },
        ] : []),
        { label: "Stock after", align: "right", render: (l) => mono(String(l.stockAfter)) },
      ],
      rows: r.lines,
      totals: ["Total", String(r.totalQty), ...(seesCost ? ["", r.totalCost != null ? money(r.totalCost) : ""] : []), ""],
    });
  }

  function exportAll() {
    const head = ["Delivery", "Received", "Supplier", "Invoice no.", "Product", "Quantity", ...(seesCost ? ["Unit cost", "Line total"] : []), "Received by"];
    const rows = receipts.flatMap((r) => r.lines.map((l) => [r.receiptNo, r.receivedOn, r.supplierName, r.reference, l.name, l.qty, ...(seesCost ? [l.unitCost ?? "", l.lineCost ?? ""] : []), r.actorName]));
    downloadXlsx(`deliveries-${todayStr()}.xlsx`, [{
      name: "Deliveries",
      freezeHeader: true,
      autoFilterCols: head.length,
      cols: head.map((h) => ({ width: Math.max(12, h.length + 4) })),
      rows: [
        head.map((h) => ({ v: h, s: S.HEADER })),
        ...rows.map((row) => row.map((v) => (typeof v === "number" ? { v, s: S.INT, type: "number" as const } : { v: String(v ?? ""), s: S.CELL }))),
      ],
    }]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-t4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input aria-label="Search deliveries" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search by GRN, invoice no., supplier or product" className="!pl-9" />
        </div>
        <Button variant="secondary" onClick={exportAll} disabled={!receipts.length}><FileSpreadsheet className="w-4 h-4" /> Export to Excel</Button>
      </div>
      {error ? <Card><EmptyState icon={Truck} title="Couldn't load deliveries" body={error} /></Card> : loading ? <Spinner /> : !receipts.length ? (
        <Card><EmptyState icon={Truck} title={q ? "No deliveries match" : "No deliveries yet"} body={q ? "Try another search." : "Each delivery you receive is kept here as one record, with its own number, to print or check later."} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {paged.rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <div key={r.id} className={cn(highlight === r.id && "bg-success-soft/40")}>
                  <button onClick={() => setOpen(isOpen ? null : r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-t3 shrink-0" /> : <ChevronRight className="w-4 h-4 text-t3 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[13px] font-bold text-t1">{r.receiptNo}</span>
                        {r.supplierName && <span className="text-[13px] text-t1">{r.supplierName}</span>}
                        {r.reference && <Badge tone="neutral">invoice {r.reference}</Badge>}
                        {r.source === "spreadsheet" && <Badge tone="brand">from spreadsheet</Badge>}
                        {r.attachments.length > 0 && <Paperclip className="w-3.5 h-3.5 text-t3" />}
                      </div>
                      <div className="text-[11.5px] text-t3">{fmtDate(r.receivedOn)} · {r.lineCount} {r.lineCount === 1 ? "product" : "products"} · {r.totalQty} units · {r.actorName}</div>
                    </div>
                    {r.totalCost != null && (
                      <span className="text-right shrink-0">
                        <span className="block font-mono text-[13.5px] font-semibold text-t1">{money(r.totalCost)}</span>
                        {(r.costedLines ?? 0) < r.lineCount && <span className="block text-[11px] text-t4">{r.lineCount - (r.costedLines ?? 0)} without a cost</span>}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pl-11">
                      <table className="w-full text-[12.5px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-t3 border-b border-line">
                            <th className="py-1.5 font-semibold">Product</th>
                            <th className="py-1.5 font-semibold text-right">Quantity</th>
                            {seesCost && <><th className="py-1.5 font-semibold text-right">Unit cost</th><th className="py-1.5 font-semibold text-right">Line total</th></>}
                            <th className="py-1.5 font-semibold text-right">Stock after</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {r.lines.map((l) => (
                            <tr key={l.productId}>
                              <td className="py-1.5 text-t1">{l.name}</td>
                              <td className="py-1.5 text-right font-mono">{l.qty}</td>
                              {seesCost && <><td className="py-1.5 text-right font-mono">{l.unitCost != null ? money(l.unitCost) : ""}</td><td className="py-1.5 text-right font-mono">{l.lineCost != null ? money(l.lineCost) : ""}</td></>}
                              <td className="py-1.5 text-right font-mono text-t3">{l.stockAfter}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.note && <div className="mt-2 text-[12px] text-t2">Note: {r.note}</div>}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="secondary" onClick={() => printOne(r)}><Printer className="w-3.5 h-3.5" /> Print</Button>
                        {r.attachments.map((a) => (
                          <Button key={a.id} size="sm" variant="ghost" onClick={() => openFile(`/stock-receipts/${r.id}/attachments/${a.id}`)}><Paperclip className="w-3.5 h-3.5" /> {a.name}</Button>
                        ))}
                        <span className="ml-auto text-[11.5px] text-t4">Recorded {fmtDateTime(r.createdAt)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Pager {...paged} onPage={paged.setPage} noun="deliveries" />
        </Card>
      )}
    </div>
  );
}

// ── Movement history ─────────────────────────────────────────

function Ledger({ currency, branchKey }: { currency: string; branchKey?: string }) {
  const [ledgerFilter, setLedgerFilter] = useState<{ key: string; byRefType?: boolean }>({ key: "" });
  const { data: moveData, loading } = useApi<{ movements: Movement[] }>(
    `/inventory/movements?limit=60${ledgerFilter.key ? `&${ledgerFilter.byRefType ? "refType" : "type"}=${ledgerFilter.key}` : ""}`,
    [branchKey]
  );
  const paged = usePaged(moveData?.movements || []);
  return (
    <Card className="overflow-hidden">
      <div className="p-4 pb-2 flex items-center gap-3 flex-wrap">
        <span className="text-[14px] font-semibold text-t1">Every stock movement, newest first</span>
        <div className="flex gap-1.5 ml-auto flex-wrap">
          {LEDGER_FILTERS.map((f) => (
            <button
              key={f.key || "all"}
              onClick={() => setLedgerFilter(f)}
              className={cn(
                "px-2.5 h-7 rounded-full text-[11px] font-semibold border transition-colors",
                ledgerFilter.key === f.key ? "bg-primary-soft border-brand-400 text-primary" : "bg-surface-2 border-line-2 text-t3 hover:text-t1"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <Spinner />
      ) : !moveData?.movements.length ? (
        <EmptyState icon={PackagePlus} title="No movements yet" body="Stock-ins, sales, transfers, waste and adjustments all appear here, newest first." />
      ) : (
        <>
          <div className="divide-y divide-line">
            {paged.rows.map((m) => {
              const meta = m.refType === "waste" ? WASTE_META : TYPE_META[m.type] || TYPE_META.ADJUST;
              const Icon = meta.icon;
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    m.qty > 0 ? "bg-success-soft text-success" : m.refType === "waste" ? "bg-danger-soft text-danger" : "bg-surface-3 text-t3")}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-t1 truncate">{m.productName}</div>
                    <div className="text-[11px] text-t3 truncate">
                      <Badge tone={meta.tone} className="mr-1.5">{meta.label}</Badge>
                      {m.unitCost !== undefined && `${fmtMoney(m.unitCost, currency)}/unit · `}
                      {m.supplierName && `${m.supplierName} · `}
                      {m.reason && `${m.reason} · `}{m.actorName} · {fmtDateTime(m.at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn("font-mono text-[13px] font-semibold tabular-nums", m.qty > 0 ? "text-success" : "text-t1")}>
                      {m.qty > 0 ? "+" : ""}{m.qty}
                    </div>
                    <div className="text-[10px] text-t4 font-mono">bal {m.balanceAfter}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <Pager {...paged} onPage={paged.setPage} noun="movements" />
        </>
      )}
    </Card>
  );
}

function WasteForm({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("spoilage");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || qty <= 0) { setError("Choose a product and a quantity."); return; }
    setBusy(true); setError(""); setDone("");
    try {
      await api("/inventory/waste", {
        method: "POST",
        body: JSON.stringify({ productId, qty, wasteReason: reason, note }),
      });
      const name = products.find((p) => p.id === productId)?.name || "Item";
      setDone(`${name} −${qty} logged as ${WASTE_REASONS.find((r) => r.key === reason)?.label.toLowerCase()}.`);
      setProductId(""); setQty(1); setNote("");
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <ErrorBanner message={error} />
      {done && <div className="px-3 py-2.5 rounded-ctl bg-success-soft text-success text-[12px] font-semibold">{done}</div>}
      <div className="flex items-end gap-2">
        <Field label="Product" className="flex-1">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">Choose product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock} now)</option>)}
          </Select>
        </Field>
        <Field label="Qty" className="w-20">
          <Input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Reason">
        <div className="flex flex-wrap gap-1.5">
          {WASTE_REASONS.map((r) => (
            <button
              type="button"
              key={r.key}
              onClick={() => setReason(r.key)}
              className={cn(
                "px-2.5 h-7 rounded-full text-[11px] font-semibold border transition-colors",
                reason === r.key ? "bg-danger-soft border-danger/40 text-danger" : "bg-surface-2 border-line-2 text-t3 hover:text-t1"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note" hint="Optional">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. tomatoes gone bad" />
      </Field>
      <Button type="submit" variant="danger" className="w-full" disabled={busy}>
        <FlaskConical className="w-4 h-4" /> {busy ? "Logging…" : "Log waste"}
      </Button>
    </form>
  );
}
