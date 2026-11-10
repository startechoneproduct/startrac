import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, Bike, Check, CircleCheck, Clock, Globe, MapPin, PackageCheck, Phone, Receipt, Store, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Modal } from "@/components/ui/Modal";
import { Pager } from "@/components/ui/Pager";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "placed" | "confirmed" | "ready" | "out_for_delivery" | "completed" | "cancelled" | "rejected";
type Order = {
  id: string; orderNo: string; status: Status; placedAt: string;
  items: { productId: string; name: string; qty: number; unitPrice: number; lineNet: number }[];
  subtotal: number; vat: number; deliveryFee: number; total: number;
  fulfilment: { type: "pickup" | "delivery"; address: string };
  note: string;
  payment: { method: string; label: string; status: "unpaid" | "paid" };
  history: { status: string; at: string; by?: string; note: string }[];
  reason: string; customerId: string; contact: { name: string; phone: string; email: string };
  saleId: string | null; saleNo: string | null; saleStatus?: string | null;
};
type Summary = {
  counts: Record<Status, number>; waiting: number; open: number; storeEnabled: boolean;
  online30d: { revenue: number; orders: number }; onlineToday: { revenue: number; orders: number };
};

const LABEL: Record<Status, string> = { placed: "Waiting", confirmed: "Confirmed", ready: "Ready", out_for_delivery: "Out for delivery", completed: "Completed", cancelled: "Cancelled", rejected: "Rejected" };
const TONE: Record<Status, "warning" | "brand" | "success" | "danger" | "neutral"> = { placed: "warning", confirmed: "brand", ready: "brand", out_for_delivery: "brand", completed: "success", cancelled: "danger", rejected: "danger" };
const VIEWS = [["open", "Open"], ["placed", "Waiting"], ["completed", "Completed"], ["closed", "Closed"]] as const;
const PER = 10;

