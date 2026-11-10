import { fmtDateTime, fmtMoney, payLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ReceiptDesign = {
  template: "classic" | "modern" | "compact" | "bold";
  headerNote: string;
  address: string;
  phone: string;
  /** Filled by the server only when the owner chose to print it. */
  taxId?: string;
  showCashier: boolean;
  showCustomer: boolean;
  showPayments: boolean;
  paperWidth: "58" | "80";
  textSize: "sm" | "md" | "lg";
};

export const DEFAULT_DESIGN: ReceiptDesign = {
  template: "classic", headerNote: "", address: "", phone: "", taxId: "",
  showCashier: true, showCustomer: true, showPayments: true, paperWidth: "80", textSize: "md",
};

export type ReceiptData = {
  saleNo: string; businessName: string; at: string; staffName: string; customerName: string;
  customerPhone?: string;
  /** The business logo, printed at the top (Business plan; the server leaves it empty otherwise). */
  logoUrl?: string;
  /** Set on the till once the sale is saved, so the receipt can be sent on. */
  saleId?: string;
  items: { name: string; qty: number; unitPrice: number; lineNet: number }[];
  subtotal: number; discount: number; vat: number; total: number;
  payments: { method: string; amount: number }[];
  tendered?: number; change?: number;
  footer: string; currency: string;
  design?: ReceiptDesign;
};

const SIZE = { sm: 11, md: 12.5, lg: 14 } as const;
// Ink on a till printer is black; keep coloured bands printing as designed.
const ink = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties;

function Row({ left, right, strong, muted, mono = true }: { left: React.ReactNode; right: React.ReactNode; strong?: boolean; muted?: boolean; mono?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-bold", muted && "opacity-60")}>
      <span className="min-w-0 break-words">{left}</span>
      <span className={cn("shrink-0 tabular-nums", mono && "font-mono")}>{right}</span>
    </div>
  );
}

/**
 * The receipt itself, in one of four layouts, at the chosen paper width and text
 * size. Used by the till (what the customer gets) and by the designer (a live
 * preview), so the two can never disagree.
 */
export function ReceiptPaper({ receipt: r, design: d = r.design || DEFAULT_DESIGN }: { receipt: ReceiptData; design?: ReceiptDesign }) {
  const m = (n: number) => fmtMoney(n, r.currency, false);
  const base = SIZE[d.textSize];
  const t = d.template;
  const contact = [d.address, d.phone].filter(Boolean);
  const meta = (
    <>
      <div className="font-mono opacity-70">{r.saleNo} · {fmtDateTime(r.at)}</div>
      {(d.showCashier || (d.showCustomer && r.customerName)) && (
        <div className="opacity-70">
          {d.showCashier ? `Served by ${r.staffName}` : ""}{d.showCashier && d.showCustomer && r.customerName ? " · " : ""}{d.showCustomer && r.customerName ? `for ${r.customerName}` : ""}
        </div>
      )}
    </>
  );

  const items = r.items.map((i, idx) =>
    t === "compact" ? (
      <div key={idx} className="flex justify-between gap-2"><span className="truncate">{i.name} x{i.qty}</span><span className="tabular-nums">{m(i.lineNet)}</span></div>
    ) : (
      <div key={idx} className={cn(t === "modern" && "py-1.5 border-b border-black/10 last:border-0")}>
        <Row left={<span className={t === "bold" ? "font-bold" : undefined}>{i.name}</span>} right={m(i.lineNet)} />
        {i.qty !== 1 && <div className="opacity-60 text-[0.88em]">{i.qty} × {m(i.unitPrice)}</div>}
      </div>
    )
  );

  const totals = (
    <div className="space-y-1">
      <Row left="Subtotal" right={m(r.subtotal)} muted />
      {r.discount > 0 && <Row left="Discount" right={`−${m(r.discount)}`} />}
      {r.vat > 0 && <Row left="VAT" right={m(r.vat)} muted />}
    </div>
  );

  const paid = d.showPayments && (
    <div className="space-y-0.5 opacity-80 text-[0.92em]">
      {r.payments.map((p, i) => <Row key={i} left={payLabel(p.method).toUpperCase()} right={m(p.amount)} />)}
      {!!r.change && r.change > 0 && (<><Row left="Cash in" right={m(r.tendered || 0)} /><Row left="Change" right={m(r.change)} strong /></>)}
    </div>
  );

  const rule = t === "compact" ? "border-t border-dashed border-black/50" : "border-t border-dashed border-black/25";

  return (
    <div
      className="bg-white text-black mx-auto shadow-e1 print:shadow-none"
      style={{ width: d.paperWidth === "58" ? "58mm" : "80mm", maxWidth: "100%", fontSize: base, lineHeight: 1.45, fontFamily: t === "compact" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit", ...ink }}
    >
      {/* Logo, above whichever header style is chosen */}
      {r.logoUrl && (
        <div className={cn("px-4 pt-4 flex", t === "modern" ? "justify-start" : "justify-center")}>
          <img src={r.logoUrl} alt="" className="max-h-14 max-w-[60%] object-contain" />
        </div>
      )}

      {/* Header */}
      {t === "bold" ? (
        <div className="px-4 py-4 text-center" style={{ background: "#000", color: "#fff", ...ink }}>
          <div className="font-black tracking-wide uppercase" style={{ fontSize: base * 1.45 }}>{r.businessName}</div>
          {d.headerNote && <div className="mt-1 opacity-85">{d.headerNote}</div>}
        </div>
      ) : t === "modern" ? (
        <div className="px-4 pt-4 pb-3 flex gap-3">
          <i className="w-1.5 rounded-full bg-black shrink-0" />
          <div className="min-w-0">
            <div className="font-extrabold leading-tight" style={{ fontSize: base * 1.45 }}>{r.businessName}</div>
            {d.headerNote && <div className="opacity-70 mt-0.5">{d.headerNote}</div>}
          </div>
        </div>
      ) : (
        <div className={cn("px-4 pt-4 text-center", t === "compact" && "pt-3")}>
          <div className={cn("font-semibold", t === "compact" && "font-bold uppercase")} style={{ fontSize: base * (t === "compact" ? 1.15 : 1.4) }}>{r.businessName}</div>
          {d.headerNote && <div className="opacity-70 mt-0.5">{d.headerNote}</div>}
        </div>
      )}

      <div className={cn("px-4 pb-3 pt-1 space-y-0.5", t !== "modern" && "text-center")}>
        {contact.map((c, i) => <div key={i} className="opacity-70">{c}</div>)}
        {d.taxId && <div className="opacity-70">Tax ID: {d.taxId}</div>}
        <div className="pt-1">{meta}</div>
      </div>

      {/* Lines */}
      <div className={cn("px-4 py-3 space-y-1.5", rule)}>{items}</div>

      {/* Totals */}
      <div className={cn("px-4 py-3 space-y-2", rule)}>
        {totals}
        {t === "bold" ? (
          <div className="flex justify-between items-center px-3 py-2.5 font-black" style={{ background: "#000", color: "#fff", fontSize: base * 1.3, ...ink }}>
            <span>TOTAL</span><span className="font-mono tabular-nums">{m(r.total)}</span>
          </div>
        ) : t === "modern" ? (
          <div className="flex justify-between items-center rounded-xl bg-black/[0.06] px-3 py-2.5 font-extrabold" style={{ fontSize: base * 1.25 }}>
            <span>Total</span><span className="font-mono tabular-nums">{m(r.total)}</span>
          </div>
        ) : (
          <Row left="Total" right={m(r.total)} strong />
        )}
        {paid}
      </div>

      {r.footer && <div className={cn("px-4 py-3 text-center opacity-75", rule)}>{r.footer}</div>}

      {/* A quiet credit line on every receipt, on every plan. */}
      <div className={cn("px-4 pt-1.5 pb-3 text-center opacity-50 tracking-wide", !r.footer && rule, !r.footer && "pt-2.5")} style={{ fontSize: Math.max(8, base * 0.72) }}>
        Powered by StarTrack
      </div>
    </div>
  );
}

/** A believable sale, for previewing a design without making one. */
export const SAMPLE_RECEIPT: ReceiptData = {
  saleNo: "S-000123", businessName: "Your Business", at: new Date().toISOString(), staffName: "Ada", customerName: "Tunde",
  items: [
    { name: "Jollof Rice", qty: 2, unitPrice: 2500, lineNet: 5000 },
    { name: "Chapman (500ml)", qty: 1, unitPrice: 1800, lineNet: 1800 },
    { name: "Puff Puff (10 pcs)", qty: 1, unitPrice: 1200, lineNet: 1200 },
  ],
  subtotal: 8000, discount: 500, vat: 0, total: 7500,
  payments: [{ method: "cash", amount: 8000 }], tendered: 8000, change: 500,
  footer: "Thank you for your patronage!", currency: "₦",
};
