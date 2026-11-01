import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { VoidSaleModal } from "@/components/sales/VoidSaleModal";
import { WhatsAppReceipt } from "@/components/receipt/WhatsAppReceipt";
import { ReceiptText, Download, Search, Ban } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Field";
import { Pager } from "@/components/ui/Pager";
import { Modal } from "@/components/ui/Modal";
import { Table, TR, TH, TD } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { downloadCsv } from "@/lib/csv";
import { ROWS_PER_PAGE } from "@/components/ui/Pager";
import { fmtDateTime, fmtMoney, todayStr } from "@/lib/format";
import { StatStrip } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";

type Sale = {
  id: string; saleNo: string; at: string; staffName: string; customerName: string;
  items: { name: string; qty: number; unitPrice: number; lineNet: number }[];
  subtotal: number; discount: number; vat: number; total: number;
  payments: { method: string; amount: number }[];
  status: string;
  channel?: "pos" | "online" | "import" | "invoice"; orderNo?: string | null; deliveryFee?: number;
  voidInfo?: { byName?: string; reason?: string; at?: string };
};
type Totals = {
  count: number; completed: number; voided: number;
  revenue: number; discount: number; vat: number;
  // Null when the filter is narrower than a date range — a refund can't be
  // attributed to one cashier or one receipt, so the server declines to guess.
  refunds: number | null; refundCount: number | null; net: number | null;
};

// Short pages on purpose — these are scanned, not read.
const PAGE_SIZE = ROWS_PER_PAGE;

export function Sales() {
  const { activeBranch } = useSession();
  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Sales History"
        subtitle={`${activeBranch?.name || ""} · every sale on record — voided ones stay, flagged`}
      />
      <SalesHistoryView />
    </div>
  );
}

