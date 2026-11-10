import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Download, Eye, FileSpreadsheet, History, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { SpreadsheetImport } from "@/components/import/SpreadsheetImport";
import { api, downloadFile } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDate } from "@/lib/format";

type Batch = { id: string; fileName: string; status: "active" | "undone"; sales: number; revenue: number; from: string; to: string; newCustomers: number; newProducts: number; createdBy: string; createdAt: string; undoneAt: string | null };

/** The Sales history page, opened on exactly this upload's records. */
const salesLink = (id: string, fileName: string, from: string, to: string) => `/app/sales?batch=${id}&batchName=${encodeURIComponent(fileName)}&from=${from}&to=${to}`;

const day = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "");

export function ImportHistory() {
  const { currency } = useSession();
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data, loading, reload } = useApi<{ batches: Batch[] }>("/history-import/batches", []);
  const money = (n: number) => fmtMoney(n, currency);

  async function undo() {
    if (!undoing) return;
    setBusy(true); setError("");
    try { await api(`/history-import/batches/${undoing.id}/undo`, { method: "POST" }); setUndoing(null); reload(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[960px] mx-auto space-y-5">
      <PageHeader
        title="Import past sales"
        subtitle="Bring in your sales from before StarTrack, so your reports and customer book start with your real history"
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadFile("/history-import/template.csv", "past-sales-template.csv").catch((e) => setError(e.message))}><Download className="w-4 h-4" /> Template</Button>
            <Button onClick={() => setOpen(true)}><Upload className="w-4 h-4" /> Upload a file</Button>
          </>
        }
      />
      <ErrorBanner message={error} />

      <Panel title="How it works" subtitle="Excel or CSV, one row per item sold" icon={FileSpreadsheet} tone="brand">
        <ol className="space-y-2.5 text-[13px] text-t2">
          {[
            ["Get your file ready", "Columns for the date, item, quantity and price (or the line total). Customer, phone, receipt number and payment method are optional but make the history richer."],
            ["Upload it and check the preview", "You'll see how many sales were found, the date range, the revenue, and any rows that couldn't be used. Nothing is saved yet."],
            ["Save it", "The sales appear in your reports and Sales history, marked “imported”. Customers are added to your customer book."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3"><span className="grid place-items-center w-6 h-6 rounded-full bg-primary-soft text-primary text-[12px] font-bold shrink-0">{i + 1}</span><div><b className="text-t1">{t}.</b> {d}</div></li>
          ))}
        </ol>
        <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] text-t3">
          <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> Today's stock is never changed. These sales are history.</li>
          <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> Rows with the same receipt number become one sale.</li>
          <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> Dates are read day-first: 05/03/2025 is 5 March.</li>
          <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> Upload the same file twice and it's only recorded once.</li>
          <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> Profit uses your product costs, or a cost column if you have one.</li>
          <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> Made a mistake? Undo the whole upload below.</li>
        </ul>
      </Panel>

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line text-[14px] font-semibold text-t1 flex items-center gap-2"><History className="w-4 h-4 text-t3" /> Your uploads</div>
        {loading && !data ? <div className="py-10"><Spinner /></div> : !data || !data.batches.length ? (
          <div className="py-10 text-center text-[13px] text-t3">Nothing uploaded yet.</div>
        ) : (
          <div className="divide-y divide-line">
            {data.batches.map((b) => (
              <div key={b.id} className="flex items-center gap-3.5 px-5 py-3.5">
                <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary-soft text-primary shrink-0"><FileSpreadsheet className="w-[18px] h-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap"><span className="text-[13.5px] font-semibold text-t1 truncate">{b.fileName}</span>{b.status === "undone" ? <Badge tone="neutral">undone</Badge> : <Badge tone="success">in your books</Badge>}</div>
                  <div className="text-[12px] text-t3">{b.sales.toLocaleString()} sales · {money(b.revenue)} · {day(b.from)}{b.to !== b.from ? ` – ${day(b.to)}` : ""}</div>
                  <div className="text-[11.5px] text-t4">Uploaded {fmtDate(b.createdAt)} by {b.createdBy}{b.newCustomers ? ` · ${b.newCustomers} new customers` : ""}{b.newProducts ? ` · ${b.newProducts} items added to history` : ""}</div>
                </div>
                {b.status === "active" && <Link to={salesLink(b.id, b.fileName, b.from, b.to)} className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line-2 bg-surface text-[12.5px] font-semibold text-t1 hover:border-primary hover:text-primary"><Eye className="w-3.5 h-3.5" /> View sales</Link>}
                {b.status === "active" && <Button variant="ghost" size="sm" onClick={() => setUndoing(b)}><RotateCcw className="w-3.5 h-3.5" /> Undo</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
      <p className="text-[12px] text-t4 text-center">Every upload above has a <b>View sales</b> button. You can also find them in <Link to="/app/sales?channel=import" className="text-primary font-semibold hover:underline">Sales history</Link> under “Imported history”.</p>

      <SpreadsheetImport
        open={open} onClose={() => setOpen(false)} onDone={reload}
        title="Upload past sales" subtitle="Check the preview, then save. Today's stock isn't touched."
        endpoint="/history-import/sales"
        template={{ label: "Download an example file", href: "/history-import/template.csv", fileName: "past-sales-template.csv" }}
        fields={[
          { key: "date", label: "Date", required: true }, { key: "item", label: "Item sold", required: true }, { key: "qty", label: "Quantity", required: true },
          { key: "price", label: "Unit price" }, { key: "total", label: "Line total" }, { key: "receipt", label: "Receipt / invoice no." },
          { key: "customer", label: "Customer name" }, { key: "phone", label: "Customer phone" }, { key: "payment", label: "Payment method" }, { key: "cost", label: "Unit cost" },
        ]}
        tiles={(r) => [
          { label: "Sales found", value: r.totals.sales ?? 0, tone: "good" },
          { label: "Revenue", value: money(r.revenue ?? 0), tone: "good" },
          { label: "Dates", value: r.from ? `${day(r.from)}${r.to !== r.from ? ` – ${day(r.to)}` : ""}` : "—" },
          { label: "New customers", value: r.totals.newCustomers ?? 0 },
          { label: "Already uploaded", value: r.totals.duplicate ?? 0 },
          { label: "Rows skipped", value: r.totals.invalid ?? 0, tone: r.totals.invalid ? "warn" : undefined },
          { label: "Items not in catalog", value: r.totals.newProducts ?? 0 },
          { label: "Not added to customers", value: r.totals.noCustomerSaved ?? 0, tone: r.totals.noCustomerSaved ? "warn" : undefined },
        ]}
        columns={[{ label: "Date", cell: (s) => day(s.date) }, { label: "Items", cell: (s) => <span className="truncate block max-w-[260px]">{s.items}</span> }, { label: "Customer", cell: (s) => s.customer || "—" }, { label: "Total", cell: (s) => money(s.total), align: "right" }]}
        saveLabel={(r) => `Save ${(r.totals.sales ?? 0).toLocaleString()} sale${r.totals.sales === 1 ? "" : "s"}`}
        done={(r) => <>{(r.created ?? 0).toLocaleString()} sale{r.created === 1 ? "" : "s"} added to your history ({money(r.revenue ?? 0)}).{r.batchId && <> <Link to={salesLink(r.batchId, r.fileName || "your upload", r.from, r.to)} className="text-primary underline underline-offset-2">View these sales</Link></>}</>}
      />

      <Modal open={!!undoing} onClose={() => setUndoing(null)} title="Undo this upload?" subtitle={undoing ? `${undoing.fileName} · ${undoing.sales} sales` : ""}>
        <div className="space-y-3">
          <p className="text-[13px] text-t2">All {undoing?.sales.toLocaleString()} sales from this file will be removed from your sales history, reports and customer totals, along with the customers and history-only items it created. Your other sales and your stock aren't affected.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setUndoing(null)}>Keep it</Button><Button variant="danger" onClick={undo} disabled={busy}>{busy ? "Undoing…" : "Yes, undo it"}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
