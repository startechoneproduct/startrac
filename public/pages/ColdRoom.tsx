import { useState } from "react";
import {
  Snowflake, Package, Scale, Coins, AlertTriangle, Thermometer,
  ShoppingCart, Boxes, Split, Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TR, TH, TD } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDate, todayStr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";

type StockRow = {
  productId: string; name: string; category: string;
  sealedCartons: number; looseKg: number; loosePieces: number;
  cartonEquivalent: number; stockValue: number;
  openBatches: number; oldestBatchDate: string | null;
};
type Batch = {
  id: string; productId: string; productName: string;
  supplierId: string | null; supplierName: string; purchaseDate: string;
  cartonsReceived: number; packSizeKg: number; unitCostPerCarton: number; costPerKg: number;
  actualWeighedKg: number | null;
  remainingCartons: number; remainingKg: number; remainingPieces: number; avgPieceWeightKg: number;
  status: "open" | "closed"; notes: string; createdAt: string;
};
type Breakdown = {
  id: string; batchId: string; productId: string; productName: string;
  cartonsOpened: number; expectedYieldKg: number; actualWeighedKg: number;
  varianceKg: number; variancePercent: number; resultingPieceCount: number | null;
  byName: string; note: string; at: string;
};
type Summary = {
  stockValue: number; sealedCartons: number; looseKg: number; productsInStock: number;
  avgShrinkagePercent: number; breakdownCount: number; totalOutstanding: number; debtorCount: number;
};
type Supplier = { id: string; name: string };

export function ColdRoom() {
  const { activeBranch, currency, can, hasCapability } = useSession();
  const { data: summaryData, reload: reloadSummary } = useApi<Summary>("/coldroom/summary", [activeBranch?.id]);
  const { data: stockData, loading, reload: reloadStock } = useApi<{ products: StockRow[] }>("/coldroom/stock", [activeBranch?.id]);
  const rows = stockData?.products || [];
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [wholeLoss, setWholeLoss] = useState(false);

  const reload = () => { reloadStock(); reloadSummary(); };
  const openRow = rows.find((r) => r.productId === openProductId) || null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Cold Room"
        subtitle="Cartons in, kilograms and pieces out — with the shrinkage between them tracked honestly"
        actions={
          can("stock") ? (
            <Button variant="danger" size="sm" onClick={() => setWholeLoss(true)}>
              <Thermometer className="w-4 h-4" /> Whole-room loss
            </Button>
          ) : undefined
        }
      />

      {summaryData && (
        <div className={cn("grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-5 mb-6", hasCapability("credit") ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
          <StatCard index={0} label="Stock value" value={fmtMoney(summaryData.stockValue, currency)} icon={Coins} />
          <StatCard tone="neutral" index={1} label="Sealed cartons" value={String(summaryData.sealedCartons)} icon={Boxes} />
          <StatCard tone="neutral" index={2} label="Loose kg on hand" value={`${summaryData.looseKg}kg`} icon={Scale} />
          <StatCard
            tone="warning"
            index={3}
            label="Shrinkage (30d)"
            value={`${summaryData.avgShrinkagePercent}%`}
            icon={AlertTriangle}
            hint={summaryData.breakdownCount ? `${summaryData.breakdownCount} breakdown${summaryData.breakdownCount === 1 ? "" : "s"}` : undefined}
          />
          {hasCapability("credit") && (
            <StatCard
              tone="danger"
              index={4}
              label="Owed by customers"
              value={fmtMoney(summaryData.totalOutstanding, currency)}
              icon={Users}
              hint={summaryData.debtorCount ? `${summaryData.debtorCount} debtor${summaryData.debtorCount === 1 ? "" : "s"}` : undefined}
            />
          )}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Snowflake}
            title="No products yet"
            body="Add fish species and other frozen items on the Products page first — they'll show up here to record purchases against."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <thead>
                <tr className="text-left">
                  {["Product", "Sealed cartons", "Loose kg", "Loose pieces", "Stock value", "Oldest batch", ""].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.productId} className="group cursor-pointer" onClick={() => setOpenProductId(r.productId)}>
                    <TD>
                      <div className="text-[13px] font-semibold text-t1">{r.name}</div>
                      <div className="text-[11px] text-t4">{r.category}</div>
                    </TD>
                    <TD className="font-mono tabular-nums">{r.sealedCartons || "—"}</TD>
                    <TD className="font-mono tabular-nums">{r.looseKg ? `${r.looseKg}kg` : "—"}</TD>
                    <TD className="font-mono tabular-nums">{r.loosePieces || "—"}</TD>
                    <TD className="font-mono font-semibold tabular-nums">{fmtMoney(r.stockValue, currency)}</TD>
                    <TD className="!text-t3">
                      {r.oldestBatchDate ? fmtDate(r.oldestBatchDate) : <Badge tone="neutral">No stock</Badge>}
                    </TD>
                    <TD className="text-right">
                      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setOpenProductId(r.productId); }}>
                        Manage
                      </Button>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      <ProductModal
        row={openRow}
        canManage={can("stock")}
        canSell={can("sales")}
        creditAllowed={hasCapability("credit")}
        currency={currency}
        onClose={() => setOpenProductId(null)}
        onChanged={reload}
      />
      <WholeRoomLossModal open={wholeLoss} onClose={() => setWholeLoss(false)} onDone={() => { setWholeLoss(false); reload(); }} />
    </div>
  );
}

