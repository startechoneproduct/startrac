import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Package, PackageCheck, AlertTriangle, PackageX, Plus, Search, Pencil, Archive, Upload, Download, FileSpreadsheet, Printer, Barcode, Sparkles, Check, X as XIcon, Image as ImageIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { PhotoFinder } from "@/components/products/PhotoFinder";
import { StatCard } from "@/components/ui/StatCard";
import { Panel } from "@/components/ui/Panel";
import { AiMark, TypingDots } from "@/components/ai/AiBits";
import { LockChip, requestUpgrade } from "@/components/plan/PlanUi";
import { Table, TR, TH, TD } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { typeMeta } from "@/lib/businessTypes";
import { parseCsv } from "@/lib/csv";
import { parseXlsx } from "@/lib/xlsx";
import { downloadProductTemplate } from "@/lib/productTemplate";
import { printReport, mono } from "@/lib/printReport";
import { printBarcodeLabels, productCode, type LabelKind, type LabelSize } from "@/lib/barcodes";
import { fmtMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type BomLine = { productId: string; per: "sqm" | "width" | "height" | "unit"; factor: number; includeLeakage?: boolean };
type Product = {
  id: string; name: string; sku?: string; barcode: string; category: string;
  archetype?: string; bom?: BomLine[]; producedUnitsPerStockUnit?: number;
  price: number; cost?: number; reorderLevel: number; stock: number | null; status: string;
  expiry?: string | null;
  tracksSerials?: boolean;
  warrantyMonths?: number;
  unit?: string; purchaseUnit?: string; unitsPerPurchase?: number;
  imageUrl?: string;
};

const PER_LABELS: Record<BomLine["per"], string> = {
  sqm: "per m² of the order",
  width: "per meter of width",
  height: "per meter of height",
  unit: "per item (fixed)",
};

// Stock status shown as a badge next to the on-hand count — purely derived
// from fields already on the product, no extra fetch involved.
function stockStatusOf(p: Product): { label: string; tone: "success" | "warning" | "neutral" } | null {
  if (p.stock === null) return null;
  if (p.stock <= 0) return { label: "Out of Stock", tone: "neutral" };
  if (p.stock <= p.reorderLevel) return { label: "Low Stock", tone: "warning" };
  return { label: "In Stock", tone: "success" };
}

export function Products() {
  const { activeBranch, activeBusiness, currency, can, hasModule, hasCapability, hasFeature } = useSession();
  const term = typeMeta(activeBusiness?.typeKey).products;
  const { data, loading, reload } = useApi<{ products: Product[] }>("/products", [activeBranch?.id]);
  const products = useMemo(() => data?.products ?? [], [data]);
  const showCost = products.some((p) => p.cost !== undefined);
  // Presentation-only aggregate for the KPI tiles — derived from the same
  // list already on screen, no extra request.
  const stockStats = products.reduce(
    (acc, p) => {
      if (p.stock === null) return acc;
      if (p.stock <= 0) acc.out++;
      else if (p.stock <= p.reorderLevel) acc.low++;
      else acc.inStock++;
      return acc;
    },
    { inStock: 0, low: 0, out: 0 }
  );

  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [cat, setCat] = useState("All");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [findingPhotos, setFindingPhotos] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [labeling, setLabeling] = useState(false);

  // Global search (topbar) lands here with ?q= — keep the box in sync.
  useEffect(() => {
    const fromUrl = searchParams.get("q");
    if (fromUrl !== null) setQ(fromUrl);
  }, [searchParams]);

  const cats = useMemo(() => ["All", ...Array.from(new Set(products.map((p) => p.category))).sort()], [products]);
  const filtered = products.filter(
    (p) => (cat === "All" || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase())
  );
  const paged = usePaged(filtered);

  async function archive(p: Product) {
    if (!confirm(`Archive "${p.name}"? It disappears from the POS but keeps its sales history.`)) return;
    await api(`/products/${p.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title={term}
        subtitle={`${products.length} in catalog · ${activeBranch?.name || "no branch"} stock shown`}
        actions={
          <>
            <Button variant="secondary" onClick={() => (hasFeature("barcodes") ? setLabeling(true) : requestUpgrade("barcodes"))} disabled={hasFeature("barcodes") && !products.length}><Barcode className="w-4 h-4" /> Labels <LockChip feature="barcodes" /></Button>
            <Button variant="secondary" onClick={() => setPrinting(true)} disabled={!products.length}><Printer className="w-4 h-4" /> Print</Button>
            {can("products_edit") && <Button variant="secondary" onClick={() => (hasFeature("productPhotos") ? setFindingPhotos(true) : requestUpgrade("productPhotos"))} disabled={hasFeature("productPhotos") && !products.some((p) => !p.imageUrl)}><ImageIcon className="w-4 h-4" /> Find photos <LockChip feature="productPhotos" /></Button>}
            {can("products_add") && <Button variant="secondary" onClick={() => (hasFeature("csvImport") ? setImporting(true) : requestUpgrade("csvImport"))}><Upload className="w-4 h-4" /> Import CSV <LockChip feature="csvImport" /></Button>}
            {can("products_delete") && <Button variant="secondary" onClick={() => setClearing(true)} disabled={!products.length} className="hover:!text-danger hover:!border-danger/50 hover:!bg-danger-soft"><Trash2 className="w-4 h-4" /> Delete all</Button>}
            {can("products_add") && <Button onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Add product</Button>}
          </>
        }
      />

      {!loading && products.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5 mb-6">
          <StatCard index={0} label="Total products" value={String(products.length)} icon={Package} />
          <StatCard tone="success" index={1} label="In stock" value={String(stockStats.inStock)} icon={PackageCheck} />
          <StatCard tone="warning" index={2} label="Low stock" value={String(stockStats.low)} icon={AlertTriangle} />
          <StatCard tone="danger" index={3} label="Out of stock" value={String(stockStats.out)} icon={PackageX} />
        </div>
      )}

      {can("stock_in") && hasFeature("ai") && <RestockSuggestionsPanel />}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="!pl-9"
          />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-48">
          {cats.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title="No products yet"
            body="Your catalog is empty. Add your first product and it appears on the POS instantly."
            action={can("products_add") && <Button onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Add your first product</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <thead>
                <tr className="text-left">
                  {["Product", "Category", "Price", ...(showCost ? ["Cost"] : []), "Stock", ""].map((h, i) => (
                    <TH key={i}>{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((p) => {
                  const low = p.stock !== null && p.stock <= p.reorderLevel;
                  const status = stockStatusOf(p);
                  return (
                    <TR key={p.id} className="group">
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 shrink-0 rounded-lg bg-primary-soft text-primary flex items-center justify-center overflow-hidden">
                            {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-t1">{p.name}</div>
                            {(p.barcode || p.sku) && <div className="text-[11px] font-mono text-t4">{p.barcode || p.sku}</div>}
                          </div>
                        </div>
                      </TD>
                      <TD><Badge tone="neutral">{p.category}</Badge></TD>
                      <TD className="font-mono font-semibold tabular-nums">{fmtMoney(p.price, currency)}</TD>
                      {showCost && (
                        <TD className="font-mono !text-t3 tabular-nums">{p.cost !== undefined ? fmtMoney(p.cost, currency) : "—"}</TD>
                      )}
                      <TD>
                        {p.stock === null ? (
                          <Badge tone="brand">Made to order</Badge>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className={cn("font-mono text-[13px] font-semibold tabular-nums", low ? "text-danger" : "text-t1")}>
                              {p.stock}{p.unit && p.unit !== "unit" && <span className="text-t4 font-sans font-normal"> {p.unit}</span>}
                            </span>
                            {status && <Badge tone={status.tone}>{status.label}</Badge>}
                          </div>
                        )}
                      </TD>
                      <TD className="text-right whitespace-nowrap">
                        {(can("products_edit") || can("products_delete")) && (
                          <div className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity">
                            {can("products_edit") && (
                              <button onClick={() => setEditing(p)} className="p-1.5 rounded-lg text-t3 hover:text-primary hover:bg-primary-soft transition-colors" title="Edit">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {can("products_delete") && (
                              <button onClick={() => archive(p)} className="p-1.5 rounded-lg text-t3 hover:text-danger hover:bg-danger-soft transition-colors" title="Archive">
                                <Archive className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <Pager {...paged} onPage={paged.setPage} noun="products" />

        </Card>
      )}

      <ProductModal
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        editing={editing}
        showCost={can("products_add") || can("products_edit")}
        showExpiry={hasModule("expiry") && hasFeature("expiry")}
        mtoAllowed={hasModule("made_to_order")}
        serialsAllowed={hasCapability("serials")}
        productionAllowed={hasCapability("production")}
        allowedUnits={typeMeta(activeBusiness?.typeKey).allowedUnits}
        componentChoices={products.filter((p) => p.archetype !== "made_to_order")}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); }}
      />
      <DeleteAllModal open={clearing} count={products.length} onClose={() => setClearing(false)} onDone={() => { setClearing(false); reload(); }} />
      <PhotoFinder open={findingPhotos} onClose={() => setFindingPhotos(false)} onDone={() => reload()} />
      <ImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onDone={() => { setImporting(false); reload(); }}
        categories={cats.filter((c) => c !== "All")}
      />
      <BarcodeLabelsModal open={labeling} onClose={() => setLabeling(false)} products={products} currency={currency} />
      <PrintInventoryModal
        open={printing}
        onClose={() => setPrinting(false)}
        products={products}
        businessName={activeBusiness?.name || "StarTrack"}
        branchName={activeBranch?.name || ""}
        currency={currency}
        showCost={showCost}
        showExpiry={hasModule("expiry") && hasFeature("expiry")}
        term={term}
      />
    </div>
  );
}

// ── AI restock suggestions ───────────────────────────────────────────
// The only write this ever makes to real data happens on explicit Approve —
// generating suggestions writes nothing but the suggestions themselves.

type Suggestion = {
  id: string; productId: string; productName: string;
  currentStock: number; reorderLevel: number; suggestedQty: number; reasoning: string;
};

function RestockSuggestionsPanel() {
  const { activeBranch } = useSession();
  const { data, loading, reload } = useApi<{ enabled: boolean; suggestions: Suggestion[] }>("/ai/restock-suggestions", [activeBranch?.id]);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function generate() {
    setGenerating(true); setError("");
    try {
      const r = await api<{ enabled: boolean; ok?: boolean; reason?: string }>("/ai/restock-suggestions/generate", { method: "POST" });
      if (r.enabled && !r.ok) setError("Couldn't generate suggestions right now — try again.");
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function approve(id: string, action: "raise_reorder_level" | "log_stock_in") {
    setBusyId(id); setError("");
    try {
      await api(`/ai/restock-suggestions/${id}/approve`, { method: "POST", body: JSON.stringify({ action }) });
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      await api(`/ai/restock-suggestions/${id}/dismiss`, { method: "POST" });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  // AI not configured on this server — stay out of the way on an already-busy page.
  if (data && !data.enabled) return null;

  const suggestions = data?.suggestions || [];

  return (
    <Panel
      flush
      className="mb-6"
      icon={Sparkles}
      title="Restock suggestions"
      subtitle="The AI reviews low stock against recent sales — nothing changes until you approve"
      action={
        <Button variant="secondary" size="sm" onClick={generate} disabled={generating || loading}>
          {generating ? <><TypingDots /> Thinking</> : <><Sparkles className="w-3.5 h-3.5" /> {suggestions.length ? "Refresh" : "Generate"}</>}
        </Button>
      }
    >
      {error && <div className="px-5 py-3 border-b border-line"><ErrorBanner message={error} /></div>}
      {!loading && suggestions.length === 0 ? (
        <div className="px-5 py-8 flex flex-col items-center text-center">
          <AiMark size={40} className="opacity-90" />
          <div className="mt-3 text-[13.5px] font-bold text-t1">No suggestions yet</div>
          <div className="mt-1 text-[12.5px] text-t3 max-w-[46ch]">Press Generate and the AI will check which items are running low and how much to reorder.</div>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {suggestions.map((s) => {
            const pct = s.reorderLevel > 0 ? Math.min(100, Math.round((s.currentStock / s.reorderLevel) * 100)) : 0;
            return (
              <div key={s.id} className="px-5 py-4 flex items-center gap-4 flex-wrap">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13.5px] font-bold text-t1 truncate">{s.productName}</span>
                    <span className="shrink-0 px-2 py-[2px] rounded-full bg-primary-soft text-primary text-[11.5px] font-bold font-mono">+{s.suggestedQty}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-[6px] w-28 rounded-full bg-surface-3 overflow-hidden">
                      <div className={cn("h-full rounded-full", s.currentStock <= 0 ? "bg-danger" : "bg-warning")} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                    <span className="text-[12px] text-t3">{s.currentStock} left · reorder at {s.reorderLevel}</span>
                  </div>
                  {s.reasoning && (
                    <div className="mt-2.5 pl-3 border-l-2 border-primary/30 text-[12.5px] text-t2 leading-relaxed">{s.reasoning}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => approve(s.id, "log_stock_in")}
                    disabled={busyId === s.id}
                    className="bg-primary text-white h-9 px-3.5 rounded-xl text-[12.5px] font-bold disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" /> Add {s.suggestedQty} to stock
                  </button>
                  <button
                    onClick={() => approve(s.id, "raise_reorder_level")}
                    disabled={busyId === s.id}
                    className="h-9 px-3 rounded-xl border border-line-2 bg-surface text-[12.5px] font-bold text-t2 hover:text-primary hover:border-primary disabled:opacity-60 transition-colors"
                    title="Just raise the reorder level, don't add stock"
                  >
                    Reorder level only
                  </button>
                  <button onClick={() => dismiss(s.id)} disabled={busyId === s.id} aria-label="Dismiss" className="w-9 h-9 rounded-full text-t4 hover:text-danger hover:bg-danger-soft grid place-items-center disabled:opacity-60 transition-colors">
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// Label sheets — pick products, barcode or QR, size, copies, cut lines. Every
// product can be labelled: one without a barcode gets a generated code, which
// the till recognises when scanned.
function BarcodeLabelsModal({ open, onClose, products, currency }: {
  open: boolean; onClose: () => void; products: Product[]; currency: string;
}) {
  const withCodes = products;
  const [kind, setKind] = useState<LabelKind>("qr");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [size, setSize] = useState<LabelSize>("medium");
  const [copies, setCopies] = useState(1);
  const [cutLines, setCutLines] = useState(true);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function run() {
    const items = withCodes
      .filter((p) => selected.has(p.id))
      .map((p) => ({ name: p.name, code: productCode(p), priceLabel: fmtMoney(p.price, currency) }));
    if (!items.length) return;
    if (!printBarcodeLabels(items, { size, copies: Math.max(1, copies), cutLines, kind })) {
      alert("Allow pop-ups for this site to print labels.");
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Print product labels" subtitle="Pick the products. Scan a QR label with the camera at the till to add the item." wide>
      <div className="flex items-center gap-2 mb-2">
        <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(withCodes.map((p) => p.id)))}>Select all</Button>
        <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>Clear</Button>
        <span className="ml-auto text-[12px] text-t3">{selected.size} selected</span>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-ctl border border-line divide-y divide-line mb-3">
        {withCodes.map((p) => (
          <button key={p.id} type="button" onClick={() => toggle(p.id)}
            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 transition-colors">
            <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0",
              selected.has(p.id) ? "bg-primary border-primary text-white" : "border-line-2")}>
              {selected.has(p.id) && <span className="text-[10px] font-semibold">✓</span>}
            </span>
            <span className="min-w-0 flex-1 text-[13px] font-medium text-t1 truncate">{p.name}</span>
            <span className="font-mono text-[11px] text-t4 shrink-0">{p.barcode || "auto code"}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Field label="Label type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as LabelKind)} aria-label="Label type">
            <option value="qr">QR code</option>
            <option value="barcode">Barcode</option>
          </Select>
        </Field>
        <Field label="Label size">
          <Select value={size} onChange={(e) => setSize(e.target.value as LabelSize)}>
            <option value="small">Small · 4 per row</option>
            <option value="medium">Medium · 3 per row</option>
            <option value="large">Large · 2 per row</option>
            <option value="sheet">Sheet · 5 per row</option>
          </Select>
        </Field>
        <Field label="Copies each">
          <Input type="number" min="1" max="50" value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} />
        </Field>
        <Field label="Cut lines">
          <button type="button" onClick={() => setCutLines((v) => !v)}
            className="w-full h-10 rounded-ctl border border-line-2 bg-surface-2 text-[13px] font-semibold text-t1">
            {cutLines ? "Dashed guides on" : "Off"}
          </button>
        </Field>
      </div>
      <Button className="w-full mt-4" onClick={run} disabled={!selected.size}>
        <Barcode className="w-4 h-4" /> Print {selected.size * Math.max(1, copies) || ""} label{selected.size * copies === 1 ? "" : "s"}
      </Button>
    </Modal>
  );
}

// Print Inventory — mirrors the legacy report: choose columns, skip
// zero-stock, branded table with a stock-value total.
function PrintInventoryModal({
  open, onClose, products, businessName, branchName, currency, showCost, showExpiry, term,
}: {
  open: boolean; onClose: () => void; products: Product[];
  businessName: string; branchName: string; currency: string;
  showCost: boolean; showExpiry: boolean; term: string;
}) {
  const [cols, setCols] = useState({ category: true, stock: true, price: true, cost: false, value: true, status: true, expiry: false });
  const [excludeZero, setExcludeZero] = useState(false);
  const toggle = (k: keyof typeof cols) => setCols((c) => ({ ...c, [k]: !c[k] }));

  const OPTIONS: { k: keyof typeof cols; label: string; show: boolean }[] = [
    { k: "category", label: "Category", show: true },
    { k: "stock", label: "Stock level", show: true },
    { k: "price", label: "Selling price", show: true },
    { k: "cost", label: "Cost price", show: showCost },
    { k: "value", label: "Stock value", show: showCost },
    { k: "status", label: "Status", show: true },
    { k: "expiry", label: "Expiry date", show: showExpiry },
  ];

  function run() {
    // Made-to-order items carry no stock — the stock report is shelf goods only.
    const rows = products.filter((p) => p.stock !== null && (excludeZero ? p.stock > 0 : true));
    const columns = [
      { label: "#", align: "left" as const, render: (_p: Product, i: number) => mono(String(i + 1)) },
      { label: "Product", render: (p: Product) => `<b>${p.name}</b>` },
      ...(cols.category ? [{ label: "Category", render: (p: Product) => p.category || "—" }] : []),
      ...(cols.stock ? [{
        label: "Stock", align: "right" as const,
        render: (p: Product) => {
          const stock = p.stock ?? 0;
          const color = stock <= 0 ? "#dc2626" : stock <= p.reorderLevel ? "#d97706" : "#059669";
          return `<span style="color:${color};font-family:'Courier New',monospace;font-weight:700">${stock}</span>`;
        },
      }] : []),
      ...(cols.price ? [{ label: "Price", align: "right" as const, render: (p: Product) => mono(fmtMoney(p.price, currency)) }] : []),
      ...(cols.cost && showCost ? [{ label: "Cost", align: "right" as const, render: (p: Product) => mono(fmtMoney(p.cost || 0, currency)) }] : []),
      ...(cols.value && showCost ? [{ label: "Stock Value", align: "right" as const, render: (p: Product) => mono(fmtMoney((p.cost || 0) * (p.stock ?? 0), currency)) }] : []),
      ...(cols.expiry && showExpiry ? [{ label: "Expiry", align: "right" as const, render: (p: Product) => (p.expiry ? fmtDate(p.expiry) : "—") }] : []),
      ...(cols.status ? [{
        label: "Status", align: "center" as const,
        render: (p: Product) => {
          const stock = p.stock ?? 0;
          const [label, color] = stock <= 0 ? ["Out of Stock", "#dc2626"] : stock <= p.reorderLevel ? ["Low Stock", "#d97706"] : ["Available", "#059669"];
          return `<span style="color:${color};font-weight:700;font-size:11px">${label}</span>`;
        },
      }] : []),
    ];
    const totals = columns.map((c) =>
      c.label === "#" ? "Total" :
      c.label === "Stock" ? String(rows.reduce((s, p) => s + (p.stock ?? 0), 0)) :
      c.label === "Stock Value" ? fmtMoney(rows.reduce((s, p) => s + (p.cost || 0) * (p.stock ?? 0), 0), currency) : ""
    );
    printReport({
      businessName,
      title: `${term} Report${branchName ? ` — ${branchName}` : ""}`,
      subtitle: `${rows.length} products${excludeZero ? " · zero stock excluded" : ""}`,
      columns, rows, totals,
    });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Print inventory" subtitle="Choose what appears on the report — it opens ready to print">
      <div className="space-y-1.5">
        {OPTIONS.filter((o) => o.show).map((o) => (
          <button key={o.k} type="button" onClick={() => toggle(o.k)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors">
            <span className="text-[13px] font-semibold text-t1">{o.label}</span>
            <span className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${cols[o.k] ? "bg-primary" : "bg-surface-3 border border-line-2"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${cols[o.k] ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>
        ))}
        <button type="button" onClick={() => setExcludeZero((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors">
          <span className="text-[13px] font-semibold text-t1">Skip out-of-stock items</span>
          <span className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${excludeZero ? "bg-primary" : "bg-surface-3 border border-line-2"}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${excludeZero ? "left-[18px]" : "left-0.5"}`} />
          </span>
        </button>
      </div>
      <Button className="w-full mt-4" onClick={run}><Printer className="w-4 h-4" /> Open print view</Button>
    </Modal>
  );
}

type ImportRow = {
  name: string; category: string; barcode: string;
  price: number; cost: number; reorderLevel: number; openingStock: number; expiry: string;
};
type ImportResult = { created: number; skipped: { row: number; name: string; reason: string }[] };

// Header aliases: the parser lowercases and strips non-alphanumerics, so
// "Opening Stock", "opening_stock" and "openingstock" all match.
const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k];
  return "";
};

