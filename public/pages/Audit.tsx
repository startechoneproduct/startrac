import { ScrollText, Tag, Undo2, UserCog, Settings as SettingsIcon, Ban, Boxes, MapPin, ShieldCheck } from "lucide-react";
import { PERMISSION_GROUPS } from "#shared/permissions.js";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { fmtDateTime } from "@/lib/format";

type Entry = {
  id: string; actorName: string; action: string;
  target: { type: string; label: string };
  before?: any; after?: any; at: string;
};

const ACTION_META: Record<string, { label: string; icon: any; tone: "brand" | "success" | "warning" | "danger" | "neutral" }> = {
  "product.create": { label: "Product added", icon: Boxes, tone: "success" },
  "product.price_change": { label: "Price changed", icon: Tag, tone: "warning" },
  "product.archive": { label: "Product archived", icon: Boxes, tone: "neutral" },
  "sale.void": { label: "Sale voided", icon: Ban, tone: "danger" },
  "sale.undo_request": { label: "Asked to undo a sale", icon: Ban, tone: "warning" },
  "sale.undo_reject": { label: "Undo request turned down", icon: Ban, tone: "neutral" },
  "return.approve": { label: "Return approved", icon: Undo2, tone: "brand" },
  "return.reject": { label: "Return rejected", icon: Undo2, tone: "danger" },
  "staff.create": { label: "Staff added", icon: UserCog, tone: "success" },
  "staff.update": { label: "Staff changed", icon: UserCog, tone: "warning" },
  "staff.pin_reset": { label: "PIN reset", icon: UserCog, tone: "warning" },
  "staff.permissions": { label: "Permissions changed", icon: ShieldCheck, tone: "warning" },
  "settings.update": { label: "Settings changed", icon: SettingsIcon, tone: "neutral" },
  "branch.create": { label: "Branch added", icon: MapPin, tone: "success" },
  "stock.adjust": { label: "Stock adjusted", icon: Boxes, tone: "warning" },
  "stock.transfer": { label: "Stock transferred", icon: Boxes, tone: "brand" },
  "expense.delete": { label: "Expense deleted", icon: Ban, tone: "danger" },
  "expense.update": { label: "Expense changed", icon: Tag, tone: "warning" },
  "ticket.create": { label: "Ticket raised", icon: Tag, tone: "neutral" },
  "ticket.update": { label: "Ticket updated", icon: Tag, tone: "neutral" },
  "ticket.help": { label: "Asked StarTrack for help", icon: Tag, tone: "brand" },
  "ticket.escalate": { label: "Ticket sent to StarTrack", icon: Tag, tone: "brand" },
  "expense.recurring_create": { label: "Recurring expense added", icon: Tag, tone: "neutral" },
  "expense.recurring_update": { label: "Recurring expense changed", icon: Tag, tone: "neutral" },
  "expense.recurring_delete": { label: "Recurring expense stopped", icon: Ban, tone: "neutral" },
  "stock.receive": { label: "Delivery received", icon: Boxes, tone: "success" },
};

const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => [p.key, p.label])));

function describe(e: Entry): string {
  if (e.action === "product.price_change" && e.before && e.after) {
    const bits = [];
    if (e.before.price !== e.after.price) bits.push(`price ${e.before.price} → ${e.after.price}`);
    if (e.before.cost !== e.after.cost) bits.push(`cost ${e.before.cost} → ${e.after.cost}`);
    return bits.join(", ");
  }
  if (e.action === "sale.void") return e.after?.reason ? `"${e.after.reason}"` : "";
  if (e.action === "sale.undo_request") return e.after?.reason ? `"${e.after.reason}"` : "";
  if (e.action === "sale.undo_reject") return e.after?.note ? `"${e.after.note}"` : "";
  if (e.action === "staff.update" && e.before && e.after) {
    const bits = [];
    if (e.before.role !== e.after.role) bits.push(`role ${e.before.role} → ${e.after.role}`);
    if (e.before.status !== e.after.status) bits.push(`${e.after.status === "inactive" ? "suspended" : "restored"}`);
    return bits.join(", ");
  }
  if (e.action === "staff.permissions" && e.after) {
    const name = (k: string) => PERMISSION_LABEL[k] || k;
    const bits = [];
    if (e.after.permsOverride?.length) bits.push(`added: ${e.after.permsOverride.map(name).join(", ")}`);
    if (e.after.permsRevoked?.length) bits.push(`taken away: ${e.after.permsRevoked.map(name).join(", ")}`);
    return bits.length ? bits.join("; ") : "reset to the role's permissions";
  }
  if (e.action === "expense.update" && e.before && e.after) {
    const bits = [];
    if (e.before.amount !== e.after.amount) bits.push(`amount ${e.before.amount} → ${e.after.amount}`);
    if (e.before.date !== e.after.date) bits.push(`date ${e.before.date} → ${e.after.date}`);
    if (e.before.type !== e.after.type) bits.push(`category ${e.before.type} → ${e.after.type}`);
    return bits.join(", ");
  }
  if (e.action === "stock.receive" && e.after) return `${e.after.lines} products, ${e.after.totalQty} units${e.after.supplier ? ` from ${e.after.supplier}` : ""}${e.after.reference ? `, invoice ${e.after.reference}` : ""}`;
  if (e.action === "stock.adjust" && e.before && e.after) return `${e.before.stock} → ${e.after.stock} ("${e.after.reason}")`;
  return "";
}

export function Audit() {
  const { data, loading } = useApi<{ entries: Entry[] }>("/audit?limit=100", []);
  const entries = data?.entries || [];
  const paged = usePaged(entries);

  return (
    <div className="p-6 lg:p-8 max-w-[900px] mx-auto">
      <PageHeader title="Audit Log" subtitle="Every sensitive action, on the record — newest first" />
      {loading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState icon={ScrollText} title="Nothing logged yet" body="Price changes, voids, PIN resets, settings edits — they all leave a trace here." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {paged.rows.map((e) => {
              const meta = ACTION_META[e.action] || { label: e.action, icon: ScrollText, tone: "neutral" as const };
              const Icon = meta.icon;
              const detail = describe(e);
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-3 text-t2 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {e.target?.label && <span className="text-[13px] font-semibold text-t1">{e.target.label}</span>}
                    </div>
                    {detail && <div className="text-[12px] text-t2 mt-0.5">{detail}</div>}
                    <div className="text-[11px] text-t4 mt-0.5">{e.actorName} · {fmtDateTime(e.at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <Pager {...paged} onPage={paged.setPage} noun="entries" />
        </Card>
      )}
    </div>
  );
}