// ── Whole-room loss ──────────────────────────────────────────────────

function WholeRoomLossModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ productsAffected: number; valueLost: number } | null>(null);
  const { currency } = useSession();

  async function run() {
    setBusy(true); setError("");
    try {
      const r = await api<{ productsAffected: number; valueLost: number }>("/coldroom/cold-chain-loss", {
        method: "POST", body: JSON.stringify({ note }),
      });
      setResult(r);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { setNote(""); setResult(null); onClose(); }}
      title="Whole-room cold-chain loss"
      subtitle="A power or generator failure that spoiled everything in the room, at once"
    >
      {result ? (
        <div className="space-y-3">
          <div className="px-3 py-3 rounded-ctl bg-danger-soft text-danger text-[13px] font-semibold">
            {result.productsAffected} product{result.productsAffected === 1 ? "" : "s"} zeroed out — {fmtMoney(result.valueLost, currency)} lost at cost.
          </div>
          <Button className="w-full" onClick={() => { setNote(""); setResult(null); onDone(); }}>Done</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorBanner message={error} />
          <p className="text-[12px] text-t3">
            This closes every open batch in this branch's cold room and logs the loss at cost, separately from ordinary shrinkage.
            It cannot be undone from here — use it only for a real cold-chain failure.
          </p>
          <Field label="What happened" hint="Optional — shown in the audit log">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Generator failed overnight, room was above 0°C by morning" />
          </Field>
          <Button variant="danger" className="w-full" disabled={busy} onClick={run}>
            {busy ? "Recording…" : "Confirm — the whole room was lost"}
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ── Per-product detail: sell / purchase / breakdown / loss + history ───

type Tab = "sell" | "purchase" | "breakdown" | "loss";

function ProductModal({
  row, canManage, canSell, creditAllowed, currency, onClose, onChanged,
}: {
  row: StockRow | null; canManage: boolean; canSell: boolean; creditAllowed: boolean; currency: string;
  onClose: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("sell");
  const { data, reload } = useApi<{ batches: Batch[] }>(row ? `/coldroom/batches?productId=${row.productId}&status=open` : null, [row?.productId]);
  const batches = data?.batches || [];

  if (!row) return null;

  function refresh() {
    reload();
    onChanged();
  }

  const TABS: { key: Tab; label: string; icon: any; show: boolean }[] = [
    { key: "sell", label: "Sell", icon: ShoppingCart, show: canSell },
    { key: "purchase", label: "Purchase", icon: Package, show: canManage },
    { key: "breakdown", label: "Open a carton", icon: Split, show: canManage },
    { key: "loss", label: "Cold-chain loss", icon: Thermometer, show: canManage },
  ];
  const visibleTabs = TABS.filter((t) => t.show);

  return (
    <Modal open={!!row} onClose={onClose} title={row.name} subtitle={row.category} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { l: "Sealed cartons", v: row.sealedCartons },
            { l: "Loose kg", v: row.looseKg },
            { l: "Loose pieces", v: row.loosePieces },
            { l: "Stock value", v: fmtMoney(row.stockValue, currency) },
          ].map((s) => (
            <div key={s.l} className="rounded-xl bg-surface-2 border border-line p-3 text-center">
              <div className="text-[14px] font-semibold font-mono text-t1 truncate">{s.v}</div>
              <div className="text-[10px] font-medium text-t3 mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>

        {visibleTabs.length > 0 && (
          <div>
            <div className="flex gap-1.5 mb-3 p-1 rounded-ctl bg-surface-2 border border-line overflow-x-auto">
              {visibleTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => animateSwitch("tab", () => setTab(t.key))}
                  className={cn(
                    "flex-1 h-8 px-2 rounded-md text-[12px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors",
                    tab === t.key ? "bg-surface text-t1 shadow-e1" : "text-t3 hover:text-t1"
                  )}
                >
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </div>

            {tab === "sell" && canSell && (
              <SellForm productId={row.productId} productName={row.name} creditAllowed={creditAllowed} onDone={refresh} />
            )}
            {tab === "purchase" && canManage && (
              <PurchaseForm productId={row.productId} onDone={refresh} />
            )}
            {tab === "breakdown" && canManage && (
              <BreakdownForm batches={batches} onDone={refresh} />
            )}
            {tab === "loss" && canManage && (
              <LossForm batches={batches} onDone={refresh} />
            )}
          </div>
        )}

        <div>
          <div className="text-[11px] font-medium text-t3 mb-2">Open batches — oldest first</div>
          {!batches.length ? (
            <div className="text-[12px] text-t4 py-4 text-center">No open batches. Record a purchase to bring stock in.</div>
          ) : (
            <div className="divide-y divide-line">
              {batches.map((b) => (
                <div key={b.id} className="py-2.5 text-[12px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-t1">{fmtDate(b.purchaseDate)}</span>
                    {b.supplierName && <span className="text-t3">· {b.supplierName}</span>}
                    <span className="text-t4">· {b.packSizeKg}kg/carton · {fmtMoney(b.unitCostPerCarton, currency)}/carton</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-t2">
                    <span className="font-mono">{b.remainingCartons} carton{b.remainingCartons === 1 ? "" : "s"}</span>
                    {b.remainingKg > 0 && <span className="font-mono">{b.remainingKg}kg loose</span>}
                    {b.remainingPieces > 0 && <span className="font-mono">{b.remainingPieces} piece{b.remainingPieces === 1 ? "" : "s"}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Sell ─────────────────────────────────────────────────────────────

function SellForm({ productId, productName, creditAllowed, onDone }: {
  productId: string; productName: string; creditAllowed: boolean; onDone: () => void;
}) {
  const [saleType, setSaleType] = useState<"carton" | "kg" | "piece">("kg");
  const [qty, setQty] = useState<number | "">("");
  const [unitPrice, setUnitPrice] = useState<number | "">("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "pos" | "transfer" | "credit">("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ saleNo: string; total: number } | null>(null);
  const { currency } = useSession();

  async function submit() {
    setBusy(true); setError("");
    try {
      const body: any = {
        productId, saleType, qty: Number(qty), unitPrice: Number(unitPrice), paymentMethod,
      };
      if (customerName.trim()) body.customer = { name: customerName.trim(), phone: customerPhone.trim() };
      const r = await api<{ saleNo: string; sale: { total: number } }>("/coldroom/sales", { method: "POST", body: JSON.stringify(body) });
      setReceipt({ saleNo: r.saleNo, total: r.sale.total });
      setQty(""); setUnitPrice("");
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <div className="space-y-3">
        <div className="px-3 py-3 rounded-ctl bg-success-soft text-success text-[13px] font-semibold">
          Sold — {receipt.saleNo} · {fmtMoney(receipt.total, currency)}
        </div>
        <Button className="w-full" onClick={() => setReceipt(null)}>Record another sale</Button>
      </div>
    );
  }

  const needsCustomer = paymentMethod === "credit";

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      <div className="flex gap-1.5 p-1 rounded-ctl bg-surface border border-line">
        {(["carton", "kg", "piece"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSaleType(t)}
            className={cn(
              "flex-1 h-8 rounded-md text-[12px] font-semibold capitalize transition-colors",
              saleType === t ? "bg-primary text-white" : "text-t3 hover:text-t1"
            )}
          >
            {t === "carton" ? "Carton (or fraction)" : t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={saleType === "carton" ? "Cartons" : saleType === "kg" ? "Weight (kg)" : "Pieces"} hint={saleType === "carton" ? "0.5 = half a carton" : undefined}>
          <Input type="number" min="0.01" step={saleType === "piece" ? "1" : "0.01"} value={qty} onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" />
        </Field>
        <Field label={`Price per ${saleType}`}>
          <Input type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" />
        </Field>
      </div>
      <Field label="Payment">
        <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
          <option value="cash">Cash</option>
          <option value="pos">POS</option>
          <option value="transfer">Transfer</option>
          {creditAllowed && <option value="credit">On credit</option>}
        </Select>
      </Field>
      {needsCustomer && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name"><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Required for credit" /></Field>
          <Field label="Phone" hint="Optional"><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></Field>
        </div>
      )}
      <Button
        className="w-full"
        disabled={busy || !qty || unitPrice === "" || (needsCustomer && !customerName.trim())}
        onClick={submit}
      >
        {busy ? "Selling…" : `Sell ${productName}`}
      </Button>
    </div>
  );
}

// ── Purchase ─────────────────────────────────────────────────────────

function PurchaseForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const { data: supplierData } = useApi<{ suppliers: Supplier[] }>("/suppliers", []);
  const suppliers = supplierData?.suppliers || [];
  const [form, setForm] = useState({
    supplierId: "", purchaseDate: todayStr(), cartonsReceived: "" as number | "",
    packSizeKg: "" as number | "", unitCostPerCarton: "" as number | "", actualWeighedKg: "" as number | "", notes: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true); setError("");
    try {
      await api("/coldroom/batches", {
        method: "POST",
        body: JSON.stringify({
          productId,
          supplierId: form.supplierId || undefined,
          purchaseDate: form.purchaseDate,
          cartonsReceived: Number(form.cartonsReceived) || 0,
          packSizeKg: Number(form.packSizeKg) || 0,
          unitCostPerCarton: Number(form.unitCostPerCarton) || 0,
          ...(form.actualWeighedKg !== "" ? { actualWeighedKg: Number(form.actualWeighedKg) } : {}),
          notes: form.notes,
        }),
      });
      setForm({ supplierId: "", purchaseDate: todayStr(), cartonsReceived: "", packSizeKg: "", unitCostPerCarton: "", actualWeighedKg: "", notes: "" });
      setDone(true);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      {done && <div className="px-3 py-2 rounded-ctl bg-success-soft text-success text-[12px] font-semibold">Batch recorded.</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cartons received"><Input type="number" min="0.01" step="0.01" value={form.cartonsReceived} onChange={(e) => set("cartonsReceived", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
        <Field label="Weight per carton (kg)" hint="This lot only — varies by supplier">
          <Input type="number" min="0.01" step="0.01" value={form.packSizeKg} onChange={(e) => set("packSizeKg", e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cost per carton"><Input type="number" min="0" step="0.01" value={form.unitCostPerCarton} onChange={(e) => set("unitCostPerCarton", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
        <Field label="Purchase date"><Input type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier" hint="Optional">
          <Select value={form.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
            <option value="">None</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Weighed on arrival (kg)" hint="Optional — catches a short delivery early">
          <Input type="number" min="0" step="0.01" value={form.actualWeighedKg} onChange={(e) => set("actualWeighedKg", e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Notes" hint="Optional"><TextArea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <Button className="w-full" disabled={busy || !form.cartonsReceived || !form.packSizeKg} onClick={submit}>
        {busy ? "Recording…" : "Record purchase"}
      </Button>
    </div>
  );
}

// ── Breakdown (open a carton) ────────────────────────────────────────

function BreakdownForm({ batches, onDone }: { batches: Batch[]; onDone: () => void }) {
  const openBatches = batches.filter((b) => b.remainingCartons > 0);
  const [batchId, setBatchId] = useState(openBatches[0]?.id || "");
  const [cartonsOpened, setCartonsOpened] = useState<number | "">(1);
  const [actualWeighedKg, setActualWeighedKg] = useState<number | "">("");
  const [pieceCount, setPieceCount] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Breakdown | null>(null);

  const batch = openBatches.find((b) => b.id === batchId);
  const expected = batch && cartonsOpened ? Math.round(Number(cartonsOpened) * batch.packSizeKg * 100) / 100 : 0;

  if (!openBatches.length) {
    return <div className="text-[12px] text-t4 py-4 text-center">No sealed cartons left to open.</div>;
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      const r = await api<{ breakdown: Breakdown }>(`/coldroom/batches/${batchId}/breakdown`, {
        method: "POST",
        body: JSON.stringify({
          cartonsOpened: Number(cartonsOpened) || 0,
          actualWeighedKg: Number(actualWeighedKg) || 0,
          ...(pieceCount !== "" ? { resultingPieceCount: Number(pieceCount) } : {}),
          note,
        }),
      });
      setResult(r.breakdown);
      setCartonsOpened(1); setActualWeighedKg(""); setPieceCount(""); setNote("");
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      {result && (
        <div className={cn("px-3 py-2.5 rounded-ctl text-[12px] font-semibold", result.varianceKg > 0 ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
          {result.varianceKg > 0
            ? `Shrinkage: ${result.varianceKg}kg of ${result.expectedYieldKg}kg expected (${result.variancePercent}%)`
            : `Weighed in at ${result.actualWeighedKg}kg — no shrinkage.`}
        </div>
      )}
      <Field label="Which batch">
        <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {openBatches.map((b) => (
            <option key={b.id} value={b.id}>{fmtDate(b.purchaseDate)} · {b.remainingCartons} carton(s) left · {b.packSizeKg}kg each</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cartons to open" hint={batch ? `Max ${batch.remainingCartons}` : undefined}>
          <Input type="number" min="0.01" step="0.01" max={batch?.remainingCartons} value={cartonsOpened} onChange={(e) => setCartonsOpened(e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
        <Field label="Weighed out (kg)" hint={expected ? `Expected ~${expected}kg` : undefined}>
          <Input type="number" min="0" step="0.01" value={actualWeighedKg} onChange={(e) => setActualWeighedKg(e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Pieces cut (optional)" hint="If set, this weight is tracked as counted pieces instead of loose kg — leave blank to sell this carton by weight">
        <Input type="number" min="1" step="1" value={pieceCount} onChange={(e) => setPieceCount(e.target.value === "" ? "" : Number(e.target.value))} />
      </Field>
      <Field label="Note" hint="Optional"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button className="w-full" disabled={busy || !cartonsOpened || actualWeighedKg === ""} onClick={submit}>
        {busy ? "Recording…" : "Open carton(s)"}
      </Button>
    </div>
  );
}

// ── Cold-chain loss (single batch) ──────────────────────────────────

function LossForm({ batches, onDone }: { batches: Batch[]; onDone: () => void }) {
  const [batchId, setBatchId] = useState(batches[0]?.id || "");
  const [cartons, setCartons] = useState<number | "">("");
  const [kg, setKg] = useState<number | "">("");
  const [pieces, setPieces] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ valueLost: number } | null>(null);
  const { currency } = useSession();

  const batch = batches.find((b) => b.id === batchId);

  if (!batches.length) {
    return <div className="text-[12px] text-t4 py-4 text-center">No open batches for this product.</div>;
  }

  function fillAll() {
    if (!batch) return;
    setCartons(batch.remainingCartons || ""); setKg(batch.remainingKg || ""); setPieces(batch.remainingPieces || "");
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      const r = await api<{ valueLost: number }>(`/coldroom/batches/${batchId}/cold-chain-loss`, {
        method: "POST",
        body: JSON.stringify({ cartons: Number(cartons) || 0, kg: Number(kg) || 0, pieces: Number(pieces) || 0, note }),
      });
      setDone(r);
      setCartons(""); setKg(""); setPieces(""); setNote("");
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      {done && (
        <div className="px-3 py-2.5 rounded-ctl bg-danger-soft text-danger text-[12px] font-semibold">
          Recorded — {fmtMoney(done.valueLost, currency)} lost at cost.
        </div>
      )}
      <Field label="Which batch">
        <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{fmtDate(b.purchaseDate)} · {b.remainingCartons}c / {b.remainingKg}kg / {b.remainingPieces}pc left</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Cartons lost"><Input type="number" min="0" step="0.01" value={cartons} onChange={(e) => setCartons(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
        <Field label="Kg lost"><Input type="number" min="0" step="0.01" value={kg} onChange={(e) => setKg(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
        <Field label="Pieces lost"><Input type="number" min="0" step="1" value={pieces} onChange={(e) => setPieces(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
      </div>
      <button type="button" onClick={fillAll} className="text-[12px] font-semibold text-primary hover:underline">
        This batch was a total loss
      </button>
      <Field label="What happened" hint="Optional"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button variant="danger" className="w-full" disabled={busy || (!cartons && !kg && !pieces)} onClick={submit}>
        {busy ? "Recording…" : "Record cold-chain loss"}
      </Button>
    </div>
  );
}
