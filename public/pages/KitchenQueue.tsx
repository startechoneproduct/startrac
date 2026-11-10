import { ChefHat, Flame, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Ticket = { saleId: string; saleNo: string; itemIndex: number; name: string; qty: number; prepStatus: string; at: string };

const COLUMNS = [
  { key: "pending", label: "Pending", icon: ChefHat, next: "preparing" },
  { key: "preparing", label: "Preparing", icon: Flame, next: "ready" },
  { key: "ready", label: "Ready", icon: CheckCircle2, next: "served" },
] as const;

// A sale's items land here the moment checkout completes, for any business
// with the kitchenQueue capability — tap a card to advance it; it drops off
// once served. No new real-time plumbing, same reload-driven pattern as
// every other page in the app.
export function KitchenQueue() {
  const { activeBranch } = useSession();
  const { data, loading, reload } = useApi<{ tickets: Ticket[] }>("/kitchen-queue", [activeBranch?.id]);
  const tickets = data?.tickets || [];

  async function advance(t: Ticket, next: string) {
    await api(`/kitchen-queue/${t.saleId}/items/${t.itemIndex}`, { method: "PATCH", body: JSON.stringify({ prepStatus: next }) });
    reload();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader title="Kitchen Queue" subtitle="What's cooking, what's ready — tap a ticket to move it along" />

      {loading ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <Card><EmptyState icon={ChefHat} title="Nothing in the kitchen" body="Sale items appear here the moment they're rung up, oldest first." /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const rows = tickets.filter((t) => t.prepStatus === col.key);
            const Icon = col.icon;
            return (
              <div key={col.key}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Icon className="w-4 h-4 text-primary" />
                  <span className="text-[13px] font-semibold text-t1">{col.label}</span>
                  <span className="text-[11px] text-t4 ml-auto">{rows.length}</span>
                </div>
                <div className="space-y-2">
                  {rows.length === 0 ? (
                    <div className="text-[12px] text-t4 py-6 text-center border border-dashed border-line rounded-card">Empty</div>
                  ) : (
                    rows.map((t) => (
                      <button
                        key={`${t.saleId}-${t.itemIndex}`}
                        onClick={() => advance(t, col.next)}
                        className={cn(
                          "w-full text-left bg-surface border border-line rounded-card p-3 hover:border-brand-400 hover:shadow-e1 transition-all"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[13px] font-semibold text-t1">{t.name}</span>
                          <span className="font-mono text-[12px] font-semibold text-primary">×{t.qty}</span>
                        </div>
                        <div className="text-[11px] text-t4">{t.saleNo} · {fmtTime(t.at)}</div>
                        <div className="mt-1.5 text-[11px] font-semibold text-primary">Tap to mark {col.next}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
