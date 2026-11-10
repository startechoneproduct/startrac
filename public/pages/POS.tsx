import { ReceiptPaper, type ReceiptData } from "@/components/receipt/ReceiptPaper";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Banknote, CreditCard, Smartphone,
  CheckCircle2, ScanLine, Package, UserPlus, Printer, X, CloudOff, RefreshCw, Ruler,
  Split as SplitIcon, ScanBarcode, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Spinner, EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { outboxEnqueue, outboxFlush, outboxList, outboxDiscard, type QueuedSale } from "@/lib/outbox";
import { onOutboxSynced } from "@/lib/outboxDb";
import { fmtMoney } from "@/lib/format";
import { matchesProductCode } from "@/lib/barcodes";
import { fuzzySearch } from "@/lib/fuzzy";
import { WhatsAppReceipt } from "@/components/receipt/WhatsAppReceipt";
import { UndoLastSale } from "@/components/sales/UndoLastSale";
import { QrScanModal } from "@/components/loyalty/QrScanModal";
import { QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

type Product = {
  id: string; name: string; price: number; category: string; stock: number | null; barcode: string; sku?: string;
  archetype?: string; tracksSerials?: boolean; imageUrl?: string;
  bom?: { productId: string; per: string; factor: number }[];
};
type Line = {
  uid: string; id: string; name: string; price: number; stock: number; qty: number;
  // Copied from the product when the line is added, so the cart shows the same
  // photo as the grid even if the product list reloads underneath it.
  imageUrl?: string;
  // Present for any made-to-order line; width/height only when the recipe
  // actually needs a dimension (blinds) — a plain "unit" recipe (a bowl of
  // jollof) omits them and sells like a stock tap, straight to the cart.
  mto?: { width?: number; height?: number };
  serialNos?: string[]; // chosen units, for a tracksSerials product — optional, never blocks checkout
};
type Receipt = ReceiptData;

type Method = "cash" | "pos" | "transfer" | "store_credit";

const PAY_METHODS = [
  { k: "cash", label: "Cash", icon: Banknote },
  { k: "pos", label: "POS", icon: CreditCard },
  { k: "transfer", label: "Transfer", icon: Smartphone },
] as const;
// Store credit isn't a button of its own: it is applied from the customer's balance (see "Use store credit").
const METHOD_META: Record<Method, { label: string; icon: typeof Banknote }> = {
  cash: { label: "Cash", icon: Banknote }, pos: { label: "POS", icon: CreditCard }, transfer: { label: "Transfer", icon: Smartphone },
  store_credit: { label: "Credit", icon: Wallet },
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Notes a Nigerian till actually holds — one tap covers most cash sales.
const NOTES = [500, 1000, 2000, 5000];

/** Cart-line photo; the category icon stands in when there is none or it won't load. */
function LineThumb({ src, custom }: { src?: string; custom: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="w-12 h-12 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0 overflow-hidden">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover" />
      ) : custom ? (
        <Ruler className="w-5 h-5" />
      ) : (
        <Package className="w-5 h-5" />
      )}
    </div>
  );
}

