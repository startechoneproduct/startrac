import { useState } from "react";
import {
  BedDouble, ChevronLeft, ChevronRight, LogIn, LogOut, Plus, Receipt,
  Ban, UtensilsCrossed, Wine, Shirt, Package, Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type CellState = "free" | "booked" | "occupied" | "dirty" | "out_of_service";
type Cell = { night: string; state: CellState; stayId?: string; guestName?: string; folioNo?: string; arrival?: boolean; departure?: boolean };
type RoomRow = { id: string; number: string; floor: string; housekeeping: string; typeName: string; rate: number; capacity: number; cells: Cell[] };
type Grid = {
  from: string; to: string; nights: string[]; rooms: RoomRow[];
  occupancy: { night: string; occupied: number; sellable: number; pct: number }[];
  totals: { rooms: number; sellable: number };
};
type Charge = { at: string; source: string; name: string; qty: number; unitPrice: number; lineNet: number; byName: string };
type Stay = {
  id: string; folioNo: string; roomNumber: string; roomTypeName: string;
  guestName: string; guestPhone: string; guests: number;
  checkIn: string; checkOut: string; nights: number; nightlyRate: number;
  status: string; charges: Charge[]; payments: { method: string; amount: number }[];
  subtotal: number; discount: number; vat: number; total: number; paid: number; balance: number;
};
type Product = { id: string; name: string; price: number; category: string };
type RoomTypeItem = { id: string; name: string; rate: number; capacity: number; amenities?: string[] };
type RoomListItem = { id: string; number: string; floor: string; housekeeping: string; note: string; roomTypeId: string; typeName: string; rate: number };

// The heat map's whole job is to be readable at a glance, so state is carried
// by fill AND by a letter — colour alone fails the colour-blind and the
// half-lit reception desk equally.
const CELL: Record<CellState, { cls: string; mark: string; label: string }> = {
  free:           { cls: "bg-surface-2 border-line", mark: "", label: "Free" },
  booked:         { cls: "bg-warning-soft border-warning/40 text-warning", mark: "B", label: "Booked" },
  occupied:       { cls: "bg-primary text-on-primary border-brand-700", mark: "IN", label: "In house" },
  dirty:          { cls: "bg-surface-3 border-line-2 text-t3", mark: "~", label: "Needs cleaning" },
  out_of_service: { cls: "bg-danger-soft border-danger/30 text-danger", mark: "X", label: "Out of service" },
};

const SOURCE_ICON: Record<string, any> = {
  room: BedDouble, kitchen: UtensilsCrossed, bar: Wine, laundry: Shirt, extras: Package,
};

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayStr = () => new Date().toISOString().slice(0, 10);

export function Hotel() {
  const { activeBranch, currency, can } = useSession();
  const [from, setFrom] = useState(todayStr);
  const [nights] = useState(14);
  const [booking, setBooking] = useState<{ roomId: string; number: string; rate: number; night: string } | null>(null);
  const [openStayId, setOpenStayId] = useState<string | null>(null);
  const [managingRooms, setManagingRooms] = useState(false);

  const { data, loading, reload } = useApi<Grid>(`/hotel/availability?from=${from}&nights=${nights}`, [activeBranch?.id]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Front Desk"
        subtitle={`${activeBranch?.name || ""} · rooms are occupied across dates, never sold off a shelf`}
        actions={
          <div className="flex items-center gap-2">
            {can("prices") && (
              <Button variant="secondary" onClick={() => setManagingRooms(true)}>
                <Settings2 className="w-4 h-4" /> Manage Rooms
              </Button>
            )}
            <Button onClick={() => { const r = data?.rooms.find((x) => x.cells[0]?.state === "free"); if (r) setBooking({ roomId: r.id, number: r.number, rate: r.rate, night: from }); }}>
              <Plus className="w-4 h-4" /> New booking
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setFrom(addDays(from, -7))} className="w-9 h-9 rounded-ctl border border-line-2 bg-surface flex items-center justify-center text-t3 hover:text-primary hover:border-brand-400 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value || todayStr())} className="!w-44" />
        <button onClick={() => setFrom(addDays(from, 7))} className="w-9 h-9 rounded-ctl border border-line-2 bg-surface flex items-center justify-center text-t3 hover:text-primary hover:border-brand-400 transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
        <Button variant="secondary" onClick={() => setFrom(todayStr())}>Today</Button>

        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {(Object.keys(CELL) as CellState[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-t3">
              <span className={cn("w-4 h-4 rounded border flex items-center justify-center text-[8px] font-semibold", CELL[k].cls)}>{CELL[k].mark}</span>
              {CELL[k].label}
            </span>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : !data || data.rooms.length === 0 ? (
        <Card>
          <EmptyState
            icon={BedDouble}
            title="No rooms yet"
            body={can("prices") ? "Add room types and rooms before the front desk can take a booking." : "Ask an admin to add room types and rooms before the front desk can take a booking."}
            action={can("prices") ? <Button onClick={() => setManagingRooms(true)}><Plus className="w-4 h-4" /> Set up rooms</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-surface-2 border-b border-r border-line px-3 py-2 text-left text-[11.5px] font-medium text-t4 min-w-[132px]">
                      Room
                    </th>
                    {data.nights.map((n) => {
                      const d = new Date(`${n}T00:00:00`);
                      const weekend = d.getDay() === 0 || d.getDay() === 6;
                      return (
                        <th key={n} className={cn(
                          "border-b border-line px-1 py-2 text-[10px] font-semibold text-center min-w-[42px]",
                          weekend ? "bg-primary-softer text-primary" : "bg-surface-2 text-t4",
                          n === todayStr() && "ring-1 ring-inset ring-brand-400"
                        )}>
                          <div>{d.toLocaleDateString("en-NG", { weekday: "narrow" })}</div>
                          <div className="text-[11px] text-t2">{n.slice(8)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.rooms.map((room) => (
                    <tr key={room.id}>
                      <td className="sticky left-0 z-10 bg-surface border-b border-r border-line px-3 py-1.5">
                        <div className="text-[13px] font-semibold text-t1">{room.number}</div>
                        <div className="text-[10px] text-t3 truncate">{room.typeName} · {fmtMoney(room.rate, currency)}</div>
                      </td>
                      {room.cells.map((c) => {
                        const meta = CELL[c.state];
                        const clickable = c.state === "free" || !!c.stayId;
                        return (
                          <td key={c.night} className="border-b border-line p-0.5">
                            <button
                              disabled={!clickable}
                              onClick={() => {
                                if (c.stayId) setOpenStayId(c.stayId);
                                else if (c.state === "free") setBooking({ roomId: room.id, number: room.number, rate: room.rate, night: c.night });
                              }}
                              title={c.guestName ? `${c.guestName} · ${c.folioNo}` : `${room.number} · ${meta.label} · ${c.night}`}
                              className={cn(
                                "w-full h-8 rounded border text-[9px] font-semibold flex items-center justify-center transition-all",
                                meta.cls,
                                clickable && "hover:ring-2 hover:ring-brand-400 cursor-pointer",
                                c.arrival && "rounded-l-lg",
                                c.departure && "rounded-r-lg"
                              )}
                            >
                              {c.arrival && c.guestName
                                ? c.guestName.split(" ").slice(-1)[0].slice(0, 6)
                                : meta.mark}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="sticky left-0 z-10 bg-surface-2 border-r border-line px-3 py-2 text-[11.5px] font-medium text-t4">
                      Occupancy
                    </td>
                    {data.occupancy.map((o) => (
                      <td key={o.night} className="px-1 py-2 text-center bg-surface-2">
                        <div className={cn("text-[11px] font-semibold tabular-nums",
                          o.pct >= 80 ? "text-success" : o.pct >= 40 ? "text-t1" : "text-t3")}>{o.pct}%</div>
                        <div className="text-[9px] text-t4">{o.occupied}/{o.sellable}</div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <StayLists onOpen={setOpenStayId} currency={currency} branchKey={activeBranch?.id} />
        </>
      )}

      <BookRoom
        target={booking}
        currency={currency}
        onClose={() => setBooking(null)}
        onSaved={() => { setBooking(null); reload(); }}
      />
      <FolioModal
        stayId={openStayId}
        currency={currency}
        onClose={() => setOpenStayId(null)}
        onChanged={() => { reload(); }}
      />
      <RoomSetupModal
        open={managingRooms}
        onClose={() => setManagingRooms(false)}
        onChanged={reload}
        currency={currency}
      />
    </div>
  );
}

// ── Room types & rooms setup ─────────────────────────────────────────
// The one-time (and ongoing) hotel setup the front desk depends on: a room
// is sold from here, never from the till, so it needs its own small admin
// screen rather than living inside Products.

function RoomSetupModal({ open, onClose, onChanged, currency }: {
  open: boolean; onClose: () => void; onChanged: () => void; currency: string;
}) {
  const { data, reload } = useApi<{ rooms: RoomListItem[]; roomTypes: RoomTypeItem[] }>(open ? "/hotel/rooms" : null, [open]);
  const roomTypes = data?.roomTypes || [];
  const rooms = data?.rooms || [];

  const [typeForm, setTypeForm] = useState({ name: "", rate: "", capacity: "2" });
  const [typeError, setTypeError] = useState("");
  const [typeBusy, setTypeBusy] = useState(false);

  const [roomForm, setRoomForm] = useState({ number: "", roomTypeId: "", floor: "" });
  const [roomError, setRoomError] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setTypeBusy(true); setTypeError("");
    try {
      await api("/hotel/room-types", {
        method: "POST",
        body: JSON.stringify({ name: typeForm.name, rate: Number(typeForm.rate) || 0, capacity: Number(typeForm.capacity) || 2 }),
      });
      setTypeForm({ name: "", rate: "", capacity: "2" });
      reload(); onChanged();
    } catch (err: any) {
      setTypeError(err.message);
    } finally {
      setTypeBusy(false);
    }
  }

  async function addRoom(e: React.FormEvent) {
    e.preventDefault();
    setRoomBusy(true); setRoomError("");
    try {
      await api("/hotel/rooms", {
        method: "POST",
        body: JSON.stringify({ number: roomForm.number, roomTypeId: roomForm.roomTypeId, floor: roomForm.floor }),
      });
      // Keep the type/floor picked — adding a run of rooms on the same floor is the common case.
      setRoomForm((f) => ({ ...f, number: "" }));
      reload(); onChanged();
    } catch (err: any) {
      setRoomError(err.message);
    } finally {
      setRoomBusy(false);
    }
  }

  async function setHousekeeping(room: RoomListItem, hk: string) {
    await api(`/hotel/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ housekeeping: hk }) });
    reload(); onChanged();
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage rooms" subtitle="Room types set the nightly rate; rooms are numbered units of a type" wide>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] font-medium text-t4 mb-2">Room types</div>
          <form onSubmit={addType} className="space-y-2 mb-3">
            <ErrorBanner message={typeError} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="e.g. Deluxe" required value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
              <Input type="number" min="0" placeholder="Rate/night" required value={typeForm.rate} onChange={(e) => setTypeForm({ ...typeForm, rate: e.target.value })} />
              <Input type="number" min="1" placeholder="Sleeps" value={typeForm.capacity} onChange={(e) => setTypeForm({ ...typeForm, capacity: e.target.value })} />
            </div>
            <Button type="submit" variant="secondary" className="w-full" disabled={typeBusy}>
              <Plus className="w-4 h-4" /> {typeBusy ? "Adding…" : "Add room type"}
            </Button>
          </form>
          <div className="rounded-ctl border border-line divide-y divide-line max-h-56 overflow-y-auto">
            {roomTypes.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-t4">No room types yet — add one above.</div>}
            {roomTypes.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-[13px] font-semibold text-t1">{t.name}</span>
                <span className="text-[12px] font-mono text-t3">{fmtMoney(t.rate, currency)}/night · sleeps {t.capacity}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-t4 mb-2">Rooms</div>
          <form onSubmit={addRoom} className="space-y-2 mb-3">
            <ErrorBanner message={roomError} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="Number" required value={roomForm.number} onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })} />
              <Select required value={roomForm.roomTypeId} onChange={(e) => setRoomForm({ ...roomForm, roomTypeId: e.target.value })}>
                <option value="">Type…</option>
                {roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Input placeholder="Floor" value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} />
            </div>
            <Button type="submit" variant="secondary" className="w-full" disabled={roomBusy || roomTypes.length === 0}>
              <Plus className="w-4 h-4" /> {roomBusy ? "Adding…" : "Add room"}
            </Button>
            {roomTypes.length === 0 && <p className="text-[11px] text-t4">Add a room type first.</p>}
          </form>
          <div className="rounded-ctl border border-line divide-y divide-line max-h-56 overflow-y-auto">
            {rooms.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-t4">No rooms yet.</div>}
            {rooms.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-semibold text-t1">{r.number}</span>
                  <span className="text-[11px] text-t3 ml-2 truncate">{r.typeName}{r.floor ? ` · Floor ${r.floor}` : ""}</span>
                </div>
                <Select value={r.housekeeping} onChange={(e) => setHousekeeping(r, e.target.value)} className="!w-36 !h-7 !text-[11px] shrink-0">
                  <option value="clean">Clean</option>
                  <option value="dirty">Needs cleaning</option>
                  <option value="out_of_service">Out of service</option>
                </Select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Arrivals / in house / departures ─────────────────────────────────

function StayLists({ onOpen, currency, branchKey }: { onOpen: (id: string) => void; currency: string; branchKey?: string }) {
  const lists = [
    { query: "arrivals=1", label: "Arriving today", icon: LogIn },
    { query: "status=in_house", label: "In house", icon: BedDouble },
    { query: "departures=1", label: "Departing today", icon: LogOut },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {lists.map((l) => <StayList key={l.query} {...l} onOpen={onOpen} currency={currency} branchKey={branchKey} />)}
    </div>
  );
}

function StayList({ query, label, icon: Icon, onOpen, currency, branchKey }: any) {
  const { data } = useApi<{ stays: Stay[] }>(`/hotel/stays?${query}&limit=6`, [branchKey]);
  const stays = data?.stays || [];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-[13px] font-semibold text-t1">{label}</span>
        {stays.length > 0 && <span className="ml-auto"><Badge tone="brand">{stays.length}</Badge></span>}
      </div>
      {stays.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-t4">Nothing here.</div>
      ) : (
        <div className="divide-y divide-line">
          {stays.map((s) => (
            <button key={s.id} onClick={() => onOpen(s.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 transition-colors">
              <span className="w-9 h-9 shrink-0 rounded-lg bg-primary-soft text-primary flex items-center justify-center text-[12px] font-semibold">
                {s.roomNumber}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-t1 truncate">{s.guestName}</div>
                <div className="text-[11px] text-t3">{s.checkIn} → {s.checkOut} · {s.nights}n</div>
              </div>
              <span className="text-[12px] font-mono font-semibold text-t1 tabular-nums shrink-0">{fmtMoney(s.balance, currency)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Booking ──────────────────────────────────────────────────────────

function BookRoom({ target, currency, onClose, onSaved }: {
  target: { roomId: string; number: string; rate: number; night: string } | null;
  currency: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ guestName: "", guestPhone: "", guests: 1, nights: 1, rate: 0, checkInNow: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!target) return null;

  const rate = form.rate || target.rate;
  const checkOut = addDays(target.night, Math.max(1, form.nights));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/hotel/stays", {
        method: "POST",
        body: JSON.stringify({
          roomId: target!.roomId,
          guestName: form.guestName,
          guestPhone: form.guestPhone,
          guests: form.guests,
          checkIn: target!.night,
          checkOut,
          rate: form.rate || undefined,
          checkInNow: form.checkInNow,
        }),
      });
      setForm({ guestName: "", guestPhone: "", guests: 1, nights: 1, rate: 0, checkInNow: false });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!target} onClose={onClose} title={`Room ${target.number}`} subtitle={`From ${fmtDate(target.night)}`}>
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Guest name"><Input autoFocus required value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><Input value={form.guestPhone} onChange={(e) => setForm({ ...form, guestPhone: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Guests"><Input type="number" min="1" value={form.guests} onChange={(e) => setForm({ ...form, guests: Number(e.target.value) || 1 })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nights"><Input type="number" min="1" value={form.nights} onChange={(e) => setForm({ ...form, nights: Number(e.target.value) || 1 })} /></Field>
          <Field label="Rate per night" hint="Blank uses the room type's rate">
            <Input type="number" min="0" value={form.rate || ""} onChange={(e) => setForm({ ...form, rate: Number(e.target.value) || 0 })} placeholder={String(target.rate)} />
          </Field>
        </div>

        <div className="rounded-ctl bg-surface-2 border border-line px-3 py-2.5 space-y-1">
          <div className="flex justify-between text-[12px] text-t2"><span>{fmtDate(target.night)} → {fmtDate(checkOut)}</span><span>{Math.max(1, form.nights)} night{form.nights === 1 ? "" : "s"}</span></div>
          <div className="flex justify-between items-center pt-1 border-t border-line">
            <span className="text-[13px] font-semibold text-t1">Room total</span>
            <span className="font-mono font-semibold text-[16px] text-primary tabular-nums">{fmtMoney(rate * Math.max(1, form.nights), currency)}</span>
          </div>
        </div>

        <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-ctl bg-surface-2 border border-line cursor-pointer">
          <input type="checkbox" checked={form.checkInNow} onChange={(e) => setForm({ ...form, checkInNow: e.target.checked })} className="w-4 h-4 accent-primary" />
          <span className="text-[13px] text-t1">The guest is standing here — check them in now</span>
        </label>

        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Booking…" : "Confirm booking"}</Button>
      </form>
    </Modal>
  );
}

// ── The folio ────────────────────────────────────────────────────────

function FolioModal({ stayId, currency, onClose, onChanged }: {
  stayId: string | null; currency: string; onClose: () => void; onChanged: () => void;
}) {
  const { data, loading, reload } = useApi<{ stay: Stay }>(stayId ? `/hotel/stays/${stayId}` : null, [stayId]);
  const { data: pd } = useApi<{ products: Product[] }>(stayId ? "/products" : null, [stayId]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [charge, setCharge] = useState({ productId: "", source: "kitchen", qty: 1 });
  const [method, setMethod] = useState<"cash" | "pos" | "transfer">("cash");

  const stay = data?.stay;
  const products = pd?.products || [];

  async function act(path: string, body?: any) {
    setBusy(true); setError("");
    try {
      const r = await api<{ saleNo?: string }>(`/hotel/stays/${stayId}${path}`, {
        method: "POST", body: JSON.stringify(body || {}),
      });
      if (r.saleNo) alert(`Checked out. Receipt ${r.saleNo}`);
      reload(); onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!stayId) return null;

  return (
    <Modal open={!!stayId} onClose={onClose} title={stay ? `Room ${stay.roomNumber} · ${stay.guestName}` : "Folio"} subtitle={stay?.folioNo} wide>
      {loading || !stay ? (
        <div className="py-10"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <ErrorBanner message={error} />

          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={stay.status === "checked_in" ? "success" : stay.status === "booked" ? "warning" : "neutral"}>
              {stay.status.replace("_", " ")}
            </Badge>
            <span className="text-[12px] text-t3">{stay.checkIn} → {stay.checkOut} · {stay.nights} night{stay.nights === 1 ? "" : "s"} · {stay.roomTypeName}</span>
          </div>

          <div className="rounded-ctl border border-line overflow-hidden max-h-64 overflow-y-auto">
            {stay.charges.map((c, i) => {
              const Icon = SOURCE_ICON[c.source] || Package;
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-line last:border-0">
                  <Icon className="w-3.5 h-3.5 text-t4 shrink-0" />
                  <span className="text-[12.5px] text-t1 flex-1 truncate">{c.name}</span>
                  {c.qty > 1 && <span className="text-[11px] text-t3 font-mono">×{c.qty}</span>}
                  <span className="text-[12.5px] font-mono font-semibold text-t1 tabular-nums w-24 text-right">{fmtMoney(c.lineNet, currency)}</span>
                </div>
              );
            })}
          </div>

          <div className="rounded-ctl bg-surface-2 border border-line px-4 py-3 space-y-1.5">
            <FolioRow label="Subtotal" value={fmtMoney(stay.subtotal, currency)} />
            {stay.vat > 0 && <FolioRow label="VAT" value={fmtMoney(stay.vat, currency)} />}
            <div className="pt-1.5 border-t border-line"><FolioRow label="Total" value={fmtMoney(stay.total, currency)} bold /></div>
            {stay.paid > 0 && <FolioRow label="Paid" value={`−${fmtMoney(stay.paid, currency)}`} tone="text-success" />}
            <FolioRow label="Balance" value={fmtMoney(stay.balance, currency)} bold tone={stay.balance > 0 ? "text-warning" : "text-success"} />
          </div>

          {stay.status === "checked_in" && (
            <div className="flex gap-2 items-end flex-wrap">
              <Field label="Post a charge" className="flex-1 min-w-[180px]">
                <Select value={charge.productId} onChange={(e) => setCharge({ ...charge, productId: e.target.value })}>
                  <option value="">Choose an item…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.price, currency)}</option>)}
                </Select>
              </Field>
              <Select value={charge.source} onChange={(e) => setCharge({ ...charge, source: e.target.value })} className="!w-32">
                <option value="kitchen">Kitchen</option>
                <option value="bar">Bar</option>
                <option value="laundry">Laundry</option>
                <option value="extras">Extras</option>
              </Select>
              <Input type="number" min="1" value={charge.qty} onChange={(e) => setCharge({ ...charge, qty: Number(e.target.value) || 1 })} className="!w-20" />
              <Button
                variant="secondary"
                disabled={!charge.productId || busy}
                onClick={() => act("/charge", { productId: charge.productId, source: charge.source, qty: charge.qty })}
              >
                <Plus className="w-4 h-4" /> Post
              </Button>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {stay.status === "booked" && (
              <>
                <Button onClick={() => act("/check-in")} disabled={busy}><LogIn className="w-4 h-4" /> Check in</Button>
                <Button variant="secondary" onClick={() => act("/cancel")} disabled={busy}><Ban className="w-4 h-4" /> Cancel</Button>
              </>
            )}
            {stay.status === "checked_in" && (
              <>
                <Select value={method} onChange={(e) => setMethod(e.target.value as any)} className="!w-32">
                  <option value="cash">Cash</option>
                  <option value="pos">POS</option>
                  <option value="transfer">Transfer</option>
                </Select>
                <Button variant="success" onClick={() => act("/check-out", { payments: stay.balance > 0 ? [{ method, amount: stay.balance }] : [] })} disabled={busy}>
                  <LogOut className="w-4 h-4" /> Check out · {fmtMoney(stay.balance, currency)}
                </Button>
              </>
            )}
            {stay.status === "checked_out" && (
              <span className="inline-flex items-center gap-2 text-[12px] text-success font-semibold">
                <Receipt className="w-4 h-4" /> Settled — the room is waiting on housekeeping
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function FolioRow({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className={cn("text-[12px]", bold ? "font-semibold text-t1" : "text-t2")}>{label}</span>
      <span className={cn("font-mono tabular-nums", bold ? "text-[15px] font-semibold" : "text-[12px]", tone || "text-t1")}>{value}</span>
    </div>
  );
}
