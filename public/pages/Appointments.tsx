import { useMemo, useState } from "react";
import {
  CalendarClock, ChevronLeft, ChevronRight, Plus, Scissors, Play, CheckCircle2, UserX, XCircle, Clock, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { MethodPicker, SectionTitle, Tabs, Tile, PersonFields, type PayMethod } from "@/components/services/ServiceKit";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtTime, todayStr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Service = { id: string; name: string; category: string; price: number; durationMins: number; active: boolean };
type Appt = {
  id: string; customerName: string; customerPhone: string;
  items: { serviceId: string; name: string; price: number; durationMins: number }[];
  provider: string; startsAt: string; endsAt: string; durationMins: number; total: number;
  deposit: { amount: number; method: string; saleNo: string } | null; discount: number; amountPaid: number; balanceDue: number;
  status: "booked" | "in_progress" | "completed" | "no_show" | "cancelled"; notes: string; cancelReason: string;
};
type Overview = {
  today: { booked: number; inProgress: number; completed: number; noShows: number; expected: number; next: Appt[] };
  weekAhead: number;
  last30: { completed: number; noShows: number; cancelled: number; noShowRate: number | null; avgTicket: number; revenue: number; repeatClients: number; uniqueClients: number };
  depositsHeld: number;
  topServices: { name: string; count: number; revenue: number }[];
  providerLoad: { provider: string; mins: number }[];
};

const STATUS: Record<Appt["status"], { label: string; tone: "brand" | "success" | "warning" | "danger" | "neutral" }> = {
  booked: { label: "Booked", tone: "brand" },
  in_progress: { label: "In the chair", tone: "warning" },
  completed: { label: "Done", tone: "success" },
  no_show: { label: "No-show", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm"; the API wants an instant.
const toLocalInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`);

type Tab = "schedule" | "overview" | "services";

export function Appointments() {
  const { can, currency, activeBranch } = useSession();
  const [tab, setTab] = useState<Tab>("schedule");
  const tabs: { key: Tab; label: string }[] = [
    { key: "schedule", label: "Schedule" },
    ...(can("dashboard_ops") ? [{ key: "overview" as Tab, label: "Overview" }] : []),
    { key: "services", label: "Service menu" },
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader title="Appointments" subtitle={`${activeBranch?.name || ""} · bookings, providers and the day's takings`} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "schedule" && <ScheduleTab currency={currency} />}
      {tab === "overview" && <OverviewTab currency={currency} />}
      {tab === "services" && <ServicesTab currency={currency} canManage={can("prices")} />}
    </div>
  );
}

/* ───────────────────────── Schedule ───────────────────────── */

function ScheduleTab({ currency }: { currency: string }) {
  const { activeBranch } = useSession();
  const [date, setDate] = useState(todayStr());
  const [provider, setProvider] = useState("");
  const { data, loading, reload } = useApi<{ appointments: Appt[] }>(`/salon/appointments?date=${date}`, [activeBranch?.id]);
  const { data: provData } = useApi<{ providers: string[] }>("/salon/providers", [activeBranch?.id]);
  const [newOpen, setNewOpen] = useState(false);
  const [completing, setCompleting] = useState<Appt | null>(null);
  const [moving, setMoving] = useState<Appt | null>(null);
  const [cancelling, setCancelling] = useState<Appt | null>(null);
  const [error, setError] = useState("");

  const all = useMemo(() => data?.appointments ?? [], [data]);
  const providers = useMemo(() => [...new Set([...(provData?.providers || []), ...all.map((a) => a.provider).filter(Boolean)])].sort(), [provData, all]);
  const rows = provider ? all.filter((a) => a.provider === provider) : all;
  const live = all.filter((a) => a.status === "booked" || a.status === "in_progress");
  const expected = live.reduce((s, a) => s + a.total, 0);
  const isToday = date === todayStr();

  async function act(a: Appt, status: "in_progress" | "no_show") {
    setError("");
    try { await api(`/salon/appointments/${a.id}/status`, { method: "POST", body: JSON.stringify({ status }) }); reload(); }
    catch (err: any) { setError(err.message); }
  }

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="!h-8 !w-40 text-[12px]" />
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><ChevronRight className="w-4 h-4" /></Button>
          {!isToday && <Button variant="ghost" size="sm" onClick={() => setDate(todayStr())}>Today</Button>}
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New appointment</Button>
      </div>

      <div className="grid grid-cols-3 gap-5 mb-4">
        <Tile label="Appointments" value={all.length} />
        <Tile label="Still to serve" value={live.length} />
        <Tile label="Value to come" value={fmtMoney(expected, currency)} />
      </div>

      {providers.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {["", ...providers].map((p) => (
            <button key={p || "all"} onClick={() => setProvider(p)} className={cn(
              "h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors",
              provider === p ? "bg-primary-soft border-brand-400 text-primary" : "border-line-2 text-t3 hover:text-t1"
            )}>{p || "Everyone"}</button>
          ))}
        </div>
      )}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="Nothing booked" body={provider ? `${provider} has no appointments this day.` : "No appointments on this day yet."}
          action={<Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New appointment</Button>} /></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => {
            const open = a.status === "booked" || a.status === "in_progress";
            const st = STATUS[a.status];
            return (
              <Card key={a.id} className={cn("p-4", !open && a.status !== "completed" && "opacity-70")}>
                <div className="flex items-start gap-4">
                  <div className="w-20 shrink-0 text-center">
                    <div className="font-mono font-semibold text-[14px] text-t1">{fmtTime(a.startsAt)}</div>
                    <div className="text-[10.5px] text-t4">{mins(a.durationMins)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[14px] font-semibold text-t1">{a.customerName}</div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="text-[12.5px] text-t2 mt-0.5">{a.items.map((i) => i.name).join(" + ")}</div>
                    <div className="text-[11.5px] text-t3 mt-0.5">
                      {a.provider ? `with ${a.provider}` : "No provider assigned"}{a.customerPhone ? ` · ${a.customerPhone}` : ""}
                      {a.deposit ? ` · deposit ${fmtMoney(a.deposit.amount, currency)} paid` : ""}
                    </div>
                    {a.notes && <div className="text-[11.5px] text-t4 mt-1 italic">“{a.notes}”</div>}
                    {a.status === "cancelled" && a.cancelReason && <div className="text-[11.5px] text-t4 mt-1">Reason: {a.cancelReason}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold text-[14px] text-t1">{fmtMoney(a.status === "completed" ? a.total - a.discount : a.total, currency)}</div>
                    {open && a.balanceDue > 0 && <div className="text-[11px] text-warning font-semibold">{fmtMoney(a.balanceDue, currency)} to pay</div>}
                  </div>
                </div>
                {open && (
                  <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-line pl-0 sm:pl-24">
                    {a.status === "booked" && <Button size="sm" variant="secondary" onClick={() => act(a, "in_progress")}><Play className="w-3.5 h-3.5" /> Start</Button>}
                    <Button size="sm" variant="success" onClick={() => setCompleting(a)}><CheckCircle2 className="w-3.5 h-3.5" /> Complete &amp; pay</Button>
                    {a.status === "booked" && <Button size="sm" variant="outline" onClick={() => setMoving(a)}><Pencil className="w-3.5 h-3.5" /> Reschedule</Button>}
                    <Button size="sm" variant="ghost" onClick={() => act(a, "no_show")}><UserX className="w-3.5 h-3.5" /> No-show</Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(a)}><XCircle className="w-3.5 h-3.5" /> Cancel</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {newOpen && <BookModal date={date} currency={currency} providers={providers} onClose={() => setNewOpen(false)} onDone={() => { setNewOpen(false); reload(); }} />}
      {completing && <CompleteModal appt={completing} currency={currency} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); reload(); }} />}
      {moving && <RescheduleModal appt={moving} providers={providers} onClose={() => setMoving(null)} onDone={() => { setMoving(null); reload(); }} />}
      {cancelling && <CancelModal appt={cancelling} currency={currency} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); reload(); }} />}
    </>
  );
}

