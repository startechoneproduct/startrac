import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Copy, FileSpreadsheet, Image as ImageIcon, Loader2, X } from "lucide-react";
import { PhotoFinder } from "@/components/products/PhotoFinder";
import { useSession } from "@/lib/session";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ImportPreview = {
  actionId: string | null;
  target: string;
  label: string;
  singular: string;
  fileName: string;
  sheet: string;
  counts: { rows: number; read: number; create: number; duplicates: number; issues: number };
  mapping: { field: string; label: string; header: string }[];
  unused: string[];
  columns: { key: string; label: string; format: string; align?: string }[];
  sample: Record<string, any>[];
  duplicates: { row: number; name: string; reason: string }[];
  issues: { row: number; name: string; reason: string }[];
  notes: { text: string; count: number; examples: string[] }[];
  status: "pending" | "approved" | "rejected" | "none";
  result?: string;
  error?: string;
};

// Where to look at what was just added.
const WHERE: Record<string, { to: string; label: string }> = {
  products: { to: "/app/products", label: "View in the catalog" },
  courses: { to: "/app/academy", label: "View courses" },
  salon_services: { to: "/app/appointments", label: "View the service menu" },
  gym_plans: { to: "/app/members", label: "View plans" },
};

function Tile({ value, label, tone }: { value: number; label: string; tone: "brand" | "neutral" | "warn" }) {
  const t = {
    brand: "bg-success-soft text-success",
    neutral: "bg-surface-3 text-t2",
    warn: "bg-warning-soft text-warning",
  }[tone];
  return (
    <div className={cn("rounded-xl px-3 py-2.5 min-w-0", t)}>
      <div className="text-[20px] font-bold font-mono leading-none">{value.toLocaleString("en-NG")}</div>
      <div className="mt-1 text-[11.5px] font-semibold opacity-90 truncate">{label}</div>
    </div>
  );
}

function Fold({ icon: Icon, title, count, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-3 transition-colors" aria-expanded={open}>
        <Icon className="w-3.5 h-3.5 text-t3 shrink-0" />
        <span className="flex-1 text-[12.5px] font-bold text-t1">{title}</span>
        <span className="text-[12px] font-mono text-t3">{count}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-t3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-line max-h-56 overflow-y-auto divide-y divide-line">{children}</div>}
    </div>
  );
}

/**
 * What a spreadsheet would add — shown BEFORE anything is created. The numbers
 * are what the server will do on approval; the rows below the counts are a
 * sample, and the lists explain every row that was left out and why.
 */
