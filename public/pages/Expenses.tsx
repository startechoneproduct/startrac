import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReceiptText, Plus, Trash2, Pencil, Paperclip, Repeat, FileDown, FileSpreadsheet, Search, CalendarClock,
  ChevronLeft, ChevronRight, Pause, Play, X, Wallet, Tag,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { Segmented } from "@/components/ui/Segmented";
import { LockChip, requestUpgrade } from "@/components/plan/PlanUi";
import { api, apiDownload, openFile } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDate, fmtDateTime, fmtMoney, todayStr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Method = "cash" | "transfer" | "pos" | "card" | "cheque" | "other";
type Attachment = { id: string; name: string; mime: string; size: number };
type Expense = {
  id: string; type: string; amount: number; notes: string; paidBy: string; paymentMethod: Method; reference: string;
  attachments: Attachment[]; recurringId: string | null; actorName: string; editedAt: string | null; editedBy: string; at: string;
};
type ListData = {
  expenses: Expense[]; total: number; count: number;
  byType: { type: string; amount: number; count: number }[];
  byMethod: { method: Method; amount: number; count: number }[];
};
type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
type Recurring = { id: string; type: string; amount: number; notes: string; paidBy: string; paymentMethod: Method; frequency: Frequency; nextDue: string; active: boolean; due: boolean };