function ImportModal({ open, onClose, onDone, categories }: {
  open: boolean; onClose: () => void; onDone: () => void; categories: string[];
}) {
  const { activeBusiness, activeBranch, currency } = useSession();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const words = typeMeta(activeBusiness?.typeKey);

  function reset() {
    setRows([]); setFileName(""); setError(""); setResult(null);
  }

  function downloadTemplate() {
    downloadProductTemplate({
      businessName: activeBusiness?.name || "StarTrack",
      currency,
      categories,
      productWord: words.products,
      branchName: activeBranch?.name || "this branch",
    });
  }

  // Numbers may arrive with the thousands separators and currency symbols
  // people naturally type into a spreadsheet — "₦2,000" has to mean 2000.
  const num = (v: string, fallback: number) => {
    const cleaned = String(v ?? "").replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return cleaned === "" || Number.isNaN(n) ? fallback : n;
  };

  const mapRows = (parsed: Record<string, string>[]) =>
    parsed.map((r) => ({
      name: pick(r, "name", "product", "productname", "item"),
      category: pick(r, "category", "cat") || "General",
      barcode: pick(r, "barcode", "sku", "code"),
      price: num(pick(r, "price", "sellingprice", "sellprice"), 0),
      cost: num(pick(r, "cost", "costprice"), 0),
      reorderLevel: num(pick(r, "reorderlevel", "reorder"), 5),
      openingStock: num(pick(r, "openingstock", "stock", "qty", "quantity"), 0),
      expiry: pick(r, "expiry", "expirydate"),
    }));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setResult(null); setFileName(file.name); setReading(true);
    try {
      const isExcel = /\.xlsx$/i.test(file.name);
      if (/\.xls$/i.test(file.name)) {
        throw new Error("That's the older .xls format. Open it in Excel and save as .xlsx or CSV, then try again.");
      }
      const parsed = isExcel ? await parseXlsx(file) : parseCsv(await file.text());
      if (!parsed.length) {
        setError("Couldn't read any rows. Check the first row holds the column names — the template has them already.");
        setRows([]);
        return;
      }
      setRows(mapRows(parsed));
    } catch (err: any) {
      setError(err.message || "Couldn't read that file.");
      setRows([]);
    } finally {
      setReading(false);
    }
  }

  async function runImport() {
    setBusy(true); setError("");
    try {
      const res = await api<ImportResult>("/products/import", { method: "POST", body: JSON.stringify({ rows }) });
      setResult(res);
      setRows([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const bad = rows.filter((r) => !r.name || r.price <= 0).length;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Import products from CSV" subtitle="Migrate from Excel, Google Sheets, or your old system in one go" wide>
      {result ? (
        <div>
          <div className="px-3 py-3 rounded-ctl bg-success-soft text-success text-[13px] font-semibold">
            ✓ {result.created} product{result.created === 1 ? "" : "s"} imported{result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}
          </div>
          {result.skipped.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-ctl border border-line divide-y divide-line">
              {result.skipped.map((s, i) => (
                <div key={i} className="px-3 py-2 text-[12px]">
                  <span className="font-semibold text-t1">Row {s.row} — {s.name}:</span>{" "}
                  <span className="text-t3">{s.reason}</span>
                </div>
              ))}
            </div>
          )}
          <Button className="w-full mt-4" onClick={() => { reset(); onDone(); }}>Done</Button>
        </div>
      ) : rows.length === 0 ? (
        <div>
          <ErrorBanner message={error} />

          {/* Step 1 — the template does the explaining, so it leads. */}
          <div className="flex items-start gap-3 p-4 rounded-card bg-primary-softer border border-line">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-primary text-white flex items-center justify-center font-semibold text-[13px]">1</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-t1">Start from the template</div>
              <div className="text-[12px] text-t3 mt-0.5 leading-relaxed">
                An Excel workbook set up for {activeBusiness?.name || "your business"} — your categories as a dropdown,
                prices in {currency}, and a tab explaining every column.
              </div>
              <Button size="sm" variant="secondary" className="mt-2.5" onClick={downloadTemplate}>
                <Download className="w-3.5 h-3.5" /> Download Excel template
              </Button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-3 mt-3">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-surface-3 text-t3 flex items-center justify-center font-semibold text-[13px]">2</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-t1">Fill it in and upload it back</div>
              <label
                className={cn(
                  "mt-2 flex flex-col items-center justify-center gap-1.5 py-8 rounded-card border-2 border-dashed transition-colors",
                  reading ? "border-brand-400 bg-primary-softer cursor-wait" : "border-line-2 cursor-pointer hover:border-brand-400 hover:bg-primary-softer"
                )}
              >
                <FileSpreadsheet className={cn("w-7 h-7", reading ? "text-primary animate-pulse" : "text-t3")} />
                <span className="text-[13px] font-semibold text-t1">
                  {reading ? `Reading ${fileName}…` : "Choose a file"}
                </span>
                <span className="text-[12px] text-t3">Excel (.xlsx) or CSV · up to 2,000 items</span>
                <input type="file" accept=".xlsx,.csv,text/csv" className="hidden" disabled={reading} onChange={onFile} />
              </label>
              <div className="text-[11px] text-t4 mt-2">
                Already have a list from another system? Upload it as-is — columns named
                {" "}<span className="font-medium text-t3">product</span>, <span className="font-medium text-t3">qty</span> or
                {" "}<span className="font-medium text-t3">selling price</span> are recognised too. Nothing is saved until you
                check the preview.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <ErrorBanner message={error} />
          <div className="flex items-center gap-2 text-[13px] text-t2 mb-3">
            <FileSpreadsheet className="w-4 h-4 text-primary" />
            <span className="font-semibold text-t1">{fileName}</span> · {rows.length} row{rows.length === 1 ? "" : "s"}
            {bad > 0 && <Badge tone="warning">{bad} missing name or price — will be skipped</Badge>}
          </div>
          <div className="max-h-64 overflow-auto rounded-ctl border border-line">
            <Table className="min-w-[560px]">
              <thead>
                <tr className="text-left">
                  {["Name", "Category", "Price", "Cost", "Opening stock"].map((h) => (
                    <TH key={h} className="bg-surface-2 sticky top-0">{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <TR key={i} hover={false} className={cn((!r.name || r.price <= 0) && "opacity-40")}>
                    <TD className="font-medium">{r.name || "—"}</TD>
                    <TD className="!text-t3">{r.category}</TD>
                    <TD className="font-mono">{r.price}</TD>
                    <TD className="font-mono !text-t3">{r.cost}</TD>
                    <TD className="font-mono !text-t3">{r.openingStock}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {rows.length > 50 && <div className="px-3 py-2 text-[11px] text-t4">…and {rows.length - 50} more rows</div>}
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="secondary" onClick={reset}>Choose another file</Button>
            <Button className="flex-1" disabled={busy || rows.length === bad} onClick={runImport}>
              <Upload className="w-4 h-4" /> {busy ? "Importing…" : `Import ${rows.length - bad} products`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProductModal({
  editing, showCost, showExpiry, mtoAllowed, serialsAllowed, productionAllowed, allowedUnits, componentChoices, onClose, onSaved,
}: {
  editing: Product | "new" | null;
  showCost: boolean;
  showExpiry: boolean;
  mtoAllowed: boolean;
  serialsAllowed: boolean;
  productionAllowed: boolean;
  allowedUnits: string[];
  componentChoices: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = editing === "new";
  const p = isNew || !editing ? null : editing;
  const [mto, setMto] = useState(p?.archetype === "made_to_order");
  const [tracksSerials, setTracksSerials] = useState(!!p?.tracksSerials);
  // A stock item's own production recipe — distinct from the made-to-order
  // toggle above: this item DOES carry its own stock, just credited by a
  // Production Run instead of (or alongside) manual stock-in.
  const [hasRecipe, setHasRecipe] = useState(!mto && !!p?.bom?.length);
  const [bom, setBom] = useState<BomLine[]>(
    p?.bom?.length ? p.bom : [{ productId: "", per: "sqm", factor: 1, includeLeakage: true }]
  );
  const [form, setForm] = useState({
    name: p?.name || "",
    category: p?.category || "General",
    barcode: p?.barcode || "",
    price: p?.price ?? ("" as number | ""),
    cost: p?.cost ?? ("" as number | ""),
    reorderLevel: p?.reorderLevel ?? 5,
    openingStock: 0,
    expiry: p?.expiry ? String(p.expiry).slice(0, 10) : "",
    producedUnitsPerStockUnit: p?.producedUnitsPerStockUnit ?? 1,
    unit: p?.unit || "unit",
    purchaseUnit: p?.purchaseUnit || "",
    unitsPerPurchase: p?.unitsPerPurchase ?? 1,
    warrantyMonths: p?.warrantyMonths ?? 0,
  });
  const { activeBranch, branchesForActive, hasFeature } = useSession();
  const [shared, setShared] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(p?.imageUrl || "");
  const [removeImage, setRemoveImage] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const setBomLine = (i: number, patch: Partial<BomLine>) =>
    setBom((b) => b.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageFile(file);
    setRemoveImage(false);
    setImagePreview(URL.createObjectURL(file));
  }

  function onRemoveImage() {
    setImageFile(null);
    setImagePreview("");
    setRemoveImage(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Production recipes have no width/height concept — always "per unit
      // produced" — so `per` is forced to "unit" outside the MTO path.
      const bomClean = bom
        .filter((l) => l.productId)
        .map((l) => ({
          productId: l.productId,
          per: mto ? l.per : "unit",
          factor: Number(l.factor) || 1,
          ...(mto ? {} : { includeLeakage: l.includeLeakage !== false }),
        }));
      if (mto && !bomClean.length) {
        setError("Add at least one component."); setBusy(false); return;
      }
      if (!mto && hasRecipe && !bomClean.length) {
        setError("Add at least one raw material."); setBusy(false); return;
      }
      const body = {
        name: form.name.trim(),
        category: form.category.trim() || "General",
        barcode: mto ? "" : form.barcode.trim(),
        archetype: mto ? "made_to_order" : "stock",
        ...(mto ? { bom: bomClean } : {}),
        ...(!mto && hasRecipe ? { bom: bomClean, producedUnitsPerStockUnit: Number(form.producedUnitsPerStockUnit) || 1 } : {}),
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        ...(!mto ? {
          unit: form.unit.trim() || "unit",
          purchaseUnit: form.purchaseUnit.trim(),
          unitsPerPurchase: Number(form.unitsPerPurchase) || 1,
        } : {}),
        ...(showExpiry && !mto ? { expiry: form.expiry } : {}),
        ...(isNew && !mto ? { openingStock: Number(form.openingStock) || 0 } : {}),
        ...(isNew ? { shareWithAllStores: shared } : {}),
        ...(serialsAllowed && !mto ? { tracksSerials, warrantyMonths: Number(form.warrantyMonths) || 0 } : {}),
      };
      const res = isNew
        ? await api<{ product: { id: string } }>("/products", { method: "POST", body: JSON.stringify(body) })
        : await api<{ product: { id: string } }>(`/products/${p!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      const savedId = res.product.id;

      // The product itself is already saved at this point — a photo
      // hiccup shouldn't block that or trap the form in a re-submit that
      // would hit "name already taken" on the product that just saved. It
      // still has to be SEEN, though — a silently-dropped photo (e.g. no
      // Cloudinary configured on the server) previously looked identical
      // to a successful upload.
      if (imageFile) {
        try {
          const fd = new FormData();
          fd.append("image", imageFile);
          await api(`/products/${savedId}/image`, { method: "POST", body: fd });
        } catch (imgErr: any) {
          alert(`"${form.name}" was saved, but the photo didn't upload: ${imgErr.message}`);
        }
      } else if (removeImage && p?.imageUrl) {
        try { await api(`/products/${savedId}/image`, { method: "DELETE" }); } catch { /* non-fatal */ }
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!editing} onClose={onClose} title={isNew ? "Add product" : `Edit ${p?.name}`} subtitle={isNew ? "It appears on the POS immediately" : "Price changes are logged to the audit trail"} wide={mto}>
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />

        {mtoAllowed && isNew && (
          <button
            type="button"
            onClick={() => setMto((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors"
          >
            <span>
              <span className="block text-[13px] font-semibold text-t1">Made to order</span>
              <span className="block text-[11px] text-t3">Built per order from components (blinds, curtains, tailoring). Priced by size.</span>
            </span>
            <span className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", mto ? "bg-primary" : "bg-surface-3 border border-line-2")}>
              <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", mto ? "left-[22px]" : "left-0.5")} />
            </span>
          </button>
        )}

        {serialsAllowed && !mto && (
          <button
            type="button"
            onClick={() => setTracksSerials((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors"
          >
            <span>
              <span className="block text-[13px] font-semibold text-t1">Track serial numbers</span>
              <span className="block text-[11px] text-t3">Each unit gets its own serial, sale record and repair history — for phones, laptops, and similar.</span>
            </span>
            <span className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", tracksSerials ? "bg-primary" : "bg-surface-3 border border-line-2")}>
              <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", tracksSerials ? "left-[22px]" : "left-0.5")} />
            </span>
          </button>
        )}
        {serialsAllowed && !mto && tracksSerials && (
          <Field label="Warranty (months)" hint="0 = not tracked. Set on each unit's Serial the moment it's sold.">
            <Input type="number" min="0" value={form.warrantyMonths} onChange={(e) => set("warrantyMonths", e.target.value)} />
          </Field>
        )}

        {productionAllowed && !mto && (
          <button
            type="button"
            onClick={() => setHasRecipe((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors"
          >
            <span>
              <span className="block text-[13px] font-semibold text-t1">Made from raw materials</span>
              <span className="block text-[11px] text-t3">Its stock is credited by a Production Run instead of (or alongside) manual stock-in.</span>
            </span>
            <span className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", hasRecipe ? "bg-primary" : "bg-surface-3 border border-line-2")}>
              <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", hasRecipe ? "left-[22px]" : "left-0.5")} />
            </span>
          </button>
        )}

        <div className="flex items-center gap-3">
          <label className={cn(
            "relative w-16 h-16 shrink-0 rounded-ctl border border-dashed border-line-2 flex items-center justify-center overflow-hidden cursor-pointer hover:border-brand-400 transition-colors",
            imagePreview ? "border-solid" : "bg-surface-2"
          )}>
            {imagePreview ? (
              <img src={imagePreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="w-5 h-5 text-t4" />
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onPickImage} />
          </label>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-t2">Product photo</div>
            <div className="text-[11px] text-t4 mb-1.5">Shown on the POS grid instead of a category icon. JPEG/PNG/WEBP, up to 5MB.</div>
            {imagePreview && (
              <button type="button" onClick={onRemoveImage} className="text-[11.5px] font-semibold text-danger hover:underline">Remove photo</button>
            )}
          </div>
        </div>
        <Field label="Name"><Input autoFocus required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={mto ? "e.g. Day & Night Window Blind" : "e.g. Golden Penny Semovita 2kg"} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder={mto ? "Blinds" : "Grains"} /></Field>
          {!mto && (hasFeature("barcodes")
            ? <Field label="Barcode" hint="Optional — scan into this box"><Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} /></Field>
            : <Field label="Barcode" hint="Barcodes and labels are part of the Pro plan"><Input value="" disabled placeholder="Pro plan" onClick={() => requestUpgrade("barcodes")} /></Field>)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={mto ? "Price per m²" : "Selling price"} hint={mto ? "Order price = this × width × height (adjustable at sale)" : undefined}>
            <Input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} />
          </Field>
          {showCost && !mto && <Field label="Cost price" hint="Only finance roles see this"><Input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set("cost", e.target.value)} /></Field>}
        </div>

        {mto ? (
          <div>
            <div className="text-[11px] font-medium text-t3 mb-1.5">Components — your own recipe</div>
            <div className="text-[11px] text-t4 mb-2">Cost and stock deduction come from these. Quantities are calculated from each order's size.</div>
            <div className="space-y-2">
              {bom.map((line, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select value={line.productId} onChange={(e) => setBomLine(i, { productId: e.target.value })} className="flex-1 min-w-35" required>
                    <option value="">Choose component…</option>
                    {componentChoices.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  <Select value={line.per} onChange={(e) => setBomLine(i, { per: e.target.value as BomLine["per"] })} className="!w-44">
                    {Object.entries(PER_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </Select>
                  <Input type="number" min="0.01" step="0.01" value={line.factor} onChange={(e) => setBomLine(i, { factor: Number(e.target.value) })} className="!w-20 text-right" title="Multiplier (e.g. 1.1 = 10% wastage)" />
                  {bom.length > 1 && (
                    <button type="button" onClick={() => setBom((b) => b.filter((_, idx) => idx !== i))} className="h-10 w-9 shrink-0 rounded-ctl border border-line-2 flex items-center justify-center text-t4 hover:text-danger">×</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setBom((b) => [...b, { productId: "", per: "unit", factor: 1 }])} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
              + Add component
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reorder level" hint="Low-stock alert threshold"><Input type="number" min="0" value={form.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} /></Field>
              {isNew && branchesForActive.length > 1 && (
                <label className="col-span-full flex items-start gap-2 text-[12px] text-t2">
                  <input type="checkbox" className="mt-0.5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                  <span>Sell at every branch. Left off, this item belongs to <b>{activeBranch?.name}</b> only.</span>
                </label>
              )}
              {isNew && <Field label="Opening stock" hint="Booked as a stock-in"><Input type="number" min="0" value={form.openingStock} onChange={(e) => set("openingStock", e.target.value)} /></Field>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Unit"
                hint={
                  allowedUnits.length
                    ? form.unit === "bird" ? "A bird needs Category set to \"layer\" or \"broiler\"." : undefined
                    : "e.g. kg, litre, piece"
                }
              >
                {allowedUnits.length ? (
                  <Select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                    {allowedUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                ) : (
                  <Input value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="unit" />
                )}
              </Field>
              <Field label="Bought as" hint="Optional — e.g. bag (50kg)"><Input value={form.purchaseUnit} onChange={(e) => set("purchaseUnit", e.target.value)} placeholder="Same as unit" /></Field>
            </div>
            {form.purchaseUnit.trim() && (
              <Field label={`1 ${form.purchaseUnit} = how many ${form.unit || "unit"}?`} hint="Stock-in will take a quantity in this purchase unit and convert automatically">
                <Input type="number" min="0.001" step="0.001" value={form.unitsPerPurchase} onChange={(e) => set("unitsPerPurchase", e.target.value)} />
              </Field>
            )}
            {showExpiry && (
              <Field label="Expiry date" hint="Optional — feeds the expiring-soon report">
                <Input type="date" value={form.expiry} onChange={(e) => set("expiry", e.target.value)} />
              </Field>
            )}
            {hasRecipe && (
              <div>
                <div className="text-[11px] font-medium text-t3 mb-1.5">Recipe — raw materials this consumes</div>
                <div className="text-[11px] text-t4 mb-2">A Production Run consumes these per unit produced, then credits this product's stock.</div>
                <div className="space-y-2">
                  {bom.map((line, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select value={line.productId} onChange={(e) => setBomLine(i, { productId: e.target.value })} className="flex-1" required>
                        <option value="">Choose raw material…</option>
                        {componentChoices.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </Select>
                      <Input type="number" min="0.01" step="0.01" value={line.factor} onChange={(e) => setBomLine(i, { factor: Number(e.target.value) })} className="!w-20 text-right" title="Consumed per unit produced" />
                      <label className="flex items-center gap-1.5 text-[11px] text-t3 shrink-0 whitespace-nowrap" title="A burst/torn unit still consumed this material">
                        <input type="checkbox" checked={line.includeLeakage !== false} onChange={(e) => setBomLine(i, { includeLeakage: e.target.checked })} className="accent-primary" />
                        counts leakage
                      </label>
                      {bom.length > 1 && (
                        <button type="button" onClick={() => setBom((b) => b.filter((_, idx) => idx !== i))} className="h-10 w-9 shrink-0 rounded-ctl border border-line-2 flex items-center justify-center text-t4 hover:text-danger">×</button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setBom((b) => [...b, { productId: "", per: "unit", factor: 1, includeLeakage: true }])} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
                  + Add raw material
                </button>
                <Field label="Produced units per stock unit" hint="e.g. 12 bottles = 1 pack, 20 sachets = 1 bag — leave at 1 if they're credited one-for-one" className="mt-3">
                  <Input type="number" min="1" value={form.producedUnitsPerStockUnit} onChange={(e) => set("producedUnitsPerStockUnit", e.target.value)} />
                </Field>
              </div>
            )}
          </>
        )}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : isNew ? "Add product" : "Save changes"}</Button>
      </form>
    </Modal>
  );
}


/**
 * Delete every product in one go. "Delete" here archives — the products leave the
 * catalog, the till and the alerts, but past sales and reports keep their
 * figures — and the person has to type DELETE so it can't happen by accident.
 */
function DeleteAllModal({ open, count, onClose, onDone }: { open: boolean; count: number; onClose: () => void; onDone: () => void }) {
  const { activeBranch, refreshData } = useSession();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setTyped(""); setError(""); }
  }, [open]);

  async function run() {
    setBusy(true);
    setError("");
    try {
      await api("/products/archive-all", { method: "POST", body: JSON.stringify({ confirm: true }) });
      refreshData();
      onDone();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete the products.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Delete all ${count} products?`} subtitle={`This clears the catalog${activeBranch ? ` for ${activeBranch.name}` : ""}.`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-danger-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-t1">
          Every product disappears from the catalog and the till, and its stock alerts are cleared. Past sales, receipts and reports keep their figures.
          Products shared with your other stores go from those stores too.
        </div>
        <Field label="Type DELETE to confirm">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoFocus />
        </Field>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={run} disabled={busy || typed.trim() !== "DELETE"}>
            <Trash2 className="w-4 h-4" /> {busy ? "Deleting…" : `Delete ${count} products`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
