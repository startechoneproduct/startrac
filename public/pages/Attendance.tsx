import { useState } from "react";
import { Clock, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtTime, todayStr } from "@/lib/format";

type Row = { id: string; staffName: string; clockIn: string; clockOut: string | null; hours: number };

export function Attendance() {
  const { activeBranch, can } = useSession();
  const [date, setDate] = useState(todayStr);
  const canSeeBranch = can("dashboard_ops") || can("staff_mgmt");

  const mine = useApi<{ attendance: Row | null }>("/attendance/today", [activeBranch?.id]);
  const branch = useApi<{ attendance: Row[] }>(canSeeBranch ? `/attendance?date=${date}` : null, [activeBranch?.id, date]);
  const paged = usePaged(branch.data?.attendance || []);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const my = mine.data?.attendance;
  const clockedIn = !!my && !my.clockOut;

  async function punch(action: "clock-in" | "clock-out") {
    setBusy(true); setError("");
    try {
      await api(`/attendance/${action}`, { method: "POST", body: JSON.stringify({}) });
      mine.reload();
      branch.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader title="Attendance" subtitle="Clock in when the day starts, out when it ends" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* My clock */}
        <Card className="p-6 text-center self-start">
          <div className={`w-14 h-14 mx-auto rounded-xl flex items-center justify-center mb-3 ${clockedIn ? "bg-success-soft text-success" : "bg-surface-3 text-t3"}`}>
            <Clock className="w-7 h-7" />
          </div>
          <div className="text-[15px] font-semibold text-t1">
            {clockedIn ? "You're on shift" : my?.clockOut ? "Shift complete" : "Off shift"}
          </div>
          <div className="text-[12px] text-t3 mt-1">
            {my
              ? `In ${fmtTime(my.clockIn)}${my.clockOut ? ` · out ${fmtTime(my.clockOut)} · ${my.hours.toFixed(1)}h` : ""}`
              : "You haven't clocked in today"}
          </div>
          {error && <div className="text-[11px] text-danger font-semibold mt-2">{error}</div>}
          <div className="mt-4">
            {clockedIn ? (
              <Button variant="danger" className="w-full" disabled={busy} onClick={() => punch("clock-out")}>
                <LogOut className="w-4 h-4" /> Clock out
              </Button>
            ) : (
              <Button variant="success" className="w-full" disabled={busy} onClick={() => punch("clock-in")}>
                <LogIn className="w-4 h-4" /> Clock in
              </Button>
            )}
          </div>
        </Card>

        {/* Branch view */}
        {canSeeBranch && (
          <Card className="lg:col-span-2 overflow-hidden self-start">
            <div className="p-4 pb-2 flex items-center gap-3">
              <span className="text-[14px] font-semibold text-t1">{activeBranch?.name} — day view</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-40 !h-8 ml-auto" />
            </div>
            {branch.loading ? (
              <Spinner />
            ) : !branch.data?.attendance.length ? (
              <EmptyState icon={Clock} title="No clock-ins this day" body="Staff clock-ins for the selected date appear here." />
            ) : (
              <div className="divide-y divide-line">
                {paged.rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-primary-soft text-primary font-semibold text-[12px] flex items-center justify-center shrink-0">
                      {r.staffName[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 text-[13px] font-semibold text-t1 truncate">{r.staffName}</div>
                    <div className="text-[12px] text-t3 font-mono">
                      {fmtTime(r.clockIn)} → {r.clockOut ? fmtTime(r.clockOut) : "…"}
                    </div>
                    <div className="w-16 text-right">
                      {r.clockOut ? (
                        <span className="font-mono text-[12px] font-semibold text-t1">{r.hours.toFixed(1)}h</span>
                      ) : (
                        <Badge tone="success">on shift</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Pager {...paged} onPage={paged.setPage} noun="clock-ins" />
          </Card>
        )}
      </div>
    </div>
  );
}