export function ImportPreviewCard({
  preview, busy, onDecide,
}: {
  preview: ImportPreview;
  busy: boolean;
  onDecide: (action: "approve" | "reject") => void;
}) {
  const { currency } = useSession();
  const navigate = useNavigate();
  const p = preview;
  const more = p.counts.create - p.sample.length;
  const where = WHERE[p.target];
  const [photos, setPhotos] = useState(false);

  const show = (v: any, format: string) => {
    if (v === null || v === undefined || v === "") return "—";
    if (format === "money") return fmtMoney(Number(v), currency);
    return String(v);
  };

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-e1 overflow-hidden">
      <div className="flex items-center gap-3 p-3.5">
        <span className="grid place-items-center w-11 h-11 rounded-xl text-white shrink-0" style={{ background: "linear-gradient(135deg, #0f9f6e, #3cc99a)", boxShadow: "0 10px 18px -10px rgba(15, 159, 110, 0.7)" }}>
          <FileSpreadsheet className="w-5 h-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-bold text-success">Import preview</div>
          <div className="text-[13.5px] font-bold text-t1 truncate">{p.label} from {p.fileName}</div>
          <div className="text-[12px] text-t3 truncate">
            {p.sheet !== "CSV" ? `Sheet “${p.sheet}” · ` : ""}{p.counts.rows.toLocaleString("en-NG")} rows
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 px-3.5">
        <Tile value={p.counts.create} label={p.counts.create === 1 ? "to add" : "to add"} tone="brand" />
        <Tile value={p.counts.duplicates} label="already there" tone="neutral" />
        <Tile value={p.counts.issues} label={p.counts.issues === 1 ? "needs attention" : "need attention"} tone="warn" />
      </div>

      {p.mapping.length > 0 && (
        <div className="px-3.5 pt-3">
          <div className="text-[11.5px] font-bold text-t3 mb-1.5">Columns I used</div>
          <div className="flex flex-wrap gap-1.5">
            {p.mapping.map((m) => (
              <span key={m.field} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-3 text-[11.5px] text-t2">
                <b className="font-bold text-t1">{m.label}</b>
                <ArrowRight className="w-3 h-3 text-t4 rotate-180" />
                <span className="truncate max-w-[130px]">{m.header}</span>
              </span>
            ))}
          </div>
          {p.unused.length > 0 && <div className="mt-1.5 text-[11.5px] text-t3 truncate">Not used: {p.unused.join(", ")}</div>}
        </div>
      )}

      {p.sample.length > 0 && (
        <div className="px-3.5 pt-3">
          <div className="rounded-xl border border-line overflow-x-auto">
            <table data-no-stack className="w-full text-[12px]">
              <thead>
                <tr className="bg-surface-2">
                  {p.columns.map((c) => (
                    <th key={c.key} className={cn("px-3 py-2 font-semibold text-t3 whitespace-nowrap", c.align === "right" ? "text-right" : "text-left")}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.sample.map((row, i) => (
                  <tr key={i} className="border-t border-line">
                    {p.columns.map((c) => (
                      <td key={c.key} className={cn("px-3 py-1.5 text-t1 max-w-[180px] truncate", c.align === "right" && "text-right font-mono")}>{show(row[c.key], c.format)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more > 0 && <div className="mt-1.5 text-[11.5px] text-t3">…and {more.toLocaleString("en-NG")} more</div>}
        </div>
      )}

      {p.notes.length > 0 && (
        <ul className="px-3.5 pt-3 space-y-1">
          {p.notes.map((n) => (
            <li key={n.text} className="text-[12px] text-t2 flex gap-2">
              <span className="mt-[7px] w-1 h-1 rounded-full bg-t4 shrink-0" />
              <span><b className="font-semibold text-t1">{n.count}</b> {n.count === 1 ? "row" : "rows"}: {n.text}{n.examples.length ? ` (${n.examples.join(", ")})` : ""}</span>
            </li>
          ))}
        </ul>
      )}

      {(p.counts.duplicates > 0 || p.counts.issues > 0) && (
        <div className="px-3.5 pt-3 space-y-2">
          <Fold icon={Copy} title="Left out — already there" count={p.counts.duplicates}>
            {p.duplicates.map((d, i) => (
              <div key={i} className="px-3 py-2 text-[12px]">
                <div className="flex items-baseline gap-2"><span className="font-mono text-t4 shrink-0">row {d.row}</span><span className="font-semibold text-t1 truncate">{d.name}</span></div>
                <div className="text-t3">{d.reason}</div>
              </div>
            ))}
            {p.counts.duplicates > p.duplicates.length && <div className="px-3 py-2 text-[11.5px] text-t3">…and {p.counts.duplicates - p.duplicates.length} more</div>}
          </Fold>
          <Fold icon={AlertTriangle} title="Rows I couldn't use" count={p.counts.issues}>
            {p.issues.map((d, i) => (
              <div key={i} className="px-3 py-2 text-[12px]">
                <div className="flex items-baseline gap-2"><span className="font-mono text-t4 shrink-0">row {d.row}</span><span className="font-semibold text-t1 truncate">{d.name || "(no name)"}</span></div>
                <div className="text-warning">{d.reason}</div>
              </div>
            ))}
            {p.counts.issues > p.issues.length && <div className="px-3 py-2 text-[11.5px] text-t3">…and {p.counts.issues - p.issues.length} more</div>}
          </Fold>
        </div>
      )}

      <div className="p-3.5">
        {p.error && <div className="mb-2.5 text-[12px] text-danger font-semibold">{p.error}</div>}
        {p.status === "pending" && p.actionId ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onDecide("approve")} disabled={busy} className="bg-primary text-white h-10 px-4 rounded-xl text-[13px] font-bold flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {busy ? "Adding…" : `Add ${p.counts.create.toLocaleString("en-NG")} ${p.counts.create === 1 ? p.singular : `${p.singular}s`}`}
            </button>
            <button onClick={() => onDecide("reject")} disabled={busy} className="h-10 px-4 rounded-xl border border-line-2 bg-surface text-t2 text-[13px] font-bold hover:text-danger hover:border-danger/50 disabled:opacity-60 flex items-center gap-1.5 transition-colors">
              <X className="w-4 h-4" /> Discard
            </button>
          </div>
        ) : p.status === "approved" ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-success-soft text-success text-[12.5px] font-bold"><Check className="w-3.5 h-3.5" /> {p.result || "Added"}</span>
            {p.target === "products" && (
              <button onClick={() => setPhotos(true)} className="h-8 px-3 rounded-lg border border-line-2 bg-surface text-t1 text-[12.5px] font-bold hover:border-primary/50 hover:text-primary inline-flex items-center gap-1.5 transition-colors">
                <ImageIcon className="w-3.5 h-3.5" /> Find photos for them
              </button>
            )}
            {where && <button onClick={() => navigate(where.to)} className="text-[12.5px] font-bold text-primary hover:underline inline-flex items-center gap-1">{where.label} <ArrowRight className="w-3.5 h-3.5" /></button>}
            {p.target === "products" && <PhotoFinder open={photos} onClose={() => setPhotos(false)} />}
          </div>
        ) : p.status === "rejected" ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-3 text-t3 text-[12.5px] font-bold"><X className="w-3.5 h-3.5" /> Discarded — nothing was added</span>
        ) : (
          <span className="text-[12.5px] text-t3">Nothing to add from this file.</span>
        )}
      </div>
    </div>
  );
}