export function Orders() {
  const { currency } = useSession();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { data: sum, reload: reloadSum } = useApi<Summary>("/orders/summary", [tick]);
  const { data, loading, reload } = useApi<{ orders: Order[]; page: number; pages: number; total: number }>(
    `/orders?status=${view}&limit=${PER}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`, [tick]
  );

  // New orders should show up without anyone pressing refresh.
  useEffect(() => {
    const id = setInterval(() => { reload(); reloadSum(); }, 30_000);
    return () => clearInterval(id);
  }, [reload, reloadSum]);

  const changed = useCallback(() => setTick((n) => n + 1), []);
  const money = (n: number) => fmtMoney(n, currency);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader title="Online orders" subtitle="Orders your customers place on your page. Confirm one and it's recorded as a sale, with the stock taken off." />

      {sum && !sum.storeEnabled && (
        <Card className="p-5 mb-5 flex items-center gap-4 flex-wrap">
          <span className="grid place-items-center w-11 h-11 rounded-2xl bg-primary-soft text-primary"><Globe className="w-5 h-5" /></span>
          <div className="flex-1 min-w-[220px]">
            <div className="text-[14px] font-semibold text-t1">Your online store is switched off</div>
            <div className="text-[12.5px] text-t3 mt-0.5">Turn it on in Business page → Online store so customers can register and order.</div>
          </div>
          <Link to="/app/my-site"><Button size="sm">Set up online store</Button></Link>
        </Card>
      )}

      {sum && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            ["Waiting for you", String(sum.waiting), sum.waiting ? "text-warning" : "text-t1"],
            ["In progress", String(sum.counts.confirmed + sum.counts.ready + sum.counts.out_for_delivery), "text-t1"],
            ["Online sales today", money(sum.onlineToday.revenue), "text-t1"],
            ["Online sales · 30 days", money(sum.online30d.revenue), "text-t1"],
          ].map(([l, v, c]) => (
            <Card key={l} className="px-4 py-3.5">
              <div className="text-[11.5px] font-medium text-t4">{l}</div>
              <div className={cn("font-mono font-semibold text-[20px] tabular-nums mt-0.5 truncate", c)}>{v}</div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Segmented options={VIEWS} value={view} onChange={(k) => { setView(k); setPage(1); }} badge={{ key: "placed", count: sum?.waiting ?? 0 }} />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Order no., name or phone…" className="!w-64 ml-auto" />
      </div>

      {loading && !data ? <div className="py-16"><Spinner /></div> : !data || !data.orders.length ? (
        <Card><EmptyState icon={Globe} title={q ? "No orders match" : view === "open" ? "No open orders" : "Nothing here yet"} body={q ? "Try a different search." : "When a customer orders from your page, it appears here and in your notifications."} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {data.orders.map((o) => (
              <button key={o.id} onClick={() => setOpenId(o.id)} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-surface-2 transition-colors">
                <span className={cn("grid place-items-center w-10 h-10 rounded-xl shrink-0", o.fulfilment.type === "delivery" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary")}>
                  {o.fulfilment.type === "delivery" ? <Bike className="w-[18px] h-[18px]" /> : <Store className="w-[18px] h-[18px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12.5px] font-semibold text-primary">{o.orderNo}</span>
                    <Badge tone={TONE[o.status]}>{LABEL[o.status]}</Badge>
                    {o.payment.status === "paid" ? <Badge tone="success">paid</Badge> : <Badge tone="neutral">{o.payment.label}</Badge>}
                  </div>
                  <div className="text-[13px] font-semibold text-t1 truncate mt-0.5">{o.contact.name} · {o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</div>
                  <div className="text-[11.5px] text-t3">{fmtDateTime(o.placedAt)}</div>
                </div>
                <div className="font-mono font-semibold text-[14px] tabular-nums shrink-0">{money(o.total)}</div>
              </button>
            ))}
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.orders.length} onPage={setPage} noun="orders" />
        </Card>
      )}

      <OrderModal id={openId} money={money} onClose={() => setOpenId(null)} onChanged={changed} />
    </div>
  );
}

function OrderModal({ id, money, onClose, onChanged }: { id: string | null; money: (n: number) => string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useApi<{ order: Order }>(id ? `/orders/${id}` : null, [id]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => { setError(""); setRejecting(false); setReason(""); }, [id]);
  if (!id) return null;
  const o = data?.order;

  async function act(key: string, path: string, body?: unknown) {
    setBusy(key); setError("");
    try {
      await api(`/orders/${id}/${path}`, { method: "POST", body: JSON.stringify(body || {}) });
      setRejecting(false); reload(); onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal open onClose={onClose} title={o ? `${o.orderNo}` : "Order"} subtitle={o ? `Placed ${fmtDateTime(o.placedAt)}` : ""} wide>
      {loading || !o ? <div className="py-12"><Spinner /></div> : (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={TONE[o.status]}>{LABEL[o.status]}</Badge>
            <Badge tone={o.fulfilment.type === "delivery" ? "warning" : "brand"}>{o.fulfilment.type === "delivery" ? "Delivery" : "Pickup"}</Badge>
            <Badge tone={o.payment.status === "paid" ? "success" : "neutral"}>{o.payment.label} · {o.payment.status === "paid" ? "paid" : "not paid yet"}</Badge>
            {o.saleNo && <Link to={`/app/sales?saleNo=${o.saleNo}`} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"><Receipt className="w-3.5 h-3.5" /> Sale {o.saleNo}{o.saleStatus === "voided" ? " (voided)" : ""}</Link>}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-surface-2 p-3.5 space-y-1.5 text-[13px]">
              <div className="font-semibold text-t1 flex items-center justify-between">{o.contact.name}<Link to="/app/customers" className="text-[11.5px] font-semibold text-primary hover:underline">Customer book</Link></div>
              <a href={`tel:${o.contact.phone}`} className="flex items-center gap-2 text-t2 hover:text-primary"><Phone className="w-3.5 h-3.5" />{o.contact.phone}</a>
              <div className="text-t3 truncate">{o.contact.email}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3.5 space-y-1.5 text-[13px]">
              <div className="font-semibold text-t1 flex items-center gap-2">{o.fulfilment.type === "delivery" ? <><MapPin className="w-3.5 h-3.5" /> Deliver to</> : <><Store className="w-3.5 h-3.5" /> Customer will collect</>}</div>
              <div className="text-t2">{o.fulfilment.type === "delivery" ? o.fulfilment.address : "At the shop"}</div>
              {o.note && <div className="text-t2 italic">“{o.note}”</div>}
            </div>
          </div>

          <div className="rounded-xl border border-line overflow-hidden">
            {o.items.map((i) => (
              <div key={i.productId} className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-line last:border-0 text-[13px]">
                <span className="text-t1 font-medium">{i.name} <span className="text-t3">× {i.qty}</span></span>
                <span className="font-mono tabular-nums text-t1">{money(i.lineNet)}</span>
              </div>
            ))}
            <div className="px-3.5 py-2.5 bg-surface-2 text-[13px] space-y-1">
              <div className="flex justify-between text-t3"><span>Subtotal</span><span className="font-mono">{money(o.subtotal)}</span></div>
              {o.vat > 0 && <div className="flex justify-between text-t3"><span>VAT</span><span className="font-mono">{money(o.vat)}</span></div>}
              {o.deliveryFee > 0 && <div className="flex justify-between text-t3"><span>Delivery</span><span className="font-mono">{money(o.deliveryFee)}</span></div>}
              <div className="flex justify-between font-semibold text-t1 text-[14px]"><span>Total</span><span className="font-mono">{money(o.total)}</span></div>
            </div>
          </div>

          {o.reason && <div className="rounded-xl bg-danger-soft text-danger px-3.5 py-2.5 text-[13px] font-medium">{o.reason}</div>}

          {/* The actions that fit where the order is right now. */}
          {o.status === "placed" && !rejecting && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button onClick={() => act("confirm", "confirm")} disabled={!!busy}><Check className="w-4 h-4" /> {busy === "confirm" ? "Confirming…" : "Confirm & record sale"}</Button>
              <Button variant="outline" onClick={() => setRejecting(true)} disabled={!!busy}><X className="w-4 h-4" /> Decline</Button>
              <span className="text-[11.5px] text-t4">Confirming takes the items out of stock{o.payment.method === "transfer" ? "; check the transfer landed first" : ""}.</span>
            </div>
          )}
          {o.status === "placed" && rejecting && (
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-t3">Tell the customer why
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sorry, that item just ran out" className="mt-1" autoFocus />
              </label>
              <div className="flex gap-2"><Button variant="danger" onClick={() => act("reject", "reject", { reason })} disabled={!!busy || reason.trim().length < 3}>{busy === "reject" ? "Declining…" : "Decline order"}</Button><Button variant="ghost" onClick={() => setRejecting(false)}>Back</Button></div>
            </div>
          )}
          {["confirmed", "ready", "out_for_delivery"].includes(o.status) && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {o.status === "confirmed" && <Button variant="secondary" onClick={() => act("ready", "status", { status: "ready" })} disabled={!!busy}><PackageCheck className="w-4 h-4" /> {o.fulfilment.type === "delivery" ? "Packed & ready" : "Ready for pickup"}</Button>}
              {o.fulfilment.type === "delivery" && o.status !== "out_for_delivery" && <Button variant="secondary" onClick={() => act("out", "status", { status: "out_for_delivery" })} disabled={!!busy}><Bike className="w-4 h-4" /> Out for delivery</Button>}
              <Button variant="success" onClick={() => act("done", "status", { status: "completed" })} disabled={!!busy}><CircleCheck className="w-4 h-4" /> {o.fulfilment.type === "delivery" ? "Delivered" : "Collected"}</Button>
            </div>
          )}
          {o.payment.status === "unpaid" && !["placed", "cancelled", "rejected"].includes(o.status) && o.payment.method === "transfer" && (
            <Button variant="outline" size="sm" onClick={() => act("paid", "paid")} disabled={!!busy}><Banknote className="w-4 h-4" /> Mark transfer received</Button>
          )}
          {["confirmed", "ready", "out_for_delivery"].includes(o.status) && (
            <p className="text-[11.5px] text-t4">Need to cancel? Void the sale from Sales — the order is cancelled and the stock goes back.</p>
          )}

          <div>
            <div className="text-[12px] font-semibold text-t1 mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Timeline</div>
            <ol className="space-y-1.5">
              {o.history.map((h, i) => (
                <li key={i} className="text-[12.5px] text-t2 flex gap-2"><span className="text-t4 w-[130px] shrink-0">{fmtDateTime(h.at)}</span><span><b className="text-t1 capitalize">{(LABEL[h.status as Status] || h.status).toLowerCase()}</b>{h.by ? ` · ${h.by}` : ""}{h.note ? ` — ${h.note}` : ""}</span></li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}
