import { useState } from "react";
import { Users, Ban, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pager } from "@/components/ui/Pager";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Avatar, EmptyBlock, PageHeader, Panel, Pill, SearchBox, Segmented } from "./ui";
import { ExportButton } from "./ExportButton";

type Person = {
  id: string; name: string; email: string; phone: string; status: "active" | "suspended";
  platformRole: "none" | "support" | "overseer"; lastLoginAt: string | null; createdAt: string; emailVerified: boolean;
  roles: { role: string; business: string; accountId: string; active: boolean }[];
};
type Kind = "all" | "owner" | "staff" | "platform";

const PER = 15;
const COLS = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.8fr)_150px_100px_112px]";
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", staff: "Staff" };

function lastSeen(at: string | null) {
  if (!at) return "Never signed in";
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 30 ? `${days} days ago` : fmtDate(at);
}

/** Every person with a StarTrack login: owners, their staff and StarTrack's own people. */
export function UsersTab({ canAct, selfEmail }: { canAct: boolean; selfEmail?: string }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState<"all" | "suspended">("all");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Person | null>(null);
  const [version, setVersion] = useState(0);

  const qs = new URLSearchParams({ limit: String(PER), page: String(page) });
  if (q) qs.set("q", q);
  if (kind !== "all") qs.set("kind", kind);
  if (status === "suspended") qs.set("status", "suspended");
  const { data, loading } = useApi<{ users: Person[]; page: number; pages: number; total: number }>(`/platform/users?${qs}`, [version]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto animate-fade-up">
      <PageHeader
        title="People"
        subtitle="Everyone who can sign in: business owners, their staff, and StarTrack's own team."
        actions={
          <>
            <Segmented value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[
              { value: "all", label: "All" }, { value: "owner", label: "Owners" }, { value: "staff", label: "Staff" }, { value: "platform", label: "StarTrack" },
            ]} />
            <Segmented value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "all", label: "Any status" }, { value: "suspended", label: "Suspended" }]} />
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, email or phone…" className="w-60" />
            <ExportButton kind="users" />
          </>
        }
      />

      <Panel flush>
        {loading && !data ? (
          <div className="py-16"><Spinner /></div>
        ) : !data || data.users.length === 0 ? (
          <EmptyBlock icon={Users} title="No one matches" hint={q ? "Try a different search." : "Nothing here yet."} />
        ) : (
          <>
            <div className={`hidden lg:grid ${COLS} gap-4 px-5 h-10 items-center bg-surface-2 border-b border-line text-[11px] font-bold uppercase tracking-[0.1em] text-t4`}>
              <span>Person</span><span>Works at</span><span>Last sign-in</span><span>Status</span><span />
            </div>
            <div className="divide-y divide-line">
              {data.users.map((u) => (
                <div key={u.id} className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-x-4 gap-y-1.5 items-center px-5 py-3.5`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={u.name} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-t1 truncate">{u.name}</span>
                        {u.platformRole !== "none" && <Pill tone="brand">StarTrack {u.platformRole}</Pill>}
                      </div>
                      <div className="text-[12px] text-t3 truncate">{u.email || "Till sign-in only"}{u.phone ? ` · ${u.phone}` : ""}</div>
                    </div>
                  </div>
                  <div className="min-w-0 col-span-2 lg:col-span-1 row-start-2 lg:row-start-auto flex flex-wrap gap-1.5">
                    {u.roles.length === 0 ? <span className="text-[12px] text-t4">No business</span> : u.roles.slice(0, 2).map((r, i) => (
                      <span key={i} className={`inline-flex items-center gap-1.5 max-w-full h-6 px-2 rounded-lg bg-surface-2 border border-line text-[11.5px] ${r.active ? "text-t2" : "text-t4 line-through"}`}>
                        <b className="font-semibold text-t1">{ROLE_LABEL[r.role] || r.role}</b><span className="truncate">{r.business}</span>
                      </span>
                    ))}
                    {u.roles.length > 2 && <span className="text-[11.5px] text-t3 self-center">+{u.roles.length - 2} more</span>}
                  </div>
                  <div className="hidden lg:block text-[12.5px] text-t3" title={u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : undefined}>{lastSeen(u.lastLoginAt)}</div>
                  <div className="hidden lg:block">
                    <Pill tone={u.status === "suspended" ? "danger" : "success"} dot>{u.status === "suspended" ? "Suspended" : "Active"}</Pill>
                  </div>
                  <div className="col-start-2 row-start-1 lg:col-auto lg:row-auto text-right">
                    {canAct && u.email !== selfEmail && (
                      u.status === "suspended"
                        ? <Button size="sm" variant="outline" onClick={() => setTarget(u)}><Play className="w-3.5 h-3.5" /> Restore</Button>
                        : <Button size="sm" variant="ghost" onClick={() => setTarget(u)}><Ban className="w-3.5 h-3.5" /> Suspend</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pager
              page={data.page} pages={data.pages} total={data.total}
              from={(data.page - 1) * PER + 1} to={(data.page - 1) * PER + data.users.length}
              onPage={setPage} noun="people"
            />
          </>
        )}
      </Panel>

      <StatusModal person={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); setVersion((v) => v + 1); }} />
    </div>
  );
}

function StatusModal({ person, onClose, onDone }: { person: Person | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const suspending = person?.status !== "suspended";

  async function save() {
    if (!person) return;
    setBusy(true); setErr("");
    try {
      await api(`/platform/users/${person.id}/status`, { method: "POST", body: JSON.stringify({ status: suspending ? "suspended" : "active", reason }) });
      setReason("");
      onDone();
    } catch (e: any) { setErr(e.message || "Couldn't save"); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!person} onClose={onClose} title={suspending ? `Suspend ${person?.name}?` : `Restore ${person?.name}?`}
      subtitle={suspending ? "They won't be able to sign in until restored. Their business is not affected." : "They will be able to sign in again."}>
      <div className="space-y-4">
        <ErrorBanner message={err} />
        <label className="block text-[12px] font-semibold text-t3">Reason (kept in the activity log)
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={suspending ? "e.g. Reported for misuse" : "e.g. Issue resolved"} className="mt-1" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={suspending ? "danger" : "success"} onClick={save} disabled={busy}>{busy ? "Saving…" : suspending ? "Suspend" : "Restore"}</Button>
        </div>
      </div>
    </Modal>
  );
}
