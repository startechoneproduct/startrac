import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, CheckCircle2, Circle, ListChecks, LogIn, LogOut, Megaphone, Plus, ShoppingCart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ProductTour, tourSeen, markTourSeen } from "@/components/tour/ProductTour";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { buildStaffHomeTour } from "@/lib/tourSteps";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const STAFF_TOUR_KEY = "staffhome-v1";

type Task = {
  id: string; title: string; notes: string; priority: "low" | "medium" | "high";
  status: "open" | "done"; createdByName: string; at: string;
};
type RosterEntry = { id: string; date: string; shiftName: string; start: string; end: string };
type Announcement = { id: string; title: string; body: string; postedByName: string; at: string };
type Attendance = { id: string; clockIn: string; clockOut: string | null; hours: number };

const PRIORITY_TONE: Record<Task["priority"], "danger" | "warning" | "neutral"> = {
  high: "danger", medium: "warning", low: "neutral",
};

export function StaffHome() {
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (tourSeen(STAFF_TOUR_KEY)) return;
    const t = setTimeout(() => setTourOpen(true), 700);
    return () => clearTimeout(t);
  }, []);
  function closeTour() {
    markTourSeen(STAFF_TOUR_KEY);
    setTourOpen(false);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto space-y-5">
      <Header onTakeTour={() => setTourOpen(true)} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TasksCard className="lg:col-span-2" />
        <ScheduleCard />
      </div>
      <AnnouncementsCard />
      <ProductTour steps={buildStaffHomeTour()} open={tourOpen} onClose={closeTour} />
    </div>
  );
}

function Header({ onTakeTour }: { onTakeTour: () => void }) {
  const { session, activeBranch, hasFeature } = useSession();
  const navigate = useNavigate();
  // Clocking in is a Pro feature; on Freemium the screen simply doesn't offer it.
  const canClock = hasFeature("attendance");
  const mine = useApi<{ attendance: Attendance | null }>(canClock ? "/attendance/today" : null, [activeBranch?.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const my = mine.data?.attendance;
  const clockedIn = !!my && !my.clockOut;

  async function punch(action: "clock-in" | "clock-out") {
    setBusy(true); setError("");
    try {
      await api(`/attendance/${action}`, { method: "POST", body: JSON.stringify({}) });
      mine.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[24px] font-semibold tracking-tight text-t1">
          Welcome back, {session?.user.name.split(" ")[0]}
        </h1>
        <p className="text-[13px] text-t3 mt-1">
          Here's what's happening at {activeBranch?.name || "your branch"} today.
          {my && clockedIn && ` You clocked in at ${fmtTime(my.clockIn)}.`}
          {my?.clockOut && ` Shift complete — ${my.hours.toFixed(1)}h.`}
        </p>
        {error && <div className="text-[12px] text-danger font-semibold mt-1">{error}</div>}
      </div>
      <div className="flex items-center flex-wrap gap-2 shrink-0">
        <Button variant="secondary" onClick={onTakeTour}><Sparkles className="w-4 h-4" /> Take a tour</Button>
        {canClock && <div data-tour="staffhome-clock" className="flex items-center gap-2">
          {clockedIn ? (
            <Button variant="danger" disabled={busy} onClick={() => punch("clock-out")}>
              <LogOut className="w-4 h-4" /> Clock out
            </Button>
          ) : (
            <Button variant="success" disabled={busy} onClick={() => punch("clock-in")}>
              <LogIn className="w-4 h-4" /> Clock in
            </Button>
          )}
        </div>}
        <Button variant="secondary" onClick={() => navigate("/app/pos")}>
          <ShoppingCart className="w-4 h-4" /> Open Till
        </Button>
      </div>
    </div>
  );
}

function TasksCard({ className }: { className?: string }) {
  const { activeBranch, can } = useSession();
  const [showDone, setShowDone] = useState(false);
  const tasks = useApi<{ tasks: Task[] }>(`/tasks?status=${showDone ? "done" : "open"}`, [activeBranch?.id, showDone]);
  const [adding, setAdding] = useState(false);

  async function toggle(t: Task) {
    await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: t.status === "open" ? "done" : "open" }) });
    tasks.reload();
  }

  return (
    <Card className={cn("p-5", className)} data-tour="staffhome-tasks">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-t1">
          <ListChecks className="w-[18px] h-[18px] text-primary" /> My Tasks
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowDone((v) => !v)} className="text-[11px] font-semibold text-t3 hover:text-t1 transition-colors">
            {showDone ? "Show open" : "Show done"}
          </button>
          {can("staff_mgmt") && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          )}
        </div>
      </div>
      {tasks.loading ? (
        <Spinner />
      ) : !tasks.data?.tasks.length ? (
        <EmptyState
          icon={ListChecks}
          title={showDone ? "Nothing done yet" : "No open tasks"}
          body={showDone ? "Tasks you finish will show up here." : "You're all caught up."}
        />
      ) : (
        <div className="space-y-1">
          {tasks.data.tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-3 p-2.5 rounded-ctl hover:bg-surface-2 transition-colors">
              <button type="button" onClick={() => toggle(t)} className="mt-0.5 shrink-0 text-t3 hover:text-primary transition-colors">
                {t.status === "done" ? <CheckCircle2 className="w-[18px] h-[18px] text-success" /> : <Circle className="w-[18px] h-[18px]" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn("text-[13px] font-semibold text-t1", t.status === "done" && "line-through text-t3")}>{t.title}</div>
                {t.notes && <div className="text-[12px] text-t3 mt-0.5">{t.notes}</div>}
              </div>
              <Badge tone={PRIORITY_TONE[t.priority]} className="capitalize shrink-0">{t.priority}</Badge>
            </div>
          ))}
        </div>
      )}
      <AddTaskModal open={adding} onClose={() => setAdding(false)} onAdded={tasks.reload} />
    </Card>
  );
}

function AddTaskModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/tasks", { method: "POST", body: JSON.stringify({ title, notes, priority }) });
      setTitle(""); setNotes(""); setPriority("medium");
      onAdded();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a task" subtitle="Shared with everyone on shift at this branch">
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Restock front shelves" />
        </Field>
        <Field label="Notes" hint="Optional">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Adding…" : "Add task"}</Button>
      </form>
    </Modal>
  );
}

function ScheduleCard() {
  const { activeBranch } = useSession();
  const roster = useApi<{ roster: RosterEntry[] }>("/staff/roster", [activeBranch?.id]);

  return (
    <Card className="p-5" data-tour="staffhome-schedule">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-t1 mb-3">
        <Calendar className="w-[18px] h-[18px] text-primary" /> My Schedule
      </div>
      {roster.loading ? (
        <Spinner />
      ) : !roster.data?.roster.length ? (
        <EmptyState icon={Calendar} title="Nothing scheduled" body="Your upcoming shifts will show up here." />
      ) : (
        <div className="space-y-3">
          {roster.data.roster.map((r) => {
            const [day, month] = fmtDate(r.date).split(" ");
            return (
              <div key={r.id} className="flex items-center gap-3 border-l-2 border-primary pl-3 py-0.5">
                <div className="text-center w-11 shrink-0">
                  <div className="text-[11px] font-medium text-t3">{month}</div>
                  <div className="text-[18px] font-semibold font-display text-t1 leading-none">{day}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-t1 truncate">{r.shiftName}</div>
                  <div className="text-[12px] text-t3">{r.start} – {r.end}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AnnouncementsCard() {
  const { activeBranch, can } = useSession();
  const announcements = useApi<{ announcements: Announcement[] }>("/announcements", [activeBranch?.id]);
  const [posting, setPosting] = useState(false);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-t1">
          <Megaphone className="w-[18px] h-[18px] text-primary" /> Branch Announcements
        </div>
        {can("staff_mgmt") && (
          <Button size="sm" variant="outline" onClick={() => setPosting(true)}>
            <Plus className="w-3.5 h-3.5" /> Post
          </Button>
        )}
      </div>
      {announcements.loading ? (
        <Spinner />
      ) : !announcements.data?.announcements.length ? (
        <EmptyState icon={Megaphone} title="No announcements yet" body="Anything management posts here shows up for the whole team." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {announcements.data.announcements.map((a) => (
            <div key={a.id} className="p-3 rounded-ctl bg-surface-2 border border-line">
              <div className="text-[13px] font-semibold text-t1">{a.title}</div>
              {a.body && <div className="text-[12px] text-t2 mt-1">{a.body}</div>}
              <div className="text-[11px] text-t4 mt-2">{fmtDateTime(a.at)} · {a.postedByName}</div>
            </div>
          ))}
        </div>
      )}
      <PostAnnouncementModal open={posting} onClose={() => setPosting(false)} onPosted={announcements.reload} />
    </Card>
  );
}

function PostAnnouncementModal({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
      setTitle(""); setBody("");
      onPosted();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Post an announcement" subtitle="Visible to everyone at this branch">
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New POS update tomorrow" />
        </Field>
        <Field label="Details" hint="Optional">
          <TextArea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Posting…" : "Post announcement"}</Button>
      </form>
    </Modal>
  );
}