export function POS() {
  const { activeBusiness, activeBranch, currency, hasModule } = useSession();
  const { data, loading, reload } = useApi<{ products: Product[] }>("/products", [activeBranch?.id]);
  const products = useMemo(() => data?.products ?? [], [data]);
  const bizId = activeBusiness?.id || "";
  const branchId = activeBranch?.id || "";

  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [pay, setPay] = useState<Method>("cash");
  // Split tender: when a second method is added the sale is paid across
  // several rows. Empty means "one method, the whole total" — the common case,
  // and the one that must stay a single tap.
  const [splits, setSplits] = useState<{ method: Method; amount: number }[]>([]);
  const [tendered, setTendered] = useState<number | "">("");
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<{ id?: string; name: string; phone: string; storeCredit?: number } | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanProductOpen, setScanProductOpen] = useState(false);
  const [cardMsg, setCardMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cartOpen, setCartOpen] = useState(false); // mobile slide-over
  const [queued, setQueued] = useState<QueuedSale[]>([]);
  const [savedOffline, setSavedOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshQueue = () => {
    if (bizId && branchId) setQueued(outboxList(bizId, branchId));
  };

  async function syncOutbox() {
    if (!bizId || !branchId || syncing) return;
    setSyncing(true);
    try {
      const r = await outboxFlush(bizId, branchId);
      refreshQueue();
      if (r.sent > 0) reload(); // stock moved server-side; refresh the grid
    } finally {
      setSyncing(false);
    }
  }

  // On entry and whenever the network returns, push queued sales through.
  // The service worker can also sync a queued sale in the background (see
  // outboxDb.ts) — when it does, it can only touch the IndexedDB mirror, so
  // this tab's own localStorage-backed list needs telling separately.
  useEffect(() => {
    refreshQueue();
    syncOutbox();
    const onOnline = () => syncOutbox();
    window.addEventListener("online", onOnline);
    const offSynced = onOutboxSynced((clientSaleId, ok) => {
      if (ok) outboxDiscard(bizId, branchId, clientSaleId);
      refreshQueue();
      if (ok) reload();
    });
    return () => { window.removeEventListener("online", onOnline); offSynced(); };
  }, [bizId, branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = useMemo(() => ["All", ...Array.from(new Set(products.map((p) => p.category))).sort()], [products]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Forgiving search (see lib/fuzzy.ts): typos, missing spaces and partial
  // codes still find the product, best match first. A scanned code that
  // matches exactly always comes first.
  const filtered = useMemo(() => {
    const inCat = products.filter((p) => cat === "All" || p.category === cat);
    if (!q.trim()) return inCat;
    const exact = inCat.filter((p) => matchesProductCode(p, q));
    const rest = fuzzySearch(inCat.filter((p) => !exact.includes(p)), q, (p) => [p.name, p.sku, p.barcode, p.category]);
    return [...exact, ...rest];
  }, [products, cat, q]);

  // Barcode scanners are keyboards: exact barcode match + Enter adds instantly.
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !q) return;
    const exact = products.find((p) => matchesProductCode(p, q));
    if (exact) {
      add(exact);
      setQ("");
    } else if (filtered.length === 1) {
      add(filtered[0]);
      setQ("");
    }
  }

  // What a scanned or typed code refers to, shown in the scanner before it goes in the basket.
  function findScanned(code: string) {
    const hit = products.find((p) => matchesProductCode(p, code));
    if (!hit) return null;
    // How many more can go in: what's on the shelf less what's already in the basket.
    const available = isMto(hit) ? null : Math.max(0, (hit.stock ?? 0) - inCart(hit.id));
    const inBasket = inCart(hit.id);
    const left = available === null ? "" : available <= 0 ? " · none left to sell" : ` · ${available} left${inBasket ? ` (${inBasket} already in this sale)` : ""}`;
    return { title: hit.name, subtitle: `${fmtMoney(hit.price, currency)} each${left}`, imageUrl: hit.imageUrl };
  }

  // A scanned or typed product, confirmed in the scanner: into the basket (change how many in the cart).
  function onScanProduct(code: string) {
    setScanProductOpen(false);
    const hit = products.find((p) => matchesProductCode(p, code));
    if (hit) { add(hit); setError(""); } else setError(`No product matches “${code.trim()}”.`);
  }

  const [mtoFor, setMtoFor] = useState<Product | null>(null);
  const [serialFor, setSerialFor] = useState<Line | null>(null);
  const isMto = (p: Product) => p.archetype === "made_to_order";
  // A recipe scales by area/side only if some component's bom line says so
  // (blinds, priced per m²). A plain "unit" recipe — rice, chicken, tomato
  // behind a bowl of jollof — needs no dimensions at all.
  const needsDims = (p: Product) => (p.bom || []).some((l) => l.per !== "unit");
  const inCart = (id: string) => cart.filter((l) => l.id === id && !l.mto).reduce((s, l) => s + l.qty, 0);

  const add = (p: Product) => {
    setError("");
    if (isMto(p)) {
      if (needsDims(p)) {
        setMtoFor(p); // custom items need dimensions first
        return;
      }
      // Plain recipe item — sells in one tap, same feel as a stock product.
      setCart((c) => {
        const ex = c.find((l) => l.id === p.id && l.mto && !l.mto.width);
        if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
        return [...c, { uid: crypto.randomUUID(), id: p.id, name: p.name, price: p.price, stock: Infinity, qty: 1, mto: {}, imageUrl: p.imageUrl }];
      });
      return;
    }
    if ((p.stock ?? 0) - inCart(p.id) <= 0) return;
    setCart((c) => {
      const ex = c.find((l) => l.id === p.id && !l.mto);
      if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { uid: crypto.randomUUID(), id: p.id, name: p.name, price: p.price, stock: p.stock ?? 0, qty: 1, imageUrl: p.imageUrl }];
    });
  };
  const addMtoLine = (p: Product, width: number, height: number, qty: number, unitPrice: number) => {
    setCart((c) => [
      ...c,
      {
        uid: crypto.randomUUID(), id: p.id, name: `${p.name} — ${width}×${height}m`,
        price: unitPrice, stock: Infinity, qty, mto: { width, height }, imageUrl: p.imageUrl,
      },
    ]);
    setMtoFor(null);
  };
  const setQty = (uid: string, d: number) =>
    setCart((c) =>
      c
        .map((l) => (l.uid === uid ? { ...l, qty: Math.min(l.stock, Math.max(0, l.qty + d)) } : l))
        .filter((l) => l.qty > 0)
    );
  const remove = (uid: string) => setCart((c) => c.filter((l) => l.uid !== uid));
  const setSerials = (uid: string, serialNos: string[]) =>
    setCart((c) => c.map((l) => (l.uid === uid ? { ...l, serialNos } : l)));

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);

  // A scanned card just tells us who the customer is and what they're owed —
  // it maps straight onto the existing flat-currency discount state, the
  // same field the discount input below feeds. No sale-schema change needed.
  async function onScanCode(code: string) {
    setScanOpen(false);
    setError("");
    try {
      const r = await api<{ customerId: string; customerName: string; discountType: "percent" | "flat"; discountValue: number }>(
        "/loyalty-cards/scan",
        { method: "POST", body: JSON.stringify({ code }) }
      );
      setCustomer({ id: r.customerId, name: r.customerName, phone: "" });
      const amount = r.discountType === "percent" ? round2((subtotal * r.discountValue) / 100) : r.discountValue;
      setDiscount(amount);
      setCardMsg(`Loyalty card applied — ${r.discountType === "percent" ? `${r.discountValue}% off` : fmtMoney(r.discountValue, currency)} for ${r.customerName}.`);
      setTimeout(() => setCardMsg(""), 5000);
    } catch (err: any) {
      setError(err.message || "That loyalty card couldn't be scanned.");
    }
  }
  const safeDiscount = Math.min(discount, subtotal);
  const vatRate = activeBusiness?.settings.vatEnabled ? activeBusiness.settings.vatRate : 0;
  const vat = Math.round((subtotal - safeDiscount) * vatRate) / 100;
  const total = Math.round((subtotal - safeDiscount + vat) * 100) / 100;
  const count = cart.reduce((s, l) => s + l.qty, 0);

  // ── payment maths ──────────────────────────────────────────────────
  const splitting = splits.length > 0;
  // The split rows the user has entered, plus whatever is still unpaid on the
  // method currently selected. That way the total always balances and the
  // server never sees a mismatch.
  const splitPaid = round2(splits.reduce((s, p) => s + p.amount, 0));
  const outstanding = round2(Math.max(0, total - splitPaid));
  const payments = splitting
    ? [...splits, ...(outstanding > 0 ? [{ method: pay, amount: outstanding }] : [])]
    : [{ method: pay, amount: total }];
  // Merge duplicates — the server refuses a method appearing twice.
  const mergedPayments = Object.values(
    payments.reduce<Record<string, { method: Method; amount: number }>>((acc, p) => {
      acc[p.method] = { method: p.method, amount: round2((acc[p.method]?.amount || 0) + p.amount) };
      return acc;
    }, {})
  ).filter((p) => p.amount > 0);

  const cashDue = mergedPayments.find((p) => p.method === "cash")?.amount || 0;
  const tenderedNum = tendered === "" ? 0 : Number(tendered);
  const change = tenderedNum > 0 ? round2(tenderedNum - cashDue) : 0;
  const shortTender = tenderedNum > 0 && tenderedNum < cashDue - 0.01;

  const addSplit = () => {
    if (outstanding <= 0 && splitting) return;
    // Freeze what's outstanding onto the current method, then move the
    // selection to a method that hasn't been used yet.
    const taken = new Set([...splits.map((s) => s.method), pay]);
    const next = (["cash", "pos", "transfer"] as Method[]).find((m) => !taken.has(m));
    if (!next) return;
    setSplits((s) => [...s, { method: pay, amount: splitting ? outstanding : total }]);
    setPay(next);
  };
  const removeSplit = (i: number) => setSplits((s) => s.filter((_, idx) => idx !== i));
  const editSplit = (i: number, amount: number) =>
    setSplits((s) => s.map((p, idx) => (idx === i ? { ...p, amount: Math.max(0, round2(amount)) } : p)));

  const resetPayment = () => { setSplits([]); setTendered(""); };

  // Credit applied can never be more than the sale, even if items come off after.
  useEffect(() => {
    setSplits((s) => (s.some((x) => x.method === "store_credit" && x.amount > total) ? s.map((x) => (x.method === "store_credit" ? { ...x, amount: round2(Math.max(0, total)) } : x)).filter((x) => x.amount > 0) : s));
  }, [total]);

  // Pays what it can from the customer's store credit; anything left stays on the chosen method.
  function applyStoreCredit() {
    const credit = customer?.storeCredit || 0;
    const amount = round2(Math.min(credit, total));
    if (amount <= 0) return;
    setSplits((s) => [{ method: "store_credit", amount }, ...s.filter((x) => x.method !== "store_credit")]);
  }

  async function checkout() {
    if (!cart.length || busy) return;
    if (shortTender) { setError("Cash tendered is less than the cash due."); return; }
    if (splitting && outstanding > 0.01 && !mergedPayments.some((p) => p.method === pay)) {
      setError("Assign the remaining balance to a payment method.");
      return;
    }
    setBusy(true);
    setError("");
    setSavedOffline(false);
    const body = {
      items: cart.map((l) =>
        l.mto
          ? { productId: l.id, qty: l.qty, ...(l.mto.width ? { width: l.mto.width, height: l.mto.height } : {}), price: l.price }
          : { productId: l.id, qty: l.qty, ...(l.serialNos?.length ? { serialNos: l.serialNos } : {}) }
      ),
      discount: safeDiscount,
      payments: mergedPayments,
      ...(tenderedNum > 0 ? { tendered: tenderedNum } : {}),
      ...(customer?.id ? { customerId: customer.id } : customer?.name ? { customer } : {}),
      clientSaleId: crypto.randomUUID(),
    };
    try {
      const res = await api<{ receipt: Receipt; sale: { id: string } }>("/sales", { method: "POST", body: JSON.stringify(body) });
      setReceipt({ ...res.receipt, saleId: res.sale.id });
      setCart([]);
      setDiscount(0);
      setCustomer(null);
      setCardMsg("");
      resetPayment();
      setCartOpen(false);
      reload();
    } catch (err: any) {
      if (err.status === 0) {
        // No network: queue the sale, keep selling. It syncs itself later.
        outboxEnqueue(bizId, branchId, {
          clientSaleId: body.clientSaleId,
          body,
          total,
          itemCount: count,
          queuedAt: new Date().toISOString(),
        });
        refreshQueue();
        setCart([]);
        setDiscount(0);
        setCustomer(null);
        setCardMsg("");
        resetPayment();
        setSavedOffline(true);
        setTimeout(() => setSavedOffline(false), 4000);
      } else {
        setError(err.message || "Checkout failed");
        if (err.code === "insufficient_stock") reload();
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <div className="h-full flex">
      {/* LEFT: products */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-line bg-surface flex items-center gap-3">
          <button type="button" onClick={() => setScanProductOpen(true)} aria-label="Scan a product QR code or barcode with the camera" className="w-12 h-12 rounded-ctl border border-line-2 bg-surface-2 flex items-center justify-center text-t3 hover:text-primary hover:border-brand-400 shrink-0 transition-colors" title="Scan a product with the camera (a handheld scanner can just type into search)">
            <ScanLine className="w-5 h-5" />
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-t4 pointer-events-none" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search or scan…"
              className="w-full h-12 pl-11 pr-4 rounded-full bg-surface-2 border border-line text-[14px] text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-primary-softer transition-colors"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-b border-line bg-surface flex gap-2 overflow-x-auto">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "px-4 h-9 rounded-full text-[12px] font-semibold whitespace-nowrap border transition-colors shrink-0",
                cat === c ? "bg-primary border-primary text-on-primary" : "bg-surface-2 border-line-2 text-t2 hover:bg-surface-3"
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <Spinner />
          ) : products.length === 0 ? (
            <EmptyState icon={Package} title="No products yet" body="Add products on the Products page (or ask your manager to) and they'll appear here, ready to sell." />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {filtered.map((p) => {
                const mto = isMto(p);
                const custom = mto && needsDims(p); // only a dimensioned recipe counts as "Custom"
                const left = mto ? Infinity : (p.stock ?? 0) - inCart(p.id);
                const oos = !mto && left <= 0;
                const low = !mto && left > 0 && left <= 5;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p)}
                    disabled={oos}
                    className={cn(
                      "group relative text-left bg-surface border border-line rounded-card p-4 pt-5 overflow-hidden transition-all duration-150",
                      oos ? "opacity-40 cursor-not-allowed" : "hover:border-brand-400 hover:shadow-e1 active:translate-y-0"
                    )}
                  >
                    <span className="absolute top-0 inset-x-0 h-0.75 bg-primary/80" />
                    {custom && <span className="absolute top-3 right-2.5"><Badge tone="brand">Custom</Badge></span>}
                    {low && <span className="absolute top-3 right-2.5"><Badge tone="warning">Low</Badge></span>}
                    {oos && <span className="absolute top-3 right-2.5"><Badge tone="danger">Out</Badge></span>}
                    <div className="w-full h-20 rounded-lg bg-primary-soft text-primary flex items-center justify-center mb-3 overflow-hidden">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : custom ? (
                        <Ruler className="w-6 h-6" />
                      ) : (
                        <Package className="w-6 h-6" />
                      )}
                    </div>
                    <div className="text-[13px] font-semibold text-t1 leading-tight line-clamp-2 h-9">{p.name}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono font-semibold text-[14px] text-primary">
                        {fmtMoney(p.price, currency)}{custom && <span className="text-[10px] text-t4 font-sans">/m²</span>}
                      </span>
                      {!mto && <span className="text-[11px] text-t4">{left} left</span>}
                    </div>
                    <span className="absolute bottom-3 right-3 w-6 h-6 rounded-lg bg-primary text-on-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="w-4 h-4" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile: floating cart button */}
      <button
        onClick={() => setCartOpen(true)}
        className={cn(
          "lg:hidden fixed bottom-4 right-4 z-40 h-12 px-5 rounded-full bg-primary text-on-primary text-[14px] font-display font-semibold shadow-e2 flex items-center gap-2 active:scale-[0.98] transition-transform",
          cartOpen && "hidden"
        )}
      >
        <ShoppingCart className="w-4 h-4" />
        {count > 0 ? `${count} · ${fmtMoney(total, currency)}` : "Cart"}
      </button>

      {/* RIGHT: cart — desktop column, mobile slide-over */}
      <aside
        className={cn(
          "w-[360px] shrink-0 border-l border-line bg-surface flex-col",
          "max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:w-full max-lg:border-l-0",
          cartOpen ? "flex" : "max-lg:hidden lg:flex"
        )}
      >
        <div className="p-4 border-b border-line flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-primary" />
          <span className="font-semibold text-[14px] text-t1">Current Sale</span>
          {count > 0 && <span className="ml-auto"><Badge tone="brand">{count} items</Badge></span>}
          <button
            onClick={() => setCartOpen(false)}
            className={cn("lg:hidden w-8 h-8 rounded-lg border border-line flex items-center justify-center text-t3", count === 0 && "ml-auto")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-14 h-14 rounded-xl bg-surface-3 text-t4 flex items-center justify-center mb-3">
                <ShoppingCart className="w-7 h-7" />
              </div>
              <div className="text-[13px] font-semibold text-t2">Cart is empty</div>
              <div className="text-[12px] text-t4 mt-1">Tap a product to add it to the sale</div>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((l) => (
                <div key={l.uid} className="flex items-start gap-2.5 bg-surface-2 border border-line rounded-xl p-3 animate-fade-in">
                  <LineThumb src={l.imageUrl} custom={!!l.mto} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-semibold text-t1 leading-tight">
                        {l.name}
                        {l.mto && <span className="ml-1.5 align-middle"><Badge tone="brand">Custom</Badge></span>}
                      </span>
                      <button onClick={() => remove(l.uid)} className="text-t4 hover:text-danger transition-colors shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-[11px] text-t3 font-mono mt-0.5">{fmtMoney(l.price, currency)} each</div>
                    {!l.mto && productById.get(l.id)?.tracksSerials && (
                      <button
                        type="button"
                        onClick={() => setSerialFor(l)}
                        className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        <ScanBarcode className="w-3 h-3" />
                        {l.serialNos?.length ? `${l.serialNos.length}/${l.qty} serials picked` : "Pick serial (optional)"}
                      </button>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setQty(l.uid, -1)} className="w-8 h-8 rounded-lg border border-line-2 bg-surface flex items-center justify-center text-t2 hover:bg-surface-3 hover:text-primary transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center font-mono font-semibold text-[13px] text-t1">{l.qty}</span>
                        <button onClick={() => setQty(l.uid, 1)} className="w-8 h-8 rounded-lg border border-line-2 bg-surface flex items-center justify-center text-t2 hover:bg-surface-3 hover:text-primary transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-mono font-semibold text-[14px] text-t1 tabular-nums">{fmtMoney(l.price * l.qty, currency)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line p-4 space-y-3">
          {/* offline queue */}
          {savedOffline && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-ctl bg-warning-soft text-warning text-[12px] font-semibold">
              <CloudOff className="w-4 h-4 shrink-0" /> No network — sale saved on this device. It will sync automatically.
            </div>
          )}
          {queued.length > 0 && (
            <div className="rounded-ctl border border-line bg-warning-soft/50 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-warning">
                <CloudOff className="w-4 h-4 shrink-0" />
                {queued.length} sale{queued.length === 1 ? "" : "s"} waiting to sync
                <button
                  onClick={syncOutbox}
                  disabled={syncing}
                  className="ml-auto flex items-center gap-1 px-2 h-7 rounded-lg border border-line-2 bg-surface text-[11px] font-semibold text-t2 hover:text-t1 disabled:opacity-50"
                >
                  <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} /> {syncing ? "Syncing…" : "Sync now"}
                </button>
              </div>
              {queued.filter((s) => s.error).map((s) => (
                <div key={s.clientSaleId} className="flex items-center gap-2 text-[11px] text-danger">
                  <span className="flex-1 min-w-0 truncate">
                    {fmtMoney(s.total, currency)} ({s.itemCount} items) rejected: {s.error}
                  </span>
                  <button
                    onClick={() => { outboxDiscard(bizId, branchId, s.clientSaleId); refreshQueue(); }}
                    className="shrink-0 font-semibold underline"
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* customer */}
          {customer ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-ctl bg-primary-softer border border-line text-[12px]">
              <UserPlus className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-semibold text-t1 truncate">{customer.name}</span>
              {customer.phone && <span className="text-t3">{customer.phone}</span>}
              {!!customer.storeCredit && <span className="text-success font-semibold whitespace-nowrap">{fmtMoney(customer.storeCredit, currency)} credit</span>}
              <button onClick={() => { setCustomer(null); setCardMsg(""); setSplits((s) => s.filter((x) => x.method !== "store_credit")); }} className="ml-auto text-t4 hover:text-danger" aria-label="Remove customer"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setCustomerOpen(true)} className="flex-1 flex items-center gap-2 px-3 h-9 rounded-ctl border border-dashed border-line-2 text-[12px] font-semibold text-t3 hover:text-primary hover:border-brand-400 transition-colors">
                <UserPlus className="w-3.5 h-3.5" /> Attach customer (optional)
              </button>
              {hasModule("loyaltyCard") && (
                <button onClick={() => setScanOpen(true)} title="Scan a loyalty card" className="shrink-0 w-9 h-9 rounded-ctl border border-dashed border-line-2 flex items-center justify-center text-t3 hover:text-primary hover:border-brand-400 transition-colors">
                  <QrCode className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          {cardMsg && <div className="px-3 py-2 rounded-ctl bg-success-soft text-success text-[11px] font-semibold">{cardMsg}</div>}

          {/* payment methods — one tap for the usual sale, split when needed */}
          <div className="space-y-2">
            {/* locked-in split rows */}
            {splits.map((s, i) => {
              const M = METHOD_META[s.method];
              return (
                <div key={`${s.method}-${i}`} className="flex items-center gap-2 px-2.5 h-10 rounded-ctl bg-primary-softer border border-line">
                  <M.icon className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-[12px] font-semibold text-t2 w-[58px] shrink-0">{M.label}</span>
                  <input
                    type="number"
                    value={s.amount || ""}
                    onChange={(e) => editSplit(i, Number(e.target.value) || 0)}
                    className="flex-1 min-w-0 h-7 px-2 rounded-lg bg-surface border border-line text-[13px] font-mono text-right text-t1 focus:outline-none focus:border-brand-500"
                  />
                  <button onClick={() => removeSplit(i)} className="text-t4 hover:text-danger shrink-0" title="Remove this payment">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            {!!customer?.id && (customer.storeCredit || 0) > 0 && cart.length > 0 && !splits.some((s) => s.method === "store_credit") && (
              <button onClick={applyStoreCredit} className="w-full flex items-center gap-2 px-3 h-10 rounded-ctl border border-success/40 bg-success-soft text-[12px] font-semibold text-success hover:brightness-95">
                <Wallet className="w-4 h-4" /> Use store credit · {fmtMoney(Math.min(customer.storeCredit || 0, total), currency)} of {fmtMoney(customer.storeCredit || 0, currency)}
              </button>
            )}

            <div className="grid grid-cols-3 gap-2">
              {PAY_METHODS.map(({ k, label, icon: Icon }) => {
                const used = splits.some((s) => s.method === k);
                const selected = !used && pay === k;
                return (
                  <button
                    key={k}
                    onClick={() => !used && setPay(k)}
                    disabled={used}
                    className={cn(
                      "relative h-12 rounded-ctl border flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                      used
                        ? "bg-surface-3 border-line text-t4 cursor-not-allowed"
                        : selected
                          ? "bg-primary-softer border-primary text-primary"
                          : "bg-surface-2 border-line-2 text-t2 hover:bg-surface-3"
                    )}
                  >
                    {selected && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />}
                    <Icon className="w-4 h-4" />
                    {label}
                    {splitting && pay === k && outstanding > 0 && (
                      <span className="font-mono text-[10px] text-primary">{fmtMoney(outstanding, currency)}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {splits.length < 2 && cart.length > 0 && (
                <button
                  onClick={addSplit}
                  className="flex items-center gap-1 text-[11px] font-semibold text-t3 hover:text-primary transition-colors"
                >
                  <SplitIcon className="w-3.5 h-3.5" /> Split payment
                </button>
              )}
              {splitting && (
                <button onClick={resetPayment} className="ml-auto text-[11px] font-semibold text-t4 hover:text-danger transition-colors">
                  Clear split
                </button>
              )}
            </div>
          </div>

          {/* cash tendered → change due */}
          {cashDue > 0 && (
            <div className="rounded-ctl border border-line bg-surface-2 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-t3 shrink-0">Cash in</span>
                <input
                  type="number"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  placeholder={String(Math.ceil(cashDue))}
                  className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-surface border border-line text-[13px] font-mono text-right text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500"
                />
                {tendered !== "" && (
                  <button onClick={() => setTendered("")} className="text-t4 hover:text-danger shrink-0"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setTendered(round2(cashDue))}
                  className="flex-1 h-7 rounded-lg border border-line-2 bg-surface text-[11px] font-semibold text-t3 hover:text-primary hover:border-brand-400 transition-colors"
                >
                  Exact
                </button>
                {NOTES.filter((n) => n > cashDue).slice(0, 3).map((n) => (
                  <button
                    key={n}
                    onClick={() => setTendered(n)}
                    className="flex-1 h-7 rounded-lg border border-line-2 bg-surface text-[11px] font-mono font-semibold text-t3 hover:text-primary hover:border-brand-400 transition-colors"
                  >
                    {n.toLocaleString()}
                  </button>
                ))}
              </div>
              {shortTender ? (
                <div className="flex justify-between text-[12px] font-semibold text-danger">
                  <span>Short by</span>
                  <span className="font-mono tabular-nums">{fmtMoney(cashDue - tenderedNum, currency)}</span>
                </div>
              ) : change > 0 ? (
                <div className="flex justify-between items-center text-success">
                  <span className="text-[12px] font-medium">Change due</span>
                  <span className="font-mono font-semibold text-[17px] tabular-nums">{fmtMoney(change, currency)}</span>
                </div>
              ) : null}
            </div>
          )}

          {/* discount */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-t3 shrink-0">Discount</span>
            <input
              type="number"
              value={discount || ""}
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
              className="flex-1 h-9 px-3 rounded-lg bg-surface-2 border border-line text-[13px] font-mono text-t1 placeholder:text-t4 focus:outline-none focus:border-brand-500 text-right"
            />
          </div>

          {/* totals */}
          <div className="bg-surface-2 rounded-xl border border-line p-3 space-y-1.5">
            <div className="flex justify-between text-[12px] text-t2">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{fmtMoney(subtotal, currency)}</span>
            </div>
            {safeDiscount > 0 && (
              <div className="flex justify-between text-[12px] text-danger">
                <span>Discount</span>
                <span className="font-mono tabular-nums">−{fmtMoney(safeDiscount, currency)}</span>
              </div>
            )}
            {vatRate > 0 && (
              <div className="flex justify-between text-[12px] text-t2">
                <span>VAT ({vatRate}%)</span>
                <span className="font-mono tabular-nums">{fmtMoney(vat, currency)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1.5 border-t border-line">
              <span className="font-display text-[14px] font-semibold text-t1">Total</span>
              <span className="font-mono font-semibold text-[20px] text-primary tabular-nums">{fmtMoney(total, currency)}</span>
            </div>
          </div>

          {error && <div className="px-3 py-2 rounded-ctl bg-danger-soft text-danger text-[12px] font-semibold">{error}</div>}

          <Button variant="success" size="lg" className="w-full font-display" onClick={checkout} disabled={!cart.length || busy || shortTender}>
            <CheckCircle2 className="w-5 h-5" />
            {busy ? "Processing…" : `Complete Sale · ${fmtMoney(total, currency)}`}
          </Button>
          <UndoLastSale refresh={receipt?.saleId} currency={currency} onUndone={reload} />
        </div>
      </aside>

      {/* made-to-order dimensions modal */}
      <MtoModal key={mtoFor?.id ?? "mto-closed"} product={mtoFor} currency={currency} onClose={() => setMtoFor(null)} onAdd={addMtoLine} />

      {/* serial picker — optional, never blocks checkout */}
      <SerialPickerModal
        key={serialFor?.uid ?? "serial-closed"}
        line={serialFor}
        onClose={() => setSerialFor(null)}
        onSave={(serialNos) => { if (serialFor) setSerials(serialFor.uid, serialNos); setSerialFor(null); }}
      />

      {/* customer modal */}
      <CustomerQuickAdd open={customerOpen} onClose={() => setCustomerOpen(false)} onPick={(c) => { setCustomer(c); setCustomerOpen(false); }} currency={currency} />
      <QrScanModal open={scanOpen} onClose={() => setScanOpen(false)} onCode={onScanCode} />
      <QrScanModal open={scanProductOpen} onClose={() => setScanProductOpen(false)} onCode={onScanProduct} kind="product" lookup={findScanned} />

      {/* receipt modal */}
      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}

// Dimensions + price for made-to-order items. The suggested price is
// rate × width × height; the seller can adjust the final figure.
function MtoModal({ product, currency, onClose, onAdd }: {
  product: Product | null;
  currency: string;
  onClose: () => void;
  onAdd: (p: Product, width: number, height: number, qty: number, unitPrice: number) => void;
}) {
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [qty, setQtyN] = useState(1);
  const [price, setPrice] = useState<string>("");
  const [touched, setTouched] = useState(false);
  if (!product) return null;

  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const suggested = Math.round(product.price * w * h * 100) / 100;
  const effective = touched && price !== "" ? Number(price) : suggested;

  return (
    <Modal open={!!product} onClose={onClose} title={product.name} subtitle={`${fmtMoney(product.price, currency)} per m² — enter the order's size`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (w > 0 && h > 0 && effective >= 0) onAdd(product, w, h, Math.max(1, qty), Math.round(effective * 100) / 100);
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Width (m)"><Input autoFocus required type="number" min="0.01" step="0.01" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="1.2" /></Field>
          <Field label="Height (m)"><Input required type="number" min="0.01" step="0.01" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="1.5" /></Field>
          <Field label="Quantity"><Input type="number" min="1" value={qty} onChange={(e) => setQtyN(Number(e.target.value) || 1)} /></Field>
        </div>
        <Field label="Price each" hint={w > 0 && h > 0 ? `Suggested: ${fmtMoney(suggested, currency)} (${(w * h).toFixed(2)} m²)` : "Fills in from the size"}>
          <Input
            type="number" min="0" step="0.01"
            value={touched ? price : suggested || ""}
            onChange={(e) => { setTouched(true); setPrice(e.target.value); }}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={!(w > 0 && h > 0)}>
          <Plus className="w-4 h-4" /> Add to sale · {fmtMoney((effective || 0) * Math.max(1, qty), currency)}
        </Button>
      </form>
    </Modal>
  );
}

// Optional: pick which specific in-stock unit(s) this cart line sells. Skip
// it and checkout still goes through with no serial attached — this is a
// nicety for serial-tracked products, never a requirement.
function SerialPickerModal({ line, onClose, onSave }: {
  line: Line | null;
  onClose: () => void;
  onSave: (serialNos: string[]) => void;
}) {
  const { hasFeature } = useSession();
  const { data, loading } = useApi<{ serials: { serialNo: string }[] }>(
    line && hasFeature("verticals") ? `/serials?productId=${line.id}&status=in_stock` : null,
    [line?.id]
  );
  const [picked, setPicked] = useState<string[]>(line?.serialNos || []);
  if (!line) return null;
  const available = data?.serials || [];

  function toggle(serialNo: string) {
    setPicked((p) =>
      p.includes(serialNo) ? p.filter((s) => s !== serialNo) : p.length < line!.qty ? [...p, serialNo] : p
    );
  }

  return (
    <Modal open={!!line} onClose={onClose} title={`Pick serial — ${line.name}`} subtitle={`Choose up to ${line.qty} unit(s), or skip this`}>
      {loading ? (
        <Spinner />
      ) : available.length === 0 ? (
        <EmptyState icon={ScanBarcode} title="No serials registered yet" body="Register units for this product on the Stock In page, then come back here." />
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {available.map((s) => {
            const checked = picked.includes(s.serialNo);
            return (
              <label
                key={s.serialNo}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-ctl border cursor-pointer transition-colors",
                  checked ? "border-brand-400 bg-primary-softer" : "border-line hover:bg-surface-2"
                )}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(s.serialNo)} className="accent-primary" />
                <span className="font-mono text-[13px] text-t1">{s.serialNo}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 mt-4">
        <Button type="button" variant="secondary" className="flex-1" onClick={() => onSave([])}>Skip</Button>
        <Button type="button" className="flex-1" disabled={!picked.length} onClick={() => onSave(picked)}>
          Use {picked.length || ""} selected
        </Button>
      </div>
    </Modal>
  );
}

type PickedCustomer = { id?: string; name: string; phone: string; storeCredit?: number };
function CustomerQuickAdd({ open, onClose, onPick, currency }: { open: boolean; onClose: () => void; onPick: (c: PickedCustomer) => void; currency: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; phone: string; storeCredit: number }[]>([]);
  // Existing customers matching what's typed, so their history (and any store credit) carries on.
  useEffect(() => {
    const q = (name || phone).trim();
    if (!open || q.length < 2) { setFound([]); return; }
    let stale = false;
    const t = setTimeout(() => {
      api<{ customers: { id: string; name: string; phone: string; storeCredit: number }[] }>(`/customers?q=${encodeURIComponent(q)}`)
        .then((r) => { if (!stale) setFound(r.customers.slice(0, 5)); })
        .catch(() => { if (!stale) setFound([]); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [name, phone, open]);
  return (
    <Modal open={open} onClose={onClose} title="Attach a customer" subtitle="Builds their purchase history and spend automatically">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            onPick({ name: name.trim(), phone: phone.trim() });
            setName(""); setPhone("");
          }
        }}
        className="space-y-3"
      >
        <Input autoFocus placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input placeholder="Phone / WhatsApp (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {found.length > 0 && (
          <div className="rounded-ctl border border-line divide-y divide-line">
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-t3">Existing customers</div>
            {found.map((c) => (
              <button key={c.id} type="button" onClick={() => { onPick({ id: c.id, name: c.name, phone: c.phone, storeCredit: c.storeCredit }); setName(""); setPhone(""); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2">
                <span className="font-semibold text-t1 truncate">{c.name}</span>
                {c.phone && <span className="text-t3">{c.phone}</span>}
                {c.storeCredit > 0 && <span className="ml-auto text-success font-semibold whitespace-nowrap">{fmtMoney(c.storeCredit, currency)} credit</span>}
              </button>
            ))}
          </div>
        )}
        <Button type="submit" className="w-full">Attach as a new customer</Button>
      </form>
    </Modal>
  );
}

export function ReceiptModal({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  if (!receipt) return null;
  // Portalled for the same reason as Modal: a transformed ancestor would
  // otherwise anchor this overlay somewhere other than the viewport.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40  print:hidden" onClick={onClose} />
      <div className="relative w-full max-w-sm pop border border-line-2 rounded-xl shadow-e2 animate-fade-up overflow-hidden print-receipt">
        <div className="pt-5 text-center print:hidden"><CheckCircle2 className="w-10 h-10 text-success mx-auto" /></div>
        <div className="p-4 max-h-[55vh] overflow-y-auto print:max-h-none print:overflow-visible print:p-0">
          <ReceiptPaper receipt={receipt} />
        </div>
        <div className="p-4 border-t border-line space-y-2 print:hidden">
          {receipt.saleId && <WhatsAppReceipt saleId={receipt.saleId} phone={receipt.customerPhone} />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</Button>
            <Button onClick={onClose}>New Sale</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
