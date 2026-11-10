import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ErrorBanner, Select } from "@/components/ui/Field";
import { api, ApiError, downloadFile } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * One way to upload a spreadsheet, whatever it holds. The server does the real
 * work and answers the same way every time:
 *   1. choose a file  →  a PREVIEW comes back (nothing is saved yet)
 *   2. check the columns it guessed, and what it would do  →  fix anything
 *   3. Save  →  the same file is sent again with commit=1
 * The server re-reads the file on save, so the browser can never smuggle in rows.
 */

export type Report = {
  fileName: string; sheet: string; headers: string[]; mapping: Record<string, string>; truncated: boolean;
  totals: Record<string, number>; sample: any[]; problems: { row: number; reason: string }[];
  committed: boolean; created?: number; updated?: number; failed?: number; limit?: { message: string; requiredPlan?: string };
  [k: string]: any;
};
export type Field = { key: string; label: string; required?: boolean };
export type Option = { key: string; label: string; hint?: string };
export type Tile = { label: string; value: string | number; tone?: "good" | "warn" | "bad" };

export function SpreadsheetImport({ open, onClose, title, subtitle, endpoint, fields, options = [], tiles, columns, saveLabel, done, onDone, template }: {
  open: boolean; onClose: () => void; title: string; subtitle: string; endpoint: string;
  fields: Field[]; options?: Option[];
  tiles: (r: Report) => Tile[];
  columns: { label: string; cell: (row: any) => ReactNode; align?: "right" }[];
  saveLabel: (r: Report) => string;
  done: (r: Report) => ReactNode;
  onDone: () => void;
  template?: { label: string; href: string; fileName: string };
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"" | "preview" | "save">("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const reset = useCallback(() => { setFile(null); setReport(null); setMapping({}); setOpts({}); setError(""); setBusy(""); }, []);
  useEffect(() => { if (!open) reset(); }, [open, reset]);

  const send = useCallback(async (f: File, m: Record<string, string>, o: Record<string, boolean>, commit: boolean) => {
    const form = new FormData();
    form.append("file", f);
    form.append("mapping", JSON.stringify(m));
    for (const [k, v] of Object.entries(o)) if (v) form.append(k, "1");
    if (commit) form.append("commit", "1");
    return api<Report>(endpoint, { method: "POST", body: form });
  }, [endpoint]);

  const preview = useCallback(async (f: File, m: Record<string, string>, o: Record<string, boolean>) => {
    const mine = ++seq.current;
    setBusy("preview"); setError("");
    try {
      const r = await send(f, m, o, false);
      if (mine !== seq.current) return;
      setReport(r); setMapping(r.mapping);
    } catch (e) {
      if (mine !== seq.current) return;
      const err = e as ApiError;
      // The file opened, but its columns weren't recognised: let the person choose them.
      if (err.code === "no_columns" && err.data?.headers) {
        setReport({ fileName: f.name, sheet: "", headers: err.data.headers, mapping: err.data.mapping || {}, truncated: false, totals: {}, sample: [], problems: [], committed: false });
        setMapping(err.data.mapping || {});
        setError(err.message);
      } else { setError(err.message || "Couldn't read that file."); setReport(null); }
    } finally { if (mine === seq.current) setBusy(""); }
  }, [send]);

  function choose(f: File | undefined | null) {
    if (!f) return;
    setFile(f); setReport(null); setMapping({});
    preview(f, {}, opts);
  }

  const remap = (key: string, col: string) => {
    const next = { ...mapping, [key]: col };
    if (!col) delete next[key];
    setMapping(next);
    if (file) preview(file, next, opts);
  };
  const toggle = (key: string, v: boolean) => { const next = { ...opts, [key]: v }; setOpts(next); if (file) preview(file, mapping, next); };

  async function save() {
    if (!file) return;
    setBusy("save"); setError("");
    try {
      const r = await send(file, mapping, opts, true);
      setReport(r);
      onDone();
    } catch (e) { setError((e as ApiError).message || "Couldn't save."); } finally { setBusy(""); }
  }

  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
  const nothingToSave = report && !report.committed && Object.keys(report.totals).length > 0 && tiles(report).every((t) => t.tone !== "good" || Number(t.value) === 0);

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} wide>
      <div className="space-y-4">
        <ErrorBanner message={error} />

        {report?.committed ? (
          <div className="py-6 text-center">
            <span className="mx-auto grid place-items-center w-14 h-14 rounded-2xl bg-success-soft text-success"><CheckCircle2 className="w-7 h-7" /></span>
            <div className="mt-3 text-[16px] font-semibold text-t1">{done(report)}</div>
            {report.problems.length > 0 && <p className="mt-2 text-[12.5px] text-t3">{report.problems.length} row{report.problems.length === 1 ? " was" : "s were"} skipped. They're listed below.</p>}
            {report.problems.length > 0 && <Problems problems={report.problems} />}
            <div className="mt-5"><Button onClick={onClose}>Done</Button></div>
          </div>
        ) : !file ? (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files[0]); }}
              onClick={() => input.current?.click()} role="button" tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              className={cn("cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors", drag ? "border-primary bg-primary-softer" : "border-line-2 hover:border-primary hover:bg-surface-2")}
            >
              <span className="mx-auto grid place-items-center w-12 h-12 rounded-2xl bg-primary-soft text-primary"><Upload className="w-6 h-6" /></span>
              <div className="mt-3 text-[14px] font-semibold text-t1">Drop a file here, or click to choose one</div>
              <div className="mt-1 text-[12.5px] text-t3">Excel (.xlsx) or CSV, up to 5 MB. The first row should be the column names.</div>
              <input ref={input} type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" aria-label="Choose a spreadsheet" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            {template && <TemplateLink {...template} />}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
              <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-t1 truncate">{file.name}</div>
                <div className="text-[11.5px] text-t3">{report?.sheet ? `Sheet “${report.sheet}” · ` : ""}{report ? `${report.totals.rows ?? 0} rows read` : "Reading…"}{report?.truncated ? " (file is longer — only the first part was read)" : ""}</div>
              </div>
              {busy === "preview" && <Loader2 className="w-4 h-4 animate-spin text-t3" />}
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy === "save"}>Change file</Button>
            </div>

            {report && (
              <>
                <div>
                  <div className="text-[12px] font-semibold text-t1 mb-2">Which column is which</div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {fields.map((f) => (
                      <label key={f.key} className="text-[11.5px] font-semibold text-t3">
                        {f.label}{f.required && <span className="text-danger"> *</span>}
                        <Select value={mapping[f.key] || ""} onChange={(e) => remap(f.key, e.target.value)} className="mt-1 !h-9 !text-[12.5px]">
                          <option value="">{f.required ? "Choose a column…" : "— none —"}</option>
                          {report.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </Select>
                      </label>
                    ))}
                  </div>
                </div>

                {options.length > 0 && (
                  <div className="space-y-1.5">
                    {options.map((o) => (
                      <label key={o.key} className="flex items-start gap-2.5 text-[12.5px] text-t2 cursor-pointer">
                        <input type="checkbox" className="mt-0.5 accent-[var(--st-primary)]" checked={!!opts[o.key]} onChange={(e) => toggle(o.key, e.target.checked)} />
                        <span><span className="font-semibold text-t1">{o.label}</span>{o.hint && <span className="text-t3"> — {o.hint}</span>}</span>
                      </label>
                    ))}
                  </div>
                )}

                {Object.keys(report.totals).length > 0 && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {tiles(report).map((t) => (
                        <div key={t.label} className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
                          <div className="text-[11px] font-medium text-t4">{t.label}</div>
                          <div className={cn("font-mono font-semibold text-[17px] tabular-nums", t.tone === "good" && "text-success", t.tone === "warn" && "text-warning", t.tone === "bad" && "text-danger")}>{typeof t.value === "number" ? t.value.toLocaleString() : t.value}</div>
                        </div>
                      ))}
                    </div>

                    {report.limit && (
                      <div className="flex gap-2.5 rounded-xl bg-warning-soft px-3.5 py-3 text-[12.5px] text-warning font-semibold"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {report.limit.message}</div>
                    )}

                    {report.sample.length > 0 && (
                      <div className="rounded-xl border border-line overflow-hidden">
                        <div className="px-3.5 py-2 bg-surface-2 text-[11.5px] font-semibold text-t3">What will be saved (first {report.sample.length})</div>
                        <table data-no-stack className="w-full text-[12.5px]">
                          <thead><tr className="border-b border-line text-t4">{columns.map((c) => <th key={c.label} className={cn("px-3.5 py-1.5 font-medium", c.align === "right" ? "text-right" : "text-left")}>{c.label}</th>)}</tr></thead>
                          <tbody>{report.sample.map((row, i) => <tr key={i} className="border-b border-line last:border-0">{columns.map((c) => <td key={c.label} className={cn("px-3.5 py-1.5 text-t1", c.align === "right" && "text-right font-mono tabular-nums")}>{c.cell(row)}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {report.problems.length > 0 && <Problems problems={report.problems} />}
                  </>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-1">
                  {missingRequired.length > 0 && <span className="text-[12px] text-warning font-semibold mr-auto">Choose the {missingRequired.map((f) => f.label.toLowerCase()).join(" and ")} column{missingRequired.length > 1 ? "s" : ""} to continue.</span>}
                  <Button variant="ghost" onClick={onClose} disabled={busy === "save"}>Cancel</Button>
                  <Button onClick={save} disabled={!!busy || missingRequired.length > 0 || Object.keys(report.totals).length === 0 || !!nothingToSave}>
                    {busy === "save" ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : saveLabel(report)}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Problems({ problems }: { problems: { row: number; reason: string }[] }) {
  return (
    <details className="rounded-xl border border-line text-left">
      <summary className="cursor-pointer px-3.5 py-2.5 text-[12.5px] font-semibold text-t1">Rows that need a look ({problems.length})</summary>
      <ul className="px-3.5 pb-3 space-y-1 max-h-40 overflow-y-auto">
        {problems.map((p, i) => <li key={i} className="text-[12px] text-t2"><span className="font-mono text-t4">Row {p.row}</span> · {p.reason}</li>)}
      </ul>
    </details>
  );
}

function TemplateLink({ label, href, fileName }: { label: string; href: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await downloadFile(href, fileName); } finally { setBusy(false); } }} className="text-[12.5px] font-semibold text-primary hover:underline">
      {label}
    </button>
  );
}