function BookModal({ date, currency, providers, onClose, onDone }: {
  date: string; currency: string; providers: string[]; onClose: () => void; onDone: () => void;
}) {
  const { data } = useApi<{ services: Service[] }>("/salon/services");
  const services = useMemo(() => data?.services ?? [], [data]);
  const initial = useMemo(() => {
    const d = new Date(`${date}T09:00:00`);
    if (date === todayStr()) { const n = new Date(); d.setTime(n.getTime() + (60 - n.getMinutes()) * 60_000); d.setSeconds(0, 0); }
    return toLocalInput(d);
  }, [date]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [provider, setProvider] = useState("");
  const [when, setWhen] = useState(initial);
  const [notes, setNotes] = useState("");
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState<PayMethod>("transfer");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const chosen = services.filter((s) => picked.includes(s.id));
  const total = chosen.reduce((s, x) => s + x.price, 0);
  const duration = chosen.reduce((s, x) => s + x.durationMins, 0);
  const end = duration ? new Date(new Date(when).getTime() + duration * 60_000) : null;
  const dep = Number(deposit) || 0;
  const byCat = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of services) (m.get(s.category) || m.set(s.category, []).get(s.category)!).push(s);
    return [...m.entries()];
  }, [services]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (dep > total) { setError(`A deposit can't be more than the price (${fmtMoney(total, currency)}).`); return; }
    setBusy(true); setError("");
    try {
      await api("/salon/appointments", {
        method: "POST",
        body: JSON.stringify({
          customer: { name: name.trim(), phone: phone.trim() },
          serviceIds: picked, provider: provider.trim(), startsAt: new Date(when).toISOString(), notes,
          ...(dep > 0 ? { deposit: { method, amount: dep } } : {}),
        }),
      });
      onDone();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New appointment" subtitle="The same stylist can't be booked twice at once" wide>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <PersonFields label="Client name" name={name} phone={phone} onName={setName} onPhone={setPhone} autoFocus />
        <div>
          <span className="block text-[12px] font-semibold text-t2 mb-1.5">Services</span>
          {services.length === 0 ? (
            <p className="text-[12px] text-t4">Add services in the Service menu tab first.</p>
          ) : (
            <div className="space-y-2.5 max-h-52 overflow-y-auto rounded-ctl border border-line p-2.5">
              {byCat.map(([cat, list]) => (
                <div key={cat}>
                  <div className="text-[11.5px] font-medium text-t4 mb-1">{cat}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((s) => {
                      const on = picked.includes(s.id);
                      return (
                        <button type="button" key={s.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))} className={cn(
                          "px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold text-left transition-colors",
                          on ? "bg-primary-soft border-brand-400 text-primary" : "border-line-2 text-t2 hover:border-brand-400"
                        )}>
                          {s.name} <span className="font-normal text-t3">· {fmtMoney(s.price, currency)} · {mins(s.durationMins)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Stylist / provider">
            <Input list="salon-providers" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Who will do it" />
            <datalist id="salon-providers">{providers.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Date & time"><Input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Colour reference, allergies…" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Deposit (optional)"><Input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" /></Field>
          {dep > 0 && <Field label="Deposit method"><MethodPicker value={method} onChange={setMethod} /></Field>}
        </div>
        <div className="rounded-ctl bg-surface-2 border border-line px-3 py-2.5 text-[13px] space-y-1">
          <div className="flex justify-between"><span className="text-t3">Total</span><span className="font-mono font-semibold">{fmtMoney(total, currency)}</span></div>
          <div className="flex justify-between"><span className="text-t3">Takes</span><span className="font-mono">{duration ? `${mins(duration)}${end ? ` · until ${fmtTime(end)}` : ""}` : "—"}</span></div>
          {dep > 0 && <div className="flex justify-between"><span className="text-t3">Balance at the end</span><span className="font-mono">{fmtMoney(Math.max(0, total - dep), currency)}</span></div>}
        </div>
        <Button type="submit" className="w-full" disabled={busy || !picked.length || !name.trim()}>{busy ? "Booking…" : "Book appointment"}</Button>
      </form>
    </Modal>
  );
}

function CompleteModal({ appt, currency, onClose, onDone }: { appt: Appt; currency: string; onClose: () => void; onDone: () => void }) {
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const deposit = appt.deposit?.amount || 0;
  const disc = Math.min(Number(discount) || 0, appt.total);
  const due = Math.round((appt.total - disc - deposit) * 100) / 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/salon/appointments/${appt.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ discount: disc, payments: due > 0 ? [{ method, amount: due }] : [] }),
      });
      onDone();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Complete & take payment" subtitle={`${appt.customerName} · ${appt.items.map((i) => i.name).join(", ")}`}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Discount (optional)"><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
        <div className="rounded-ctl bg-surface-2 border border-line px-3 py-2.5 text-[13px] space-y-1">
          <div className="flex justify-between"><span className="text-t3">Price</span><span className="font-mono">{fmtMoney(appt.total, currency)}</span></div>
          {disc > 0 && <div className="flex justify-between"><span className="text-t3">Discount</span><span className="font-mono">−{fmtMoney(disc, currency)}</span></div>}
          {deposit > 0 && <div className="flex justify-between"><span className="text-t3">Deposit already paid</span><span className="font-mono">−{fmtMoney(deposit, currency)}</span></div>}
          <div className="flex justify-between border-t border-line pt-1.5"><span className="font-semibold">To pay now</span><span className={cn("font-mono font-semibold", due < 0 && "text-danger")}>{fmtMoney(Math.max(0, due), currency)}</span></div>
        </div>
        {due < 0 && <ErrorBanner message="The deposit is already more than the bill — reduce the discount." />}
        {due > 0 && <Field label="Payment method"><MethodPicker value={method} onChange={setMethod} /></Field>}
        <Button type="submit" className="w-full" disabled={busy || due < 0}>{busy ? "Saving…" : due > 0 ? `Receive ${fmtMoney(due, currency)}` : "Mark as done"}</Button>
      </form>
    </Modal>
  );
}

function RescheduleModal({ appt, providers, onClose, onDone }: { appt: Appt; providers: string[]; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState(toLocalInput(new Date(appt.startsAt)));
  const [provider, setProvider] = useState(appt.provider);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/salon/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify({ startsAt: new Date(when).toISOString(), provider }) });
      onDone();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Reschedule" subtitle={`${appt.customerName} · ${mins(appt.durationMins)}`}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Date & time"><Input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Provider">
          <Input list="salon-providers-2" value={provider} onChange={(e) => setProvider(e.target.value)} />
          <datalist id="salon-providers-2">{providers.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Move appointment"}</Button>
      </form>
    </Modal>
  );
}

function CancelModal({ appt, currency, onClose, onDone }: { appt: Appt; currency: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/salon/appointments/${appt.id}/status`, { method: "POST", body: JSON.stringify({ status: "cancelled", reason }) });
      onDone();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Cancel appointment" subtitle={appt.customerName}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        {appt.deposit && <p className="text-[12.5px] text-warning bg-warning-soft rounded-ctl px-3 py-2">The {fmtMoney(appt.deposit.amount, currency)} deposit is kept, since the slot was held. Refund it by hand if you decide to waive it.</p>}
        <Field label="Why was it cancelled?"><Input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client travelled" /></Field>
        <Button type="submit" variant="danger" className="w-full" disabled={busy || reason.trim().length < 2}>{busy ? "Cancelling…" : "Cancel appointment"}</Button>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

function OverviewTab({ currency }: { currency: string }) {
  const { activeBranch } = useSession();
  const { data, loading, error } = useApi<Overview>("/salon/overview", [activeBranch?.id]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  const { today, last30, topServices, providerLoad } = data;
  const maxMins = Math.max(1, ...providerLoad.map((p) => p.mins));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <Tile label="Today: to serve" value={today.booked + today.inProgress} hint={`${today.inProgress} in the chair now`} />
        <Tile label="Today: done" value={today.completed} hint={today.noShows ? `${today.noShows} no-show` : undefined} />
        <Tile label="Booked this week" value={data.weekAhead} />
        <Tile label="Deposits held" value={fmtMoney(data.depositsHeld, currency)} hint="on future bookings" />
        <Tile label="Income, 30 days" value={fmtMoney(last30.revenue, currency)} />
        <Tile label="Average ticket" value={fmtMoney(last30.avgTicket, currency)} hint={`${last30.completed} visits`} />
        <Tile label="No-show rate" value={last30.noShowRate !== null ? `${last30.noShowRate}%` : "—"} tone={last30.noShowRate !== null && last30.noShowRate > 15 ? "danger" : undefined} hint={`${last30.cancelled} cancelled`} />
        <Tile label="Repeat clients" value={last30.repeatClients} hint={`of ${last30.uniqueClients} served`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <SectionTitle>Coming up next today</SectionTitle>
          <Card className="overflow-hidden">
            {today.next.length === 0 ? <div className="px-4 py-8 text-center text-[12px] text-t4 flex items-center justify-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Nothing else booked today.</div> : (
              <div className="divide-y divide-line">
                {today.next.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="font-mono text-[12.5px] font-semibold w-16">{fmtTime(a.startsAt)}</div>
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold truncate">{a.customerName}</div><div className="text-[11px] text-t3 truncate">{a.items.map((i) => i.name).join(" + ")}{a.provider ? ` · ${a.provider}` : ""}</div></div>
                    <div className="font-mono text-[12.5px]">{fmtMoney(a.total, currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        <div>
          <SectionTitle>Provider load today</SectionTitle>
          <Card className="p-4 space-y-3">
            {providerLoad.length === 0 ? <div className="text-center text-[12px] text-t4 py-4">No one is booked today.</div> : providerLoad.map((p) => (
              <div key={p.provider}>
                <div className="flex justify-between text-[12.5px] mb-1"><span className="font-semibold text-t1">{p.provider}</span><span className="font-mono text-t3">{mins(p.mins)}</span></div>
                <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${(p.mins / maxMins) * 100}%` }} /></div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div>
        <SectionTitle>Best-earning services, last 30 days</SectionTitle>
        <Card className="overflow-hidden">
          {topServices.length === 0 ? <div className="px-4 py-8 text-center text-[12px] text-t4">No completed visits yet.</div> : (
            <div className="divide-y divide-line">
              {topServices.map((s) => (
                <div key={s.name} className="flex items-center gap-3 px-4 py-2.5">
                  <Scissors className="w-4 h-4 text-t4 shrink-0" />
                  <div className="text-[13px] font-semibold text-t1 flex-1 truncate">{s.name}</div>
                  <div className="text-[11.5px] text-t3">{s.count}×</div>
                  <div className="font-mono font-semibold text-[13px] w-28 text-right">{fmtMoney(s.revenue, currency)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Service menu ───────────────────────── */

function ServicesTab({ currency, canManage }: { currency: string; canManage: boolean }) {
  const { data, loading, reload } = useApi<{ services: Service[] }>("/salon/services?all=1");
  const [edit, setEdit] = useState<Service | "new" | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of data?.services || []) (m.get(s.category) || m.set(s.category, []).get(s.category)!).push(s);
    return [...m.entries()];
  }, [data]);

  return (
    <>
      {canManage && <div className="flex justify-end mb-4"><Button onClick={() => setEdit("new")}><Plus className="w-4 h-4" /> Add a service</Button></div>}
      {loading && !data ? <Spinner /> : groups.length === 0 ? (
        <Card><EmptyState icon={Scissors} title="Your menu is empty" body="List what you offer, how long each takes and what it costs. Bookings are priced from here." action={canManage ? <Button onClick={() => setEdit("new")}><Plus className="w-4 h-4" /> Add a service</Button> : undefined} /></Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, list]) => (
            <div key={cat}>
              <div className="text-[11.5px] font-medium tracking-[0.1em] text-t4 mb-2">{cat}</div>
              <Card className="overflow-hidden divide-y divide-line">
                {list.map((s) => (
                  <div key={s.id} className={cn("flex items-center gap-3 px-4 py-3", !s.active && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-t1 truncate">{s.name} {!s.active && <Badge tone="neutral">hidden</Badge>}</div>
                      <div className="text-[11px] text-t3">{mins(s.durationMins)}</div>
                    </div>
                    <div className="font-mono font-semibold text-[13px]">{fmtMoney(s.price, currency)}</div>
                    {canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
      {edit && <ServiceModal service={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function ServiceModal({ service, onClose, onSaved }: { service: Service | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: service?.name || "", category: service?.category || "", price: String(service?.price ?? ""),
    durationMins: String(service?.durationMins ?? 30), active: service?.active ?? true,
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(service ? `/salon/services/${service.id}` : "/salon/services", {
        method: service ? "PATCH" : "POST",
        body: JSON.stringify({ name: form.name.trim(), category: form.category.trim() || "General", price: Number(form.price), durationMins: Number(form.durationMins), active: form.active }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={service ? "Edit service" : "Add a service"}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Service name"><Input autoFocus required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Knotless Braids" /></Field>
        <Field label="Category"><Input value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Hair, Nails, Spa…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price"><Input type="number" min={0} required value={form.price} onChange={(e) => set({ price: e.target.value })} /></Field>
          <Field label="Takes (minutes)"><Input type="number" min={5} max={720} required value={form.durationMins} onChange={(e) => set({ durationMins: e.target.value })} /></Field>
        </div>
        {service && (
          <label className="flex items-center gap-2 text-[13px] text-t2 cursor-pointer">
            <input type="checkbox" checked={!form.active} onChange={(e) => set({ active: !e.target.checked })} className="w-4 h-4" />
            Hide from the booking list
          </label>
        )}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : service ? "Save changes" : "Add service"}</Button>
      </form>
    </Modal>
  );
}