// The archive itself — used by the Sales History page AND the dashboard's
// Archive tab, so both always show exactly the same truth.
export function SalesHistoryView() {
  const { activeBranch, currency, can } = useSession();
  const [searchParams] = useSearchParams();
  // Arriving from an upload ("View sales" on Import history) opens on exactly that file's records.
  const [batch, setBatch] = useState(() => (searchParams.get("batch") ? { id: searchParams.get("batch")!, name: searchParams.get("batchName") || "an uploaded file" } : null));
  const [from, setFrom] = useState(() => searchParams.get("from") || (searchParams.get("channel") === "import" ? "2000-01-01" : todayStr().slice(0, 8) + "01")); // this month
  const [to, setTo] = useState(() => searchParams.get("to") || todayStr());
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState(() => (searchParams.get("batch") ? "import" : searchParams.get("channel") || ""));
  const [saleNo, setSaleNo] = useState(searchParams.get("saleNo") || "");
  const [page, setPage] = useState(1);

  // The header's global search lands here with ?saleNo= — a receipt from any
  // date needs to surface, so widen the window past the "this month" default.
  useEffect(() => {
    const fromUrl = searchParams.get("saleNo");
    if (fromUrl) { setSaleNo(fromUrl); setFrom("2000-01-01"); setPage(1); }
  }, [searchParams]);
  const filters = `from=${from}&to=${to}${batch ? `&batchId=${batch.id}` : ""}${status ? `&status=${status}` : ""}${channel ? `&channel=${channel}` : ""}${saleNo ? `&saleNo=${encodeURIComponent(saleNo)}` : ""}`;
  const query = `/sales?${filters}&page=${page}&limit=${PAGE_SIZE}`;
  const { data, loading, reload } = useApi<{ sales: Sale[]; totals: Totals; page: number; pages: number }>(
    query,
    [activeBranch?.id]
  );
  const sales = data?.sales || [];
  const t = data?.totals;
  const pages = data?.pages || 1;
  const [selected, setSelected] = useState<Sale | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [exporting, setExporting] = useState(false);

  // Changing a filter must start again from the first page, or you land on
  // page 7 of a two-page result and see nothing.
  const setFilter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const csvRow = (s: Sale) => ({
    receipt: s.saleNo,
    datetime: fmtDateTime(s.at),
    staff: s.staffName,
    customer: s.customerName || "",
    items: s.items.map((i) => `${i.name} x${i.qty}`).join("; "),
    subtotal: s.subtotal,
    discount: s.discount,
    vat: s.vat,
    total: s.total,
    payment: s.payments.map((p) => `${p.method} ${p.amount}`).join(" + "),
    status: s.status,
  });

  // Export the whole filtered period, not just the page on screen — an export
  // that silently stopped at 50 rows would be worse than none.
  async function exportCsv() {
    setExporting(true);
    try {
      const all: Sale[] = [];
      for (let p = 1; p <= pages; p++) {
        const chunk = await api<{ sales: Sale[] }>(`/sales?${filters}&page=${p}&limit=${PAGE_SIZE}`);
        all.push(...chunk.sales);
      }
      downloadCsv(`sales-${from}-to-${to}.csv`, all.map(csvRow));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {/* Filters */}
      {batch && (
        <div className="mb-3 flex items-center gap-3 flex-wrap rounded-xl bg-primary-soft text-primary px-4 py-2.5 text-[13px] font-semibold" data-testid="batch-banner">
          <span className="min-w-0 flex-1">Showing the sales from <b>{batch.name}</b>, for every date and branch.</span>
          <button className="underline underline-offset-2 hover:no-underline" onClick={() => { setBatch(null); setChannel(""); setFrom(todayStr().slice(0, 8) + "01"); setTo(todayStr()); setPage(1); }}>Show all sales</button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Input type="date" value={from} onChange={(e) => setFilter(setFrom)(e.target.value)} className="!w-40" />
        <span className="text-t4 text-[12px]">to</span>
        <Input type="date" value={to} onChange={(e) => setFilter(setTo)(e.target.value)} className="!w-40" />
        <Select value={status} onChange={(e) => setFilter(setStatus)(e.target.value)} className="!w-36">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="voided">Voided</option>
        </Select>
        <Select value={channel} onChange={(e) => setFilter(setChannel)(e.target.value)} className="!w-36" aria-label="Where the sale was made">
          <option value="">All channels</option>
          <option value="pos">In person</option>
          <option value="online">Online</option>
          <option value="invoice">Invoices</option>
          <option value="import">Imported history</option>
        </Select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input value={saleNo} onChange={(e) => setFilter(setSaleNo)(e.target.value)} placeholder="Receipt no." className="!w-40 !pl-9" />
        </div>
        <Button variant="secondary" className="ml-auto" onClick={exportCsv} disabled={!sales.length || exporting}>
          <Download className="w-4 h-4" /> {exporting ? "Preparing…" : `Export CSV${t && t.count > sales.length ? ` (${t.count})` : ""}`}
        </Button>
      </div>

      {/* Totals: one strip, so the period reads as a single summary. */}
      {t && (
        <StatStrip
          className="mb-4"
          cells={[
            { label: "Sales", value: String(t.completed) },
            { label: "Voided", value: String(t.voided), tone: t.voided > 0 ? "warning" : undefined },
            { label: "Revenue", value: fmtMoney(t.revenue, currency), hint: "Completed sales, before refunds" },
            ...(t.refunds !== null
              ? [{
                  label: `Refunds${t.refundCount ? ` · ${t.refundCount}` : ""}`,
                  value: t.refunds > 0 ? `−${fmtMoney(t.refunds, currency)}` : fmtMoney(0, currency),
                  tone: t.refunds > 0 ? ("danger" as const) : undefined,
                }]
              : []),
            // The figure the dashboard reports, shown here so the two agree.
            ...(t.net !== null
              ? [{ label: "Net taken", value: fmtMoney(t.net, currency), strong: true, hint: "Revenue less refunds — matches the dashboard" }]
              : []),
            { label: "VAT", value: fmtMoney(t.vat, currency) },
            { label: "Avg sale", value: t.completed > 0 ? fmtMoney(t.revenue / t.completed, currency) : "—" },
          ]}
        />
      )}

      {loading ? (
        <Spinner />
      ) : sales.length === 0 ? (
        <Card>
          <EmptyState icon={ReceiptText} title="No sales in this period" body="Adjust the date range, or make some sales on the POS." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <thead>
                <tr className="text-left">
                  {["Receipt", "Items", "Staff", "Customer", "Method", "Status", "Total"].map((h, i) => (
                    <TH key={h} className={cn(i === 6 && "text-right")}>{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <TR
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={cn("cursor-pointer", s.status === "voided" && "opacity-50")}
                  >
                    <TD>
                      <div className="font-mono text-[12px] font-semibold text-primary flex items-center gap-1.5">{s.saleNo}{s.channel === "online" && <Badge tone="brand">online</Badge>}{s.channel === "import" && <Badge tone="neutral">imported</Badge>}{s.channel === "invoice" && <Badge tone="warning">invoice</Badge>}</div>
                      <div className="text-[11px] text-t4">{fmtDateTime(s.at)}</div>
                    </TD>
                    <TD className="!text-t2 max-w-[220px] truncate">
                      {s.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}
                    </TD>
                    <TD className="!text-[12px] !text-t2">{s.staffName}</TD>
                    <TD className="!text-[12px] !text-t3">{s.customerName || "—"}</TD>
                    <TD>
                      <Badge tone={s.payments[0]?.method === "cash" ? "success" : s.payments[0]?.method === "pos" ? "brand" : "warning"}>
                        {s.payments.map((p) => p.method).join("+")}
                      </Badge>
                    </TD>
                    <TD>
                      {s.status === "voided" ? <Badge tone="danger">voided</Badge> : <Badge tone="success">completed</Badge>}
                    </TD>
                    <TD className="text-right font-mono font-semibold tabular-nums">{fmtMoney(s.total, currency)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>

          {/* The totals bar above always covers the WHOLE period, not this page, so paging never changes the figures being read. */}
          <Pager page={page} pages={pages} total={t?.count ?? 0} from={(page - 1) * PAGE_SIZE + 1} to={(page - 1) * PAGE_SIZE + sales.length} onPage={setPage} noun="sales" />
        </Card>
      )}

      <SaleDetail
        sale={selected}
        currency={currency}
        canVoid={can("void_sales")}
        onClose={() => setSelected(null)}
        onVoid={(s) => { setSelected(null); setVoiding(s); }}
      />
      <VoidSaleModal sale={voiding} currency={currency} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); reload(); }} />
    </div>
  );
}

function SaleDetail({ sale, currency, canVoid, onClose, onVoid }: {
  sale: Sale | null; currency: string; canVoid: boolean; onClose: () => void; onVoid: (s: Sale) => void;
}) {
  if (!sale) return null;
  return (
    <Modal open={!!sale} onClose={onClose} title={`${sale.saleNo}`} subtitle={`${fmtDateTime(sale.at)} · by ${sale.staffName}${sale.customerName ? ` · for ${sale.customerName}` : ""}`}>
      {sale.status === "voided" && (
        <div className="px-3 py-2.5 mb-3 rounded-ctl bg-danger-soft text-danger text-[12px] font-semibold">
          Voided by {sale.voidInfo?.byName}{sale.voidInfo?.reason ? ` — "${sale.voidInfo.reason}"` : ""}
        </div>
      )}
      <div className="space-y-1.5">
        {sale.items.map((i, idx) => (
          <div key={idx} className="flex justify-between text-[13px]">
            <span className="text-t2">{i.name} ×{i.qty}</span>
            <span className="font-mono text-t1 tabular-nums">{fmtMoney(i.lineNet, currency)}</span>
          </div>
        ))}
        <div className="pt-2 mt-2 border-t border-line space-y-1">
          <div className="flex justify-between text-[12px] text-t2"><span>Subtotal</span><span className="font-mono">{fmtMoney(sale.subtotal, currency)}</span></div>
          {sale.discount > 0 && <div className="flex justify-between text-[12px] text-danger"><span>Discount</span><span className="font-mono">−{fmtMoney(sale.discount, currency)}</span></div>}
          {sale.vat > 0 && <div className="flex justify-between text-[12px] text-t2"><span>VAT</span><span className="font-mono">{fmtMoney(sale.vat, currency)}</span></div>}
          <div className="flex justify-between text-[15px] font-semibold text-t1 pt-1"><span>Total</span><span className="font-mono">{fmtMoney(sale.total, currency)}</span></div>
          <div className="text-[11px] text-t3">Paid via {sale.payments.map((p) => `${p.method.toUpperCase()} ${fmtMoney(p.amount, currency)}`).join(" + ")}</div>
        </div>
      </div>
      <WhatsAppReceipt saleId={sale.id} className="mt-4" />
      {canVoid && sale.status === "completed" && (
        <Button variant="danger" className="w-full mt-4" onClick={() => onVoid(sale)}>
          <Ban className="w-4 h-4" /> Void this sale
        </Button>
      )}
    </Modal>
  );
}
