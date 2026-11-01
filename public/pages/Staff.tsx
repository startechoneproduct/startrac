import { useState } from "react";
import { UserCog, Plus, KeyRound, Ban, CheckCircle2, Copy, Pencil, Clock, Trash2, CalendarPlus, Network } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { StatCard } from "@/components/ui/StatCard";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { typeMeta } from "@/lib/businessTypes";
import { OrgChart } from "@/components/staff/OrgChart";

type Staff = {
  id: string; userId: string; name: string; email: string; role: string;
  branchId: string | null; branchName: string; hasPin: boolean; status: string; permsOverride: string[];
  shiftId: string | null; shiftName: string;
  // Organizational only — never gates access. See components/staff/OrgChart.tsx.
  position: string; reportsToId: string | null; reportsToName: string;
};
type ShiftRow = { id: string; name: string; start: string; end: string };

const ROLE_TONE: Record<string, "brand" | "success" | "warning" | "neutral"> = {
  owner: "brand", admin: "success", manager: "warning", staff: "neutral",
};

export function Staff() {
  const { session, activeBusiness, activeBranch, branchesForActive, can } = useSession();
  // Default to the team at the selected branch; owners can widen to everyone.
  const [allBranches, setAllBranches] = useState(false);
  const { data, loading, reload } = useApi<{ staff: Staff[] }>(allBranches ? "/staff?scope=all" : "/staff", []);
  const { data: shiftData, reload: reloadShifts } = useApi<{ shifts: ShiftRow[] }>("/staff/shifts", []);
  const shifts = shiftData?.shifts || [];
  const { data: settingsData } = useApi<{ business: { code: string } }>(can("settings") ? "/settings" : null, []);
  const staff = data?.staff || [];
  const paged = usePaged(staff);
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const [editFor, setEditFor] = useState<Staff | null>(null);
  const [rosterFor, setRosterFor] = useState<Staff | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = settingsData?.business.code;
  const positions = typeMeta(activeBusiness?.typeKey).positions;

  const activeCount = staff.filter((s) => s.status === "active").length;
  const suspendedCount = staff.filter((s) => s.status === "inactive").length;
  const onShiftCount = staff.filter((s) => !!s.shiftId).length;

  async function toggleStatus(s: Staff) {
    const next = s.status === "active" ? "inactive" : "active";
    if (next === "inactive" && !confirm(`Suspend ${s.name}? They lose access immediately (PIN included).`)) return;
    await api(`/staff/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    reload();
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Staff"
        subtitle="Roles decide what each person can see and do — enforced by the server"
        actions={
          <>
            <Button variant="secondary" onClick={() => setChartOpen(true)}><Network className="w-4 h-4" /> Org chart</Button>
            <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add staff</Button>
          </>
        }
      />

      {branchesForActive.length > 1 && activeBranch && (
        <div className="flex items-center gap-2 mb-4 text-[13px] text-t2">
          <span>
            Showing the team at <b className="text-t1">{allBranches ? "every branch" : activeBranch.name}</b>
            {!allBranches && <span className="text-t3"> (plus owners/admins who cover all branches)</span>}
          </span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAllBranches((v) => !v)}>
            {allBranches ? `Only ${activeBranch.name}` : "Show all branches"}
          </Button>
        </div>
      )}

      {code && (
        <div className="flex items-center gap-3 px-4 py-3 mb-4 rounded-card bg-primary-softer border border-line">
          <KeyRound className="w-4 h-4 text-primary shrink-0" />
          <div className="text-[13px] text-t2">
            Till login code for this business: <span className="font-mono font-semibold text-primary tracking-[0.2em]">{code}</span>
            <span className="text-t3"> — staff enter it once on the till, then sign in with just their PIN.</span>
          </div>
          <Button size="sm" variant="secondary" className="ml-auto shrink-0" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            <Copy className="w-3.5 h-3.5" /> {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-5">
            <StatCard index={0} label="Total staff" value={String(staff.length)} icon={UserCog} />
            <StatCard tone="success" index={1} label="Active" value={String(activeCount)} icon={CheckCircle2} />
            <StatCard tone="danger" index={2} label="Suspended" value={String(suspendedCount)} icon={Ban} />
            <StatCard tone="neutral" index={3} label="On a shift" value={String(onShiftCount)} icon={Clock} />
          </div>
          <Card className="overflow-hidden">
            {staff.length === 0 ? (
              <EmptyState icon={UserCog} title="Just you so far" body="Add your first staff member with a role, branch and till PIN." />
            ) : (
              <div className="divide-y divide-line">
                {paged.rows.map((s) => (
                  <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.status === "inactive" ? "opacity-50" : ""}`}>
                    <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-semibold text-[13px] flex items-center justify-center shrink-0">
                      {s.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-t1 truncate">{s.name}</span>
                        <Badge tone={ROLE_TONE[s.role] || "neutral"} className="capitalize">{s.role}</Badge>
                        {s.position && <Badge tone="brand">{s.position}</Badge>}
                        {s.status === "inactive" && <Badge tone="danger">suspended</Badge>}
                        {s.userId === session?.user.id && <Badge tone="neutral">you</Badge>}
                      </div>
                      <div className="text-[11px] text-t3 truncate">
                        {s.branchName}{s.shiftName ? ` · ${s.shiftName}` : ""}{s.reportsToName ? ` · reports to ${s.reportsToName}` : ""}
                        {s.email ? ` · ${s.email}` : " · till-only (PIN)"}{s.hasPin ? "" : " · no PIN set"}
                      </div>
                    </div>
                    {s.role !== "owner" && (
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <Button size="sm" variant="secondary" onClick={() => setEditFor(s)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                        <Button size="sm" variant="secondary" onClick={() => setPinFor(s)}><KeyRound className="w-3.5 h-3.5" /> PIN</Button>
                        <Button size="sm" variant="secondary" onClick={() => setRosterFor(s)}><CalendarPlus className="w-3.5 h-3.5" /> Assign shift</Button>
                        <Button size="sm" variant={s.status === "active" ? "secondary" : "success"} onClick={() => toggleStatus(s)}>
                          {s.status === "active" ? <><Ban className="w-3.5 h-3.5" /> Suspend</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Restore</>}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Pager {...paged} onPage={paged.setPage} noun="staff" />
          </Card>
        </>
      )}

      <ShiftsCard shifts={shifts} onChanged={() => { reloadShifts(); reload(); }} />

      <AddStaff
        open={adding}
        branches={branchesForActive}
        defaultBranchId={activeBranch?.id || ""}
        staff={staff}
        positions={positions}
        isOwner={can("*")}
        onClose={() => setAdding(false)}
        onSaved={() => { setAdding(false); reload(); }}
      />
      <ResetPin staff={pinFor} onClose={() => setPinFor(null)} onSaved={() => { setPinFor(null); reload(); }} />
      <EditStaff
        key={editFor?.id ?? "edit-closed"}
        staff={editFor}
        branches={branchesForActive}
        shifts={shifts}
        allStaff={staff}
        positions={positions}
        isOwner={can("*")}
        onClose={() => setEditFor(null)}
        onSaved={() => { setEditFor(null); reload(); }}
      />
      <AssignRoster
        key={rosterFor?.id ?? "roster-closed"}
        staff={rosterFor}
        shifts={shifts}
        onClose={() => setRosterFor(null)}
        onSaved={() => setRosterFor(null)}
      />
      <OrgChart open={chartOpen} onClose={() => setChartOpen(false)} />
    </div>
  );
}

function ShiftsCard({ shifts, onChanged }: { shifts: ShiftRow[]; onChanged: () => void }) {
  const [form, setForm] = useState({ name: "", start: "08:00", end: "17:00" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/staff/shifts", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", start: "08:00", end: "17:00" });
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: ShiftRow) {
    if (!confirm(`Delete the "${s.name}" shift? Anyone assigned to it becomes unassigned.`)) return;
    await api(`/staff/shifts/${s.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <Card className="p-5 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-primary" />
        <div className="text-[14px] font-semibold text-t1">Shifts</div>
      </div>
      <div className="text-[12px] text-t3 mb-3">Define work windows, then assign each staff member to one via Edit.</div>
      {error && <div className="px-3 py-2 mb-2 rounded-ctl bg-danger-soft text-danger text-[12px] font-semibold">{error}</div>}
      <div className="space-y-2 mb-3">
        {shifts.length === 0 ? (
          <div className="text-[12px] text-t4 py-2">No shifts yet — add your first below.</div>
        ) : (
          shifts.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-ctl bg-surface-2 border border-line">
              <span className="text-[13px] font-semibold text-t1">{s.name}</span>
              <span className="font-mono text-[12px] text-t3">{s.start} – {s.end}</span>
              <button onClick={() => remove(s)} className="ml-auto p-1.5 rounded-lg text-t4 hover:text-danger hover:bg-danger-soft transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
      <form onSubmit={add} className="flex items-end gap-2 flex-wrap">
        <Field label="Shift name" className="flex-1 min-w-[140px]">
          <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Morning" />
        </Field>
        <Field label="Starts" className="w-28">
          <Input required type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
        </Field>
        <Field label="Ends" className="w-28">
          <Input required type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
        </Field>
        <Button type="submit" disabled={busy}><Plus className="w-4 h-4" /> Add shift</Button>
      </form>
    </Card>
  );
}

// Puts one staff member on the roster for one date — a dated booking against
// a shift template, separate from their default shiftId set via Edit.
function AssignRoster({ staff, shifts, onClose, onSaved }: {
  staff: Staff | null; shifts: ShiftRow[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ shiftId: "", date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/staff/roster", {
        method: "POST",
        body: JSON.stringify({ membershipId: staff!.id, shiftId: form.shiftId, date: form.date }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!staff} onClose={onClose} title={`Assign a shift — ${staff?.name}`} subtitle="Adds one dated entry to their schedule">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        {shifts.length === 0 ? (
          <div className="text-[12px] text-t3">No shifts yet — add one below on the Staff page first.</div>
        ) : (
          <>
            <Field label="Shift">
              <Select required value={form.shiftId} onChange={(e) => setForm((f) => ({ ...f, shiftId: e.target.value }))}>
                <option value="">Choose…</option>
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
              </Select>
            </Field>
            <Field label="Date">
              <Input required type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Assigning…" : "Assign shift"}</Button>
          </>
        )}
      </form>
    </Modal>
  );
}

function AddStaff({ open, branches, defaultBranchId, staff, positions, isOwner, onClose, onSaved }: {
  open: boolean; branches: { id: string; name: string }[]; defaultBranchId: string; staff: Staff[]; positions: string[];
  isOwner: boolean; onClose: () => void; onSaved: () => void;
}) {
  // New people start in the branch you're looking at.
  const [form, setForm] = useState({ name: "", role: "staff", branchId: defaultBranchId, pin: "", email: "", position: "", reportsToId: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/staff", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          branchId: form.branchId || undefined,
          email: form.email || undefined,
          reportsToId: form.reportsToId || undefined,
        }),
      });
      setForm({ name: "", role: "staff", branchId: defaultBranchId, pin: "", email: "", position: "", reportsToId: "" });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a staff member" subtitle="They sign in at the till with the business code + this PIN">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Full name"><Input autoFocus required value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={form.role} onChange={(e) => set("role", e.target.value)}>
              <option value="staff">Staff — sells only</option>
              <option value="manager">Manager — runs a branch</option>
              {isOwner && <option value="admin">Admin — runs the business</option>}
            </Select>
          </Field>
          <Field label="Branch">
            <Select value={form.branchId} onChange={(e) => set("branchId", e.target.value)} required={form.role !== "admin"}>
              <option value="">{form.role === "admin" ? "All branches" : "Choose…"}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Till PIN" hint="Exactly 4 digits, keep it secret">
            <Input required inputMode="numeric" pattern="\d{4}" maxLength={4} value={form.pin} onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} placeholder="4321" />
          </Field>
          <Field label="Email" hint="Optional — for full logins">
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Position" hint="Just a label — doesn't change what they can do">
            {positions.length > 0 ? (
              <Select value={form.position} onChange={(e) => set("position", e.target.value)}>
                <option value="">None</option>
                {positions.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            ) : (
              <Input value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="e.g. Supervisor" />
            )}
          </Field>
          <Field label="Reports to" hint="Optional — for the org chart">
            <Select value={form.reportsToId} onChange={(e) => set("reportsToId", e.target.value)}>
              <option value="">No one / top of chart</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.position ? ` — ${s.position}` : ""}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Adding…" : "Add staff member"}</Button>
      </form>
    </Modal>
  );
}

function EditStaff({ staff, branches, shifts, allStaff, positions, isOwner, onClose, onSaved }: {
  staff: Staff | null; branches: { id: string; name: string }[]; shifts: ShiftRow[]; allStaff: Staff[];
  positions: string[]; isOwner: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: staff?.name || "",
    role: staff?.role || "staff",
    branchId: staff?.branchId || "",
    shiftId: staff?.shiftId || "",
    position: staff?.position || "",
    reportsToId: staff?.reportsToId || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Can't report to yourself, and offering a direct/indirect report as your
  // own boss just invites the server's cycle check to reject it — filter
  // the obvious case (self) here; anything deeper the server still catches.
  const reportsToOptions = allStaff.filter((s) => s.id !== staff?.id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/staff/${staff!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name, role: form.role, branchId: form.branchId || null, shiftId: form.shiftId || null,
          position: form.position, reportsToId: form.reportsToId || null,
        }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open={!!staff} onClose={onClose} title={`Edit ${staff?.name}`} subtitle="Role and branch changes apply on their next request — and are audited">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Full name"><Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="staff">Staff — sells only</option>
              <option value="manager">Manager — runs a branch</option>
              {isOwner && <option value="admin">Admin — runs the business</option>}
            </Select>
          </Field>
          <Field label="Branch">
            <Select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} required={form.role !== "admin"}>
              <option value="">{form.role === "admin" ? "All branches" : "Choose…"}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Shift" hint="Optional — manage shifts at the bottom of the Staff page">
          <Select value={form.shiftId} onChange={(e) => setForm((f) => ({ ...f, shiftId: e.target.value }))}>
            <option value="">No shift</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Position" hint="Just a label — doesn't change what they can do">
            {positions.length > 0 ? (
              <Select value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}>
                <option value="">None</option>
                {positions.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            ) : (
              <Input value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Supervisor" />
            )}
          </Field>
          <Field label="Reports to" hint="Optional — for the org chart">
            <Select value={form.reportsToId} onChange={(e) => setForm((f) => ({ ...f, reportsToId: e.target.value }))}>
              <option value="">No one / top of chart</option>
              {reportsToOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.position ? ` — ${s.position}` : ""}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </form>
    </Modal>
  );
}

function ResetPin({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/staff/${staff!.id}/pin`, { method: "POST", body: JSON.stringify({ pin }) });
      setPin("");
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!staff} onClose={onClose} title={`Reset PIN — ${staff?.name}`} subtitle="The old PIN stops working immediately. This is logged.">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="New PIN">
          <Input autoFocus required inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Resetting…" : "Reset PIN"}</Button>
      </form>
    </Modal>
  );
}