const QUICK_TYPES = ["Rent", "Salaries", "Fuel", "Electricity", "Transport", "Internet", "Supplies", "Repairs"];
const METHOD_LABEL: Record<Method, string> = { cash: "Cash", transfer: "Bank transfer", pos: "POS", card: "Card", cheque: "Cheque", other: "Other" };
const FREQ_LABEL: Record<Frequency, string> = { weekly: "Every week", monthly: "Every month", quarterly: "Every 3 months", yearly: "Every year" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Range = "month" | "lastMonth" | "year" | "custom";
const RANGES = [["month", "This month"], ["lastMonth", "Last month"], ["year", "This year"], ["custom", "Custom"]] as const;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangeDates(r: Range): [string, string] {
  const now = new Date();
  if (r === "lastMonth") return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (r === "year") return [`${now.getFullYear()}-01-01`, todayStr()];
  return [todayStr().slice(0, 8) + "01", todayStr()];
}
/** The next date a schedule falls on after `day` (same rule as the server). */
function nextAfter(day: string, f: Frequency) {
  const [y, m, d] = day.split("-").map(Number);
  if (f === "weekly") return ymd(new Date(y, m - 1, d + 7));
  const add = f === "yearly" ? 12 : f === "quarterly" ? 3 : 1;
  const t = new Date(y, m - 1 + add, 1);
  t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return ymd(t);
}
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Expenses() {
  const { activeBranch, currency, can, hasFeature } = useSession();
  const money = (n: number) => fmtMoney(n, currency);
  const [view, setView] = useState<"entries" | "months" | "recurring">("entries");

  // Filters
  const [range, setRange] = useState<Range>("month");
  const [custom, setCustom] = useState<[string, string]>(rangeDates("month"));
  const [from, to] = range === "custom" ? custom : rangeDates(range);
  const [type, setType] = useState("");
  const [method, setMethod] = useState<"" | Method>("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 300); return () => clearTimeout(t); }, [qInput]);

  const qs = new URLSearchParams({ from, to, ...(type ? { type } : {}), ...(method ? { method } : {}), ...(q ? { q } : {}) }).toString();
  const { data, loading, error, reload } = useApi<ListData>(`/expenses?${qs}`, [activeBranch?.id, qs]);
  const { data: typeData } = useApi<{ types: string[] }>("/expenses/types", [activeBranch?.id]);
  const { data: recData, reload: reloadRec } = useApi<{ recurring: Recurring[] }>("/expenses/recurring", [activeBranch?.id]);
  const types = typeData?.types || [];
  const recurring = recData?.recurring || [];
  const due = recurring.filter((r) => r.due);

  const paged = usePaged(data?.expenses || []);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [recordFor, setRecordFor] = useState<Recurring | null>(null);
  const [recEditing, setRecEditing] = useState<Recurring | "new" | null>(null);
  const [exportError, setExportError] = useState("");
  const refresh = () => { reload(); reloadRec(); };

  async function remove(e: Expense) {
    if (!confirm(`Delete this ${e.type} expense of ${money(e.amount)}? The day's figures will be corrected.`)) return;
    await api(`/expenses/${e.id}`, { method: "DELETE" });
    reload();
  }

  async function exportAs(format: "pdf" | "xlsx") {
    if (!hasFeature("reports")) { requestUpgrade("reports"); return; }
    setExportError("");
    const p = new URLSearchParams({ format, from, to, ...(type ? { type } : {}), ...(method ? { method } : {}) });
    try { await apiDownload(`/reports/expenses?${p}`, `expenses.${format}`); } catch (err: any) { setExportError(err.message); }
  }

  const filtered = !!(type || method || q);
  const biggest = data?.byType[0];

  return (
    <div className="p-6 lg:p-8 max-w-[1150px] mx-auto">
      <PageHeader
        title="Expenses"
        subtitle={`${activeBranch?.name || ""} · what you spend comes off your profit`}
        actions={
          <>
            <Button variant="secondary" onClick={() => exportAs("pdf")}><FileDown className="w-4 h-4" /> PDF <LockChip feature="reports" /></Button>
            <Button variant="secondary" onClick={() => exportAs("xlsx")}><FileSpreadsheet className="w-4 h-4" /> Excel <LockChip feature="reports" /></Button>
            <Button onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Record expense</Button>
          </>
        }
      />
      <ErrorBanner message={exportError} />

      {due.length > 0 && (
        <Card className="mb-5 p-4 border-warning/40 bg-warning-soft">
          <div className="flex items-center gap-2 mb-2 text-[13px] font-bold text-t1">
            <CalendarClock className="w-4 h-4 text-warning" /> {due.length === 1 ? "1 recurring expense is due" : `${due.length} recurring expenses are due`}
          </div>
          <div className="divide-y divide-line/70">
            {due.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-semibold text-t1">{r.type}</span>
                  <span className="text-[12px] text-t3"> · due {fmtDate(r.nextDue)} · {FREQ_LABEL[r.frequency].toLowerCase()}</span>
                </div>
                <span className="font-mono text-[13px] font-semibold text-t1">{money(r.amount)}</span>
                <Button size="sm" onClick={() => setRecordFor(r)}>Record</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-5">
        <Segmented options={[["entries", "Entries"], ["months", "By month"], ["recurring", `Recurring${recurring.length ? ` (${recurring.length})` : ""}`]] as const} value={view} onChange={setView} />
      </div>

      {view === "entries" && (
        <>
          {/* Filters, all in one row */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Segmented options={RANGES} value={range} onChange={(r) => { if (r === "custom") setCustom([from, to]); setRange(r); }} />
            {range === "custom" && (
              <>
                <Input type="date" aria-label="From" value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} className="!w-40" />
                <span className="text-t4 text-[12px]">to</span>
                <Input type="date" aria-label="To" value={custom[1]} min={custom[0]} max={todayStr()} onChange={(e) => setCustom([custom[0], e.target.value])} className="!w-40" />
              </>
            )}
            <Select aria-label="Category" value={type} onChange={(e) => setType(e.target.value)} className="!w-44">
              <option value="">All categories</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as Method | "")} className="!w-40">
              <option value="">Any payment</option>
              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </Select>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 text-t4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input aria-label="Search expenses" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search description, receipt no., who paid" className="!pl-9" />
            </div>
            {filtered && <Button variant="ghost" size="sm" onClick={() => { setType(""); setMethod(""); setQInput(""); }}><X className="w-3.5 h-3.5" /> Clear</Button>}
          </div>

          {error ? <Card><EmptyState icon={ReceiptText} title="Couldn't load expenses" body={error} /></Card> : loading || !data ? <Spinner /> : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
                <StatCard tone="danger" label="Spent" value={money(data.total)} icon={Wallet} hint={`${fmtDate(from)} to ${fmtDate(to)}`} />
                <StatCard tone="neutral" label="Entries" value={String(data.count)} icon={ReceiptText} hint={filtered ? "matching your filters" : "in this period"} />
                <StatCard tone="warning" label={biggest ? `Biggest: ${biggest.type}` : "Biggest category"} value={biggest ? money(biggest.amount) : "None yet"} icon={Tag}
                  hint={biggest && data.total ? `${Math.round((biggest.amount / data.total) * 100)}% of spending` : undefined} />
              </div>

              {data.count === 0 ? (
                <Card>
                  <EmptyState
                    icon={ReceiptText}
                    title={filtered ? "No expenses match" : "No expenses in this period"}
                    body={filtered ? "Try another category, payment method or search." : "Rent, fuel, salaries: record them here and your profit stays honest."}
                    action={!filtered ? <Button onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Record an expense</Button> : undefined}
                  />
                </Card>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                  <Card className="overflow-hidden xl:col-span-2 self-start">
                    <div className="divide-y divide-line">
                      {paged.rows.map((e) => (
                        <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-9 h-9 rounded-lg bg-danger-soft text-danger flex items-center justify-center shrink-0">
                            {e.recurringId ? <Repeat className="w-4 h-4" /> : <ReceiptText className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-t1">{e.type}</span>
                              <Badge tone="neutral">{METHOD_LABEL[e.paymentMethod]}</Badge>
                              {e.reference && <span className="text-[11.5px] font-mono text-t3">#{e.reference}</span>}
                              {e.attachments.length > 0 && (
                                <button onClick={() => openFile(`/expenses/${e.id}/attachments/${e.attachments[0].id}`)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline" title="Open the attached receipt">
                                  <Paperclip className="w-3.5 h-3.5" /> {e.attachments.length}
                                </button>
                              )}
                            </div>
                            <div className="text-[11.5px] text-t3 truncate">
                              {e.notes && `${e.notes} · `}{e.paidBy && `paid by ${e.paidBy} · `}{fmtDate(e.at)} · {e.actorName}
                              {e.editedAt && <span title={`Edited ${fmtDateTime(e.editedAt)}`}> · edited by {e.editedBy}</span>}
                            </div>
                          </div>
                          <span className="font-mono text-[14px] font-semibold text-t1 tabular-nums shrink-0">{money(e.amount)}</span>
                          <div className="flex items-center shrink-0">
                            {can("expenses_edit") && (
                              <button onClick={() => setEditing(e)} aria-label={`Edit ${e.type} expense`} className="p-1.5 rounded-lg text-t4 hover:text-primary hover:bg-primary-soft transition-colors">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {can("expenses_delete") && (
                              <button onClick={() => remove(e)} aria-label={`Delete ${e.type} expense`} className="p-1.5 rounded-lg text-t4 hover:text-danger hover:bg-danger-soft transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Pager {...paged} onPage={paged.setPage} noun="expenses" />
                  </Card>

                  <div className="space-y-5">
                    <Panel icon={Tag} tone="danger" title="By category">
                      <Shares rows={data.byType.map((t) => ({ label: t.type, value: t.amount, sub: `${t.count} ${t.count === 1 ? "entry" : "entries"}`, onClick: () => setType(t.type) }))} total={data.total} money={money} />
                    </Panel>
                    <Panel icon={Wallet} title="By payment method">
                      <Shares rows={data.byMethod.map((m) => ({ label: METHOD_LABEL[m.method] || m.method, value: m.amount, sub: `${m.count} ${m.count === 1 ? "entry" : "entries"}`, onClick: () => setMethod(m.method) }))} total={data.total} money={money} />
                    </Panel>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === "months" && <MonthlyView money={money} branchKey={activeBranch?.id} />}

      {view === "recurring" && (
        <RecurringView
          rows={recurring} money={money}
          onAdd={() => setRecEditing("new")} onEdit={(r) => setRecEditing(r)} onRecord={(r) => setRecordFor(r)} onChanged={refresh}
        />
      )}

      {editing && (
        <ExpenseModal
          key={editing === "new" ? "new" : editing.id}
          expense={editing === "new" ? null : editing}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {recordFor && <RecordDue rec={recordFor} money={money} onClose={() => setRecordFor(null)} onSaved={() => { setRecordFor(null); refresh(); }} />}
      {recEditing && (
        <RecurringModal key={recEditing === "new" ? "new" : recEditing.id} rec={recEditing === "new" ? null : recEditing} types={types}
          onClose={() => setRecEditing(null)} onSaved={() => { setRecEditing(null); reloadRec(); }} />
      )}
    </div>
  );
}

/** A ranked list with a share bar; clicking a row filters the list to it. */
function Shares({ rows, total, money }: { rows: { label: string; value: number; sub: string; onClick: () => void }[]; total: number; money: (n: number) => string }) {
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-t3">Nothing yet.</div>;
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.label}>
          <button onClick={r.onClick} className="w-full text-left group" title={`Show only ${r.label}`}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-t1 truncate group-hover:text-primary">{r.label}</div>
                <div className="text-[11.5px] text-t3">{r.sub} · {total ? Math.round((r.value / total) * 100) : 0}%</div>
              </div>
              <div className="font-mono text-[13px] font-bold text-t1 shrink-0">{money(r.value)}</div>
            </div>
            <div className="mt-1.5 h-[6px] rounded-full bg-surface-3 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(3, total ? (r.value / total) * 100 : 0)}%`, background: "var(--st-gradient-primary)" }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── By month ─────────────────────────────────────────────────

function MonthlyView({ money, branchKey }: { money: (n: number) => string; branchKey?: string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, loading } = useApi<{ year: number; total: number; months: { month: number; amount: number; count: number }[]; byType: { type: string; amount: number }[] }>(`/expenses/summary?year=${year}`, [branchKey, year]);
  const max = Math.max(1, ...(data?.months.map((m) => m.amount) || [0]));
  const nowMonth = new Date().getMonth() + 1;
  const counted = data ? data.months.filter((m) => year < thisYear || m.month <= nowMonth).length : 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year"><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-[15px] font-bold text-t1 w-14 text-center">{year}</span>
        <Button variant="secondary" size="sm" onClick={() => setYear((y) => y + 1)} disabled={year >= thisYear} aria-label="Next year"><ChevronRight className="w-4 h-4" /></Button>
      </div>
      {loading || !data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <StatCard tone="danger" label={`Spent in ${year}`} value={money(data.total)} icon={Wallet} />
            <StatCard tone="neutral" label="Monthly average" value={money(data.total / Math.max(1, counted))} icon={CalendarClock} hint={`over ${counted} ${counted === 1 ? "month" : "months"}`} />
            <StatCard tone="warning" label={data.byType[0] ? `Biggest: ${data.byType[0].type}` : "Biggest category"} value={data.byType[0] ? money(data.byType[0].amount) : "None yet"} icon={Tag} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card className="xl:col-span-2 overflow-hidden">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Expenses by month in {year}</caption>
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-[0.06em] text-t3 border-b border-line">
                    <th className="px-4 py-2.5 font-semibold">Month</th>
                    <th className="px-4 py-2.5 font-semibold w-1/2"><span className="sr-only">Share</span></th>
                    <th className="px-4 py-2.5 font-semibold text-right">Entries</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.months.map((m) => (
                    <tr key={m.month} className={cn(year === thisYear && m.month > nowMonth && "opacity-40")}>
                      <td className="px-4 py-2.5 font-semibold text-t1">{MONTHS[m.month - 1]}</td>
                      <td className="px-4 py-2.5">
                        <div className="h-[6px] rounded-full bg-surface-3 overflow-hidden">
                          {m.amount > 0 && <div className="h-full rounded-full" style={{ width: `${Math.max(3, (m.amount / max) * 100)}%`, background: "var(--st-gradient-primary)" }} />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-t2">{m.count}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-t1">{money(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-2 font-bold">
                    <td className="px-4 py-3 text-t1" colSpan={3}>Total for {year}</td>
                    <td className="px-4 py-3 text-right font-mono text-t1">{money(data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </Card>
            <Panel icon={Tag} tone="danger" title={`By category in ${year}`}>
              {data.byType.length === 0 ? <div className="py-6 text-center text-[12.5px] text-t3">Nothing recorded in {year}.</div> : (
                <ul className="divide-y divide-line">
                  {data.byType.map((t) => (
                    <li key={t.type} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                      <span className="text-t1 truncate">{t.type}</span>
                      <span className="font-mono font-semibold text-t1 shrink-0">{money(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

// ── Recurring ────────────────────────────────────────────────

function RecurringView({ rows, money, onAdd, onEdit, onRecord, onChanged }: {
  rows: Recurring[]; money: (n: number) => string;
  onAdd: () => void; onEdit: (r: Recurring) => void; onRecord: (r: Recurring) => void; onChanged: () => void;
}) {
  const { can } = useSession();
  async function toggle(r: Recurring) {
    await api(`/expenses/recurring/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: !r.active }) });
    onChanged();
  }
  async function remove(r: Recurring) {
    if (!confirm(`Stop the recurring ${r.type} expense? Expenses already recorded stay.`)) return;
    await api(`/expenses/recurring/${r.id}`, { method: "DELETE" });
    onChanged();
  }
  const monthly = rows.filter((r) => r.active).reduce((s, r) => s + r.amount * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.frequency]), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[13px] text-t2 flex-1 min-w-[240px]">
          Costs that come round on a schedule, like rent and salaries. When one is due it shows at the top of this page for you to confirm, so nothing is recorded without you.
        </p>
        <Button onClick={onAdd}><Plus className="w-4 h-4" /> Add recurring expense</Button>
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState icon={Repeat} title="No recurring expenses yet" body="Add rent, salaries or subscriptions once, and get reminded each time they're due." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line text-[12.5px] text-t3">
            About <span className="font-mono font-semibold text-t1">{money(monthly)}</span> a month in active recurring costs
          </div>
          <div className="divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className={cn("flex items-center gap-3 px-4 py-3 flex-wrap", !r.active && "opacity-60")}>
                <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0"><Repeat className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-t1">{r.type}</span>
                    <Badge tone="neutral">{FREQ_LABEL[r.frequency]}</Badge>
                    {r.due && <Badge tone="warning">due</Badge>}
                    {!r.active && <Badge tone="neutral">paused</Badge>}
                  </div>
                  <div className="text-[11.5px] text-t3">{r.active ? `Next due ${fmtDate(r.nextDue)}` : "Paused"} · {METHOD_LABEL[r.paymentMethod]}{r.notes ? ` · ${r.notes}` : ""}</div>
                </div>
                <span className="font-mono text-[14px] font-semibold text-t1 shrink-0">{money(r.amount)}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {r.active && <Button size="sm" variant="secondary" onClick={() => onRecord(r)}>Record now</Button>}
                  {can("expenses_edit") && <>
                    <button onClick={() => onEdit(r)} aria-label={`Edit recurring ${r.type}`} className="p-1.5 rounded-lg text-t4 hover:text-primary hover:bg-primary-soft"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => toggle(r)} aria-label={r.active ? `Pause ${r.type}` : `Resume ${r.type}`} title={r.active ? "Pause" : "Resume"} className="p-1.5 rounded-lg text-t4 hover:text-primary hover:bg-primary-soft">{r.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
                  </>}
                  {can("expenses_delete") && <button onClick={() => remove(r)} aria-label={`Stop recurring ${r.type}`} className="p-1.5 rounded-lg text-t4 hover:text-danger hover:bg-danger-soft"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Modals ───────────────────────────────────────────────────

function CategoryField({ value, onChange, types }: { value: string; onChange: (v: string) => void; types: string[] }) {
  const chips = useMemo(() => [...new Set([...QUICK_TYPES, ...types])].slice(0, 12), [types]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((t) => (
          <button key={t} type="button" onClick={() => onChange(t)}
            className={cn("px-2.5 h-7 rounded-full text-[11.5px] font-semibold border transition-colors", value === t ? "bg-primary-soft border-brand-400 text-primary" : "bg-surface-2 border-line-2 text-t3 hover:text-t1")}>
            {t}
          </button>
        ))}
      </div>
      <Field label="Category">
        <Input required list="expense-categories" value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Rent" maxLength={60} />
      </Field>
      <datalist id="expense-categories">{types.map((t) => <option key={t} value={t} />)}</datalist>
    </div>
  );
}

function ExpenseModal({ expense, types, onClose, onSaved }: { expense: Expense | null; types: string[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!expense;
  const [form, setForm] = useState({
    type: expense?.type || "", amount: expense ? String(expense.amount) : "", date: expense ? todayStrOf(expense.at) : todayStr(),
    paymentMethod: (expense?.paymentMethod || "cash") as Method, paidBy: expense?.paidBy || "", reference: expense?.reference || "", notes: expense?.notes || "",
  });
  const [repeat, setRepeat] = useState<"" | Frequency>("");
  const [files, setFiles] = useState<File[]>([]);
  const [existing, setExisting] = useState<Attachment[]>(expense?.attachments || []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const room = 3 - existing.length - files.length;

  function pick(list: FileList | null) {
    if (!list) return;
    const ok = [...list].filter((f) => /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(f.type));
    if (ok.length < list.length) setError("Only photos (JPG, PNG, WEBP) and PDFs can be attached.");
    const big = ok.filter((f) => f.size > 3 * 1024 * 1024);
    if (big.length) setError(`${big[0].name} is over 3 MB.`);
    setFiles((cur) => [...cur, ...ok.filter((f) => f.size <= 3 * 1024 * 1024)].slice(0, 3 - existing.length));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeExisting(a: Attachment) {
    if (!confirm(`Remove ${a.name}?`)) return;
    try {
      await api(`/expenses/${expense!.id}/attachments/${a.id}`, { method: "DELETE" });
      setExisting((x) => x.filter((y) => y.id !== a.id));
    } catch (err: any) { setError(err.message); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body = { ...form, amount: Number(form.amount) || 0 };
      const res = editing
        ? await api<{ expense: Expense }>(`/expenses/${expense!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<{ expense: Expense }>("/expenses", { method: "POST", body: JSON.stringify(body) });
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f, f.name);
        await api(`/expenses/${res.expense.id}/attachments`, { method: "POST", body: fd });
      }
      if (!editing && repeat) {
        await api("/expenses/recurring", {
          method: "POST",
          body: JSON.stringify({ type: form.type, amount: body.amount, notes: form.notes, paidBy: form.paidBy, paymentMethod: form.paymentMethod, frequency: repeat, nextDue: nextAfter(form.date, repeat) }),
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${expense!.type} expense` : "Record an expense"} subtitle={editing ? "The day's figures are corrected, and the change is recorded in the audit log" : "It comes off your profit for the day you choose"} wide>
      <form onSubmit={save} className="space-y-4">
        <ErrorBanner message={error} />
        <CategoryField value={form.type} onChange={(v) => set({ type: v })} types={types} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Amount"><Input required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
          <Field label="Date paid"><Input required type="date" max={todayStr()} value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Paid with">
            <Select value={form.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as Method })}>
              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Paid by" hint="Who paid it out (optional)"><Input value={form.paidBy} maxLength={80} onChange={(e) => set({ paidBy: e.target.value })} /></Field>
          <Field label="Receipt or invoice no." hint="From the supplier (optional)"><Input value={form.reference} maxLength={80} onChange={(e) => set({ reference: e.target.value })} /></Field>
        </div>
        <Field label="Description" hint="Optional"><TextArea rows={2} value={form.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Generator diesel for the week" /></Field>

        <div>
          <div className="text-[12.5px] font-semibold text-t1 mb-1.5">Receipts and documents <span className="font-normal text-t3">· photos or PDFs, up to 3 MB each, 3 per expense</span></div>
          <div className="flex flex-wrap gap-2">
            {existing.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-lg border border-line-2 bg-surface-2 text-[12px]">
                <Paperclip className="w-3.5 h-3.5 text-t3" />
                <button type="button" onClick={() => openFile(`/expenses/${expense!.id}/attachments/${a.id}`)} className="font-semibold text-primary hover:underline max-w-[160px] truncate">{a.name}</button>
                <span className="text-t4">{kb(a.size)}</span>
                <button type="button" onClick={() => removeExisting(a)} aria-label={`Remove ${a.name}`} className="p-1 rounded text-t4 hover:text-danger"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {files.map((f, i) => (
              <span key={f.name + i} className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-lg border border-dashed border-line-2 text-[12px]">
                <Paperclip className="w-3.5 h-3.5 text-t3" /><span className="max-w-[160px] truncate text-t1">{f.name}</span><span className="text-t4">{kb(f.size)}</span>
                <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="p-1 rounded text-t4 hover:text-danger"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {room > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Paperclip className="w-3.5 h-3.5" /> Attach a file</Button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" multiple hidden onChange={(e) => pick(e.target.files)} />
          </div>
        </div>

        {!editing && (
          <div className="rounded-xl border border-line p-3.5">
            <label className="flex items-center gap-2.5 text-[13px] font-semibold text-t1 cursor-pointer">
              <input type="checkbox" checked={!!repeat} onChange={(e) => setRepeat(e.target.checked ? "monthly" : "")} className="w-4 h-4 accent-[var(--st-primary)]" />
              <Repeat className="w-4 h-4 text-t3" /> This comes round regularly
            </label>
            {repeat && (
              <div className="mt-3 flex items-center gap-3 flex-wrap text-[12.5px] text-t2">
                <Select aria-label="How often" value={repeat} onChange={(e) => setRepeat(e.target.value as Frequency)} className="!w-48">
                  {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                </Select>
                <span>You'll be reminded to record the next one on {fmtDate(nextAfter(form.date, repeat))}.</span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Record expense"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordDue({ rec, money, onClose, onSaved }: { rec: Recurring; money: (n: number) => string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(rec.amount));
  const [date, setDate] = useState(rec.nextDue <= todayStr() ? rec.nextDue : todayStr());
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/expenses/recurring/${rec.id}/record`, { method: "POST", body: JSON.stringify({ amount: Number(amount) || rec.amount, date, reference }) });
      onSaved();
    } catch (err: any) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Record ${rec.type}`} subtitle={`${FREQ_LABEL[rec.frequency]} · usually ${money(rec.amount)}. Change anything that was different this time.`}>
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><Input required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date paid"><Input required type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Receipt or invoice no." hint="Optional"><Input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} /></Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Recording…" : "Record expense"}</Button>
      </form>
    </Modal>
  );
}

function RecurringModal({ rec, types, onClose, onSaved }: { rec: Recurring | null; types: string[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    type: rec?.type || "", amount: rec ? String(rec.amount) : "", frequency: (rec?.frequency || "monthly") as Frequency,
    nextDue: rec?.nextDue || todayStr(), paymentMethod: (rec?.paymentMethod || "transfer") as Method, paidBy: rec?.paidBy || "", notes: rec?.notes || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body = JSON.stringify({ ...form, amount: Number(form.amount) || 0 });
      if (rec) await api(`/expenses/recurring/${rec.id}`, { method: "PATCH", body });
      else await api("/expenses/recurring", { method: "POST", body });
      onSaved();
    } catch (err: any) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={rec ? `Edit recurring ${rec.type}` : "Add a recurring expense"} subtitle="You'll be reminded on the Expenses page each time it's due" wide>
      <form onSubmit={save} className="space-y-4">
        <ErrorBanner message={error} />
        <CategoryField value={form.type} onChange={(v) => set({ type: v })} types={types} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Amount"><Input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
          <Field label="How often">
            <Select value={form.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
              {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
            </Select>
          </Field>
          <Field label="Next due"><Input required type="date" value={form.nextDue} onChange={(e) => set({ nextDue: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Paid with">
            <Select value={form.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as Method })}>
              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
          <Field label="Paid by" hint="Optional"><Input value={form.paidBy} maxLength={80} onChange={(e) => set({ paidBy: e.target.value })} /></Field>
        </div>
        <Field label="Description" hint="Optional"><Input value={form.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Shop rent, Ikeja" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : rec ? "Save changes" : "Add recurring expense"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The local calendar day of a stored date, as YYYY-MM-DD. */
function todayStrOf(iso: string) {
  return ymd(new Date(iso));
}
