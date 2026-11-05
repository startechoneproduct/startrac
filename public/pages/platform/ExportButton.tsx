import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiDownload } from "@/lib/api";

export type ExportKind = "accounts" | "businesses" | "users" | "payments";

/** Downloads one console list as an Excel file (the server names it, with today's date). */
export function ExportButton({ kind, label = "Export" }: { kind: ExportKind; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { await apiDownload(`/platform/export/${kind}`, `startrack-${kind}.xlsx`); }
    catch (e: any) { setErr(e.message || "Couldn't download"); }
    finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={go} disabled={busy} title={`Download ${kind} as Excel`}>
        <Download className="w-4 h-4" /> {busy ? "Preparing…" : label}
      </Button>
      {err && <span className="text-[11.5px] text-danger">{err}</span>}
    </span>
  );
}
