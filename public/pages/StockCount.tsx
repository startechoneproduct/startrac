import { useState } from "react";
import { ClipboardList, ClipboardCheck, Plus, Lock, ChevronDown, ChevronRight, Printer, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { printReport, mono } from "@/lib/printReport";
import { cn } from "@/lib/utils";

type Issue = "" | "damaged" | "missing" | "expired" | "miscount" | "found" | "other";
type Line = {
  productId: string; productName: string; unit: string; systemQty: number; countedQty: number | null; variance: number | null;
  issue: Issue; comment: string;
};
type Count = {
  id: string; countNo: string; status: "open" | "closed"; lines: Line[]; note: string; closeNote: string;
  startedByName: string; closedByName: string; closedAt: string | null; at: string;
};

const ISSUES: { key: Issue; label: string }[] = [
  { key: "", label: "No reason given" },
  { key: "damaged", label: "Damaged" },
  { key: "missing", label: "Missing" },
  { key: "expired", label: "Expired" },
  { key: "miscount", label: "Miscounted before" },
  { key: "found", label: "Found extra" },
  { key: "other", label: "Other" },
];
const issueLabel = (k: Issue) => ISSUES.find((i) => i.key === k)?.label || "";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The doc's "expected vs. actual" check, made concrete: open a count against
// today's system numbers, walk the shelf, note why anything is off, and close
// it — any gap posts as an ordinary stock adjustment, carrying its reason.
export function StockCount() {
  const { can, activeBusiness } = useSession();
  const { data, loading, reload } = useApi<{ counts: Count[] }>("/stock-counts?limit=30", []);
  const counts = data?.counts || [];
  const openCount = counts.find((c) => c.status === "open");
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  function printCount(c: Count) {
    const rows = c.lines.filter((l) => l.countedQty !== null);
    printReport({
      businessName: activeBusiness?.name || "",
      title: `Stock count ${c.countNo}`,
      subtitle: [`Started ${fmtDateTime(c.at)} by ${c.startedByName}`, c.closedAt && `closed ${fmtDateTime(c.closedAt)} by ${c.closedByName}`, c.closeNote && `Note: ${c.closeNote}`].filter(Boolean).join(" · "),
      columns: [
        { label: "Product", render: (l: Line) => esc(l.productName) },
        { label: "System", align: "right", render: (l) => mono(String(l.systemQty)) },
        { label: "Counted", align: "right", render: (l) => mono(String(l.countedQty ?? "")) },
        { label: "Difference", align: "right", render: (l) => mono(l.variance === null ? "" : l.variance > 0 ? `+${l.variance}` : String(l.variance)) },
        { label: "Reason", render: (l) => esc(l.issue ? issueLabel(l.issue) : "") },
        { label: "Comment", render: (l) => esc(l.comment || "") },
      ],
      rows,
    });
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Stock Counts"
        subtitle="Count what is really on the shelf, note why anything is off, and the system is corrected"
        actions={can("stock_count") && !openCount ? <Button onClick={() => setStarting(true)}><Plus className="w-4 h-4" /> Start count</Button> : undefined}
      />

      {loading ? (
        <Spinner />
      ) : openCount ? (
        <ActiveCount count={openCount} canManage={can("stock_count")} onChanged={reload} />
      ) : counts.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No counts yet"
            body="Start a count to walk the shelf and check physical quantities against the system. Any difference posts as an adjustment, with your reason."
          />
        </Card>
      ) : null}

      {counts.some((c) => c.status === "closed") && (
        <div className="mt-6">
          <div className="text-[12px] font-medium text-t3 mb-2">History</div>
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {counts.filter((c) => c.status === "closed").map((c) => {
                const off = c.lines.filter((l) => l.variance);
                const noted = c.lines.filter((l) => l.comment || l.issue);
                const isOpen = expanded === c.id;
                return (
                  <div key={c.id}>
                    <button onClick={() => setExpanded(isOpen ? null : c.id)} aria-expanded={isOpen} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-t3 shrink-0" /> : <ChevronRight className="w-4 h-4 text-t3 shrink-0" />}
                      <div className="w-8 h-8 rounded-lg bg-surface-3 text-t3 flex items-center justify-center shrink-0">
                        <ClipboardCheck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-t1">{c.countNo}</div>
                        <div className="text-[11px] text-t3 truncate">{c.lines.filter((l) => l.countedQty !== null).length} of {c.lines.length} items counted · {c.startedByName} · {fmtDateTime(c.at)}{c.closeNote ? ` · "${c.closeNote}"` : ""}</div>
                      </div>
                      {noted.length > 0 && <span className="inline-flex items-center gap-1 text-[11.5px] text-t3"><MessageSquareText className="w-3.5 h-3.5" /> {noted.length}</span>}
                      {off.length > 0 ? <Badge tone="warning">{off.length} {off.length === 1 ? "difference" : "differences"}</Badge> : <Badge tone="success">Matched</Badge>}
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pl-[60px]">
                        {c.closeNote && <div className="mb-2 text-[12.5px] text-t2">Closing note: {c.closeNote}</div>}
                        {off.length === 0 && noted.length === 0 ? (
                          <div className="text-[12.5px] text-t3">Everything counted matched the system.</div>
                        ) : (
                          <table className="w-full text-[12.5px]">
                            <thead>
                              <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-t3 border-b border-line">
                                <th className="py-1.5 font-semibold">Product</th>
                                <th className="py-1.5 font-semibold text-right">System</th>
                                <th className="py-1.5 font-semibold text-right">Counted</th>
                                <th className="py-1.5 font-semibold text-right">Difference</th>
                                <th className="py-1.5 pl-4 font-semibold">Reason and comment</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {c.lines.filter((l) => l.variance || l.comment || l.issue).map((l) => (
                                <tr key={l.productId}>
                                  <td className="py-1.5 text-t1">{l.productName}</td>
                                  <td className="py-1.5 text-right font-mono text-t3">{l.systemQty}</td>
                                  <td className="py-1.5 text-right font-mono">{l.countedQty ?? ""}</td>
                                  <td className={cn("py-1.5 text-right font-mono font-semibold", !l.variance ? "text-success" : "text-warning")}>{l.variance ? (l.variance > 0 ? `+${l.variance}` : l.variance) : "0"}</td>
                                  <td className="py-1.5 pl-4 text-t2">{[l.issue && issueLabel(l.issue), l.comment].filter(Boolean).join(": ") || <span className="text-t4">No note</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <Button size="sm" variant="secondary" className="mt-3" onClick={() => printCount(c)}><Printer className="w-3.5 h-3.5" /> Print</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <StartCountModal open={starting} onClose={() => setStarting(false)} onStarted={() => { setStarting(false); reload(); }} />
    </div>
  );
}

function StartCountModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const { data } = useApi<{ categories: string[] }>(open ? "/products/categories" : null, [open]);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true); setError("");
    try {
      await api("/stock-counts", { method: "POST", body: JSON.stringify({ category: category || undefined }) });
      setCategory("");
      onStarted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Card className="p-5 mb-6">
      <div className="text-[13px] font-semibold text-t1 mb-3">Start a new count</div>
      {error && <div className="text-[12px] text-danger mb-2">{error}</div>}
      <div className="flex items-end gap-2">
        <Field label="Scope" hint="Optional. Leave blank to count everything" className="flex-1 max-w-xs">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Every stock product</option>
            {(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Button onClick={start} disabled={busy}>{busy ? "Starting…" : "Start"}</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

function ActiveCount({ count, canManage, onChanged }: { count: Count; canManage: boolean; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Record<string, Issue>>(() => Object.fromEntries(count.lines.map((l) => [l.productId, l.issue || ""])));
  const [comments, setComments] = useState<Record<string, string>>(() => Object.fromEntries(count.lines.map((l) => [l.productId, l.comment || ""])));
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valueFor = (l: Line) => drafts[l.productId] ?? (l.countedQty === null ? "" : String(l.countedQty));
  const save = (productId: string, patch: { countedQty?: number | null; issue?: Issue; comment?: string }) =>
    api(`/stock-counts/${count.id}`, { method: "PATCH", body: JSON.stringify({ lines: [{ productId, ...patch }] }) }).catch((err) => setError(err.message));

  function saveQty(productId: string, raw: string) {
    setDrafts((d) => ({ ...d, [productId]: raw }));
    if (raw === "") return save(productId, { countedQty: null });
    const countedQty = Number(raw);
    if (Number.isNaN(countedQty) || countedQty < 0) return;
    save(productId, { countedQty });
  }

  async function close() {
    setBusy(true); setError("");
    try {
      await api(`/stock-counts/${count.id}/close`, { method: "POST", body: JSON.stringify({ note: closeNote }) });
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const rows = count.lines.map((l) => {
    const val = valueFor(l);
    return { l, val, variance: val === "" ? null : Number(val) - l.systemQty };
  });
  const countedSoFar = rows.filter((r) => r.val !== "").length;
  const off = rows.filter((r) => r.variance);
  const unexplained = off.filter((r) => !issues[r.l.productId] && !comments[r.l.productId]?.trim());

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line flex-wrap">
        <span className="text-[13px] font-semibold text-t1">{count.countNo}</span>
        <Badge tone="brand">Open</Badge>
        <span className="text-[11px] text-t3">{countedSoFar}/{count.lines.length} counted{off.length ? ` · ${off.length} ${off.length === 1 ? "difference" : "differences"}` : ""}</span>
        {canManage && !closing && (
          <Button size="sm" className="ml-auto" onClick={() => setClosing(true)} disabled={busy}>
            <Lock className="w-3.5 h-3.5" /> Close count
          </Button>
        )}
      </div>
      <ErrorBanner message={error} />

      {closing && (
        <div className="px-4 py-4 border-b border-line bg-surface-2 space-y-3">
          <div className="text-[13px] text-t1">
            Closing posts {off.length === 0 ? "no adjustments: everything counted matches." : `${off.length} ${off.length === 1 ? "adjustment" : "adjustments"} to stock, each with its reason.`}
            {unexplained.length > 0 && <span className="block text-[12px] text-warning mt-1">{unexplained.length} {unexplained.length === 1 ? "difference has" : "differences have"} no reason yet: {unexplained.slice(0, 4).map((r) => r.l.productName).join(", ")}{unexplained.length > 4 ? "…" : ""}</span>}
          </div>
          <Field label="Closing note" hint="Optional, e.g. who helped count or anything to follow up">
            <TextArea rows={2} value={closeNote} maxLength={500} onChange={(e) => setCloseNote(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={close} disabled={busy}><Lock className="w-3.5 h-3.5" /> {busy ? "Closing…" : "Close and adjust stock"}</Button>
            <Button variant="secondary" onClick={() => setClosing(false)} disabled={busy}>Keep counting</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11.5px] font-medium text-t4 border-b border-line">
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2 text-right">System</th>
              <th className="px-4 py-2 text-right">Counted</th>
              <th className="px-4 py-2 text-right">Difference</th>
              <th className="px-4 py-2">Reason and comment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ l, val, variance }) => (
              <tr key={l.productId} className="align-top">
                <td className="px-4 py-2.5 text-[13px] text-t1">{l.productName}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[12px] text-t3 whitespace-nowrap">{l.systemQty} {l.unit}</td>
                <td className="px-4 py-2 text-right">
                  <Input
                    aria-label={`Counted ${l.productName}`}
                    type="number" min="0" value={val}
                    onChange={(e) => setDrafts((d) => ({ ...d, [l.productId]: e.target.value }))}
                    onBlur={(e) => saveQty(l.productId, e.target.value)}
                    disabled={!canManage}
                    className="!w-24 !h-8 text-right ml-auto"
                  />
                </td>
                <td className={cn("px-4 py-2.5 text-right font-mono text-[12px] font-semibold", variance === null ? "text-t4" : variance === 0 ? "text-success" : "text-warning")}>
                  {variance === null ? "" : variance > 0 ? `+${variance}` : variance}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2 min-w-[300px]">
                    {variance ? (
                      <Select
                        aria-label={`Reason for ${l.productName}`}
                        value={issues[l.productId] || ""}
                        disabled={!canManage}
                        onChange={(e) => { const v = e.target.value as Issue; setIssues((x) => ({ ...x, [l.productId]: v })); save(l.productId, { issue: v }); }}
                        className={cn("!h-8 !w-[150px] shrink-0 !text-[12px]", !issues[l.productId] && "!border-warning/60")}
                      >
                        {ISSUES.map((i) => <option key={i.key} value={i.key}>{i.key ? i.label : "Reason…"}</option>)}
                      </Select>
                    ) : null}
                    <Input
                      aria-label={`Comment on ${l.productName}`}
                      value={comments[l.productId] || ""}
                      maxLength={300}
                      disabled={!canManage}
                      placeholder={variance ? "What happened? e.g. 3 broken in the store room" : "Add a note (optional)"}
                      onChange={(e) => setComments((x) => ({ ...x, [l.productId]: e.target.value }))}
                      onBlur={(e) => { if ((e.target.value || "") !== (l.comment || "")) save(l.productId, { comment: e.target.value }); }}
                      className="!h-8 !text-[12px] flex-1"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
