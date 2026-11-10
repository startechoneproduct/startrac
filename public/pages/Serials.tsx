import { useState } from "react";
import { ScanBarcode, Search, Wrench, ShoppingBag, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type SerialRow = {
  id: string; productId: string; productName: string; serialNo: string;
  status: string; customerName: string; soldAt: string | null; notes: string; at: string;
  warrantyExpiresAt: string | null; warrantyActive: boolean;
};
type JobRow = { id: string; jobNo: string; title: string; stage: string; total: number; receivedAt: string; collectedAt: string | null };

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "brand"> = {
  in_stock: "success", sold: "brand", returned: "warning", repair: "warning", warranty_void: "danger", written_off: "danger",
};

// The "warranty and repair history" the serials capability promises: search a
// unit, see its current status and every job ticket ever opened against it —
// jobs are the existing Jobs module, not a second ticket system.
export function Serials() {
  const { activeBranch, currency } = useSession();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState("");
  const { data, loading } = useApi<{ serials: SerialRow[] }>(q ? `/serials?q=${encodeURIComponent(q)}` : null, [activeBranch?.id, q]);
  const results = data?.serials || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader title="Serial Numbers" subtitle="Look up a unit — its status, sale, and repair history" />

      <Card className="p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSelected(""); }}
            placeholder="Search a serial number or IMEI…"
            className="pl-9"
          />
        </div>
      </Card>

      {!q ? (
        <EmptyState icon={ScanBarcode} title="Search to get started" body="Type any part of a serial number to find the unit." />
      ) : loading ? (
        <Spinner />
      ) : results.length === 0 ? (
        <EmptyState icon={ScanBarcode} title="No match" body={`Nothing registered matches "${q}".`} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="overflow-hidden self-start">
            <div className="divide-y divide-line">
              {results.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.serialNo)}
                  className={cn(
                    "w-full text-left flex items-center gap-3 px-4 py-3 transition-colors",
                    selected === s.serialNo ? "bg-primary-softer" : "hover:bg-surface-2"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[13px] font-semibold text-t1 truncate">{s.serialNo}</div>
                    <div className="text-[11px] text-t3 truncate">{s.productName}</div>
                  </div>
                  <Badge tone={STATUS_TONE[s.status] || "neutral"} className="capitalize shrink-0">{s.status.replace("_", " ")}</Badge>
                </button>
              ))}
            </div>
          </Card>
          {selected && <SerialDetail serialNo={selected} currency={currency} />}
        </div>
      )}
    </div>
  );
}

function SerialDetail({ serialNo, currency }: { serialNo: string; currency: string }) {
  const { data, loading } = useApi<{ serial: SerialRow; jobs: JobRow[] }>(`/serials/${encodeURIComponent(serialNo)}/lookup`, [serialNo]);
  if (loading) return <Card className="p-5"><Spinner /></Card>;
  if (!data) return null;
  const { serial, jobs } = data;

  return (
    <Card className="p-5 self-start">
      <div className="flex items-center justify-between mb-1">
        <div className="font-mono text-[15px] font-semibold text-t1">{serial.serialNo}</div>
        <Badge tone={STATUS_TONE[serial.status] || "neutral"} className="capitalize">{serial.status.replace("_", " ")}</Badge>
      </div>
      <div className="text-[12px] text-t3 mb-4">{serial.productName}</div>

      {serial.status === "sold" && (
        <div className="flex items-start gap-2.5 p-3 rounded-ctl bg-surface-2 border border-line mb-3">
          <ShoppingBag className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-[12px] text-t2">
            Sold{serial.customerName ? ` to ${serial.customerName}` : ""}
            {serial.soldAt ? ` · ${fmtDateTime(serial.soldAt)}` : ""}
          </div>
        </div>
      )}

      {serial.warrantyExpiresAt && (
        <div className={cn(
          "flex items-start gap-2.5 p-3 rounded-ctl border mb-3",
          serial.warrantyActive ? "bg-success-soft border-success/30" : "bg-danger-soft border-danger/30"
        )}>
          {serial.warrantyActive ? <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" /> : <ShieldOff className="w-4 h-4 text-danger shrink-0 mt-0.5" />}
          <div className={cn("text-[12px]", serial.warrantyActive ? "text-success" : "text-danger")}>
            Warranty {serial.warrantyActive ? "active" : "expired"} · {serial.warrantyActive ? "until" : "expired"} {fmtDateTime(serial.warrantyExpiresAt)}
          </div>
        </div>
      )}

      <div className="text-[11px] font-medium text-t4 mb-2">Repair history</div>
      {jobs.length === 0 ? (
        <div className="text-[12px] text-t4">No job tickets opened against this unit.</div>
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2.5 p-2.5 rounded-ctl border border-line">
              <Wrench className="w-3.5 h-3.5 text-t3 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-t1 truncate">{j.title}</div>
                <div className="text-[10.5px] text-t3">{j.jobNo} · {fmtDateTime(j.receivedAt)}</div>
              </div>
              <Badge tone="neutral" className="capitalize shrink-0">{j.stage.replace("_", " ")}</Badge>
              <span className="font-mono text-[12px] font-semibold text-t1 shrink-0">{fmtMoney(j.total, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
