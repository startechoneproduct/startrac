import { useMemo, useState } from "react";
import {
  GraduationCap, Plus, Search, Users, Wallet, ClipboardCheck, ArrowLeft, Award, CalendarDays,
  UserPlus, BookOpen, AlertTriangle, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { MethodPicker, Meter, SectionTitle, Tabs, Tile, PersonFields, type PayMethod } from "@/components/services/ServiceKit";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { fmtDate, fmtMoney, todayStr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Course = {
  id: string; name: string; category: string; level: string; mode: string;
  durationWeeks: number; fee: number; description: string; active: boolean;
};
type Intake = {
  id: string; courseId: string; courseName: string; name: string; startDate: string; endDate: string;
  schedule: string; tutor: string; mode: string; capacity: number; fee: number; plannedSessions: number;
  status: "upcoming" | "running" | "completed" | "cancelled"; seatsTaken: number; expected: number; collected: number;
};
type Payment = { saleId: string; saleNo: string; amount: number; method: string; at: string; byName: string; reversed: boolean };
type Enrollment = {
  id: string; intakeId: string; intakeName: string; courseName: string; customerId: string;
  studentName: string; studentPhone: string; listFee: number; discount: number; fee: number; amountPaid: number;
  balance: number; payments: Payment[]; status: "enrolled" | "completed" | "dropped"; certificateIssued: boolean;
  note: string; enrolledAt: string; sessionsHeld?: number; sessionsAttended?: number;
};
type Session = { id: string; date: string; topic: string; tutor: string; present: number; total: number; presentIds: string[] };
type Overview = {
  students: { active: number; enrolments: number; completed: number; dropped: number; newThisWeek: number; completionRate: number | null };
  fees: {
    billed: number; collected: number; outstanding: number; collectionRate: number | null; revenue30d: number;
    payments30d: number; owingCount: number;
    topOwing: { id: string; studentName: string; phone: string; courseName: string; intakeName: string; balance: number }[];
  };
  attendance: { rate30d: number | null; sessions30d: number };
  classes: { id: string; name: string; courseName: string; status: string; startDate: string; tutor: string; capacity: number; seatsTaken: number; fillPct: number }[];
  byCourse: { course: string; students: number; billed: number; collected: number }[];
};

const STATUS_TONE: Record<string, "brand" | "success" | "warning" | "danger" | "neutral"> = {
  upcoming: "brand", running: "success", completed: "neutral", cancelled: "danger",
  enrolled: "success", dropped: "danger",
};

type Tab = "overview" | "classes" | "students" | "courses";

export function Academy() {
  const { can, currency, activeBranch } = useSession();
  const canSeeOverview = can("dashboard_ops");
  const canManage = can("prices");
  const [tab, setTab] = useState<Tab>(canSeeOverview ? "overview" : "classes");
  const [openIntake, setOpenIntake] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<{ id: string; name: string; balance: number } | null>(null);
  const [rev, setRev] = useState(0); // bumped after a payment so the Overview re-reads

  const tabs: { key: Tab; label: string }[] = [
    ...(canSeeOverview ? [{ key: "overview" as Tab, label: "Overview" }] : []),
    { key: "classes", label: "Classes" },
    { key: "students", label: "Students" },
    { key: "courses", label: "Courses" },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Academy"
        subtitle={`${activeBranch?.name || ""} · courses, classes, students and fees`}
      />
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setOpenIntake(null); }} />

      {tab === "overview" && (
        <OverviewTab
          currency={currency}
          rev={rev}
          onOpenClass={(id) => { setTab("classes"); setOpenIntake(id); }}
          onPay={setPayFor}
        />
      )}
      {tab === "classes" && (
        openIntake
          ? <ClassDetail id={openIntake} currency={currency} canManage={canManage} onBack={() => setOpenIntake(null)} />
          : <ClassesTab currency={currency} canManage={canManage} onOpen={setOpenIntake} />
      )}
      {tab === "students" && <StudentsTab currency={currency} />}
      {tab === "courses" && <CoursesTab currency={currency} canManage={canManage} />}

      {payFor && (
        <PayModal
          title={`Take a payment — ${payFor.name}`}
          balance={payFor.balance}
          currency={currency}
          path={`/academy/enrollments/${payFor.id}/payments`}
          onClose={() => setPayFor(null)}
          onDone={() => { setPayFor(null); setRev((n) => n + 1); }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

function OverviewTab({ currency, rev, onOpenClass, onPay }: {
  currency: string; rev: number; onOpenClass: (id: string) => void;
  onPay: (p: { id: string; name: string; balance: number }) => void;
}) {
  const { data, loading, error } = useApi<Overview>("/academy/overview", [rev]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  const { students, fees, attendance, classes, byCourse } = data;
  const empty = !students.enrolments && !classes.length;

  if (empty) {
    return (
      <Card>
        <EmptyState
          icon={GraduationCap}
          title="Your academy is ready to fill"
          body="Add your courses, schedule a class, then enrol students — this page will track fees, seats and attendance as you go."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <Tile label="Active students" value={students.active} hint={`${students.newThisWeek} new this week`} />
        <Tile label="Fees collected" value={fmtMoney(fees.collected, currency)} hint={fees.collectionRate !== null ? `${fees.collectionRate}% of ${fmtMoney(fees.billed, currency)} billed` : undefined} />
        <Tile label="Fees outstanding" value={fmtMoney(fees.outstanding, currency)} tone={fees.outstanding > 0 ? "warning" : "success"} hint={`${fees.owingCount} student${fees.owingCount === 1 ? "" : "s"} owing`} />
        <Tile label="Income, last 30 days" value={fmtMoney(fees.revenue30d, currency)} hint={`${fees.payments30d} payments`} />
        <Tile label="Attendance, 30 days" value={attendance.rate30d !== null ? `${attendance.rate30d}%` : "—"} tone={attendance.rate30d !== null && attendance.rate30d < 70 ? "warning" : undefined} hint={`${attendance.sessions30d} classes held`} />
        <Tile label="Completion rate" value={students.completionRate !== null ? `${students.completionRate}%` : "—"} hint={`${students.completed} finished · ${students.dropped} dropped`} />
        <Tile label="Open classes" value={classes.length} />
        <Tile label="Enrolments" value={students.enrolments} hint="currently learning" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <SectionTitle>Who owes the most</SectionTitle>
          <Card className="overflow-hidden">
            {fees.topOwing.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-t4">Every student is paid up.</div>
            ) : (
              <div className="divide-y divide-line">
                {fees.topOwing.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-t1 truncate">{o.studentName}</div>
                      <div className="text-[11px] text-t3 truncate">{o.courseName}{o.phone ? ` · ${o.phone}` : ""}</div>
                    </div>
                    <div className="font-mono font-semibold text-[13px] text-warning shrink-0">{fmtMoney(o.balance, currency)}</div>
                    <Button size="sm" variant="secondary" onClick={() => onPay({ id: o.id, name: o.studentName, balance: o.balance })}>
                      <Wallet className="w-3.5 h-3.5" /> Pay
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {fees.owingCount > fees.topOwing.length && (
            <p className="text-[11px] text-t4 mt-1.5">Showing the top {fees.topOwing.length} of {fees.owingCount}. See everyone under Students → Owing.</p>
          )}
        </div>

        <div>
          <SectionTitle>Open classes</SectionTitle>
          <Card className="overflow-hidden">
            {classes.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-t4">No upcoming or running classes.</div>
            ) : (
              <div className="divide-y divide-line">
                {classes.map((c) => (
                  <button key={c.id} onClick={() => onOpenClass(c.id)} className="w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="text-[13px] font-semibold text-t1 truncate flex-1">{c.name}</div>
                      <Badge tone={STATUS_TONE[c.status]} className="capitalize">{c.status}</Badge>
                    </div>
                    <Meter pct={c.fillPct} tone={c.fillPct >= 100 ? "danger" : c.fillPct >= 80 ? "warning" : "brand"} />
                    <div className="text-[11px] text-t3 mt-1.5">
                      {c.seatsTaken}/{c.capacity} seats · starts {fmtDate(c.startDate)}{c.tutor ? ` · ${c.tutor}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div>
        <SectionTitle>Income by course</SectionTitle>
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {byCourse.map((c) => {
              const pct = c.billed > 0 ? Math.round((c.collected / c.billed) * 100) : 0;
              return (
                <div key={c.course} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="text-[13px] font-semibold text-t1 flex-1 truncate">{c.course}</div>
                    <div className="text-[11px] text-t3 shrink-0">{c.students} student{c.students === 1 ? "" : "s"}</div>
                    <div className="font-mono text-[13px] font-semibold text-t1 w-28 text-right shrink-0">{fmtMoney(c.collected, currency)}</div>
                  </div>
                  <div className="mt-1.5"><Meter pct={pct} tone={pct >= 80 ? "success" : "brand"} /></div>
                  <div className="text-[10.5px] text-t4 mt-1">{pct}% of {fmtMoney(c.billed, currency)} billed</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Classes ───────────────────────── */

function ClassesTab({ currency, canManage, onOpen }: { currency: string; canManage: boolean; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<"open" | "all" | "completed">("open");
  const path = status === "open" ? "/academy/intakes?open=1" : status === "completed" ? "/academy/intakes?status=completed" : "/academy/intakes";
  const { data, loading, reload } = useApi<{ intakes: Intake[] }>(path);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex gap-1.5">
          {([["open", "Open"], ["completed", "Finished"], ["all", "All"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)} className={cn(
              "h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors",
              status === k ? "bg-primary-soft border-brand-400 text-primary" : "border-line-2 text-t3 hover:text-t1"
            )}>{label}</button>
          ))}
        </div>
        {canManage && <Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> Schedule a class</Button>}
      </div>

      {loading && !data ? <Spinner /> : !data?.intakes.length ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title={status === "open" ? "No open classes" : "Nothing here yet"}
            body="A class is one scheduled run of a course — with a start date, a tutor and a number of seats. Students enrol into a class."
            action={canManage ? <Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> Schedule a class</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.intakes.map((i) => {
            const fill = Math.round((i.seatsTaken / i.capacity) * 100);
            const col = i.expected > 0 ? Math.round((i.collected / i.expected) * 100) : 0;
            return (
              <Card key={i.id} interactive className="p-4 cursor-pointer" onClick={() => onOpen(i.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-t1 truncate">{i.name}</div>
                    <div className="text-[11.5px] text-t3 mt-0.5 truncate">{i.tutor || "No tutor yet"} · {i.mode}</div>
                  </div>
                  <Badge tone={STATUS_TONE[i.status]} className="capitalize shrink-0">{i.status}</Badge>
                </div>
                <div className="text-[11.5px] text-t3 mt-3">{fmtDate(i.startDate)}{i.endDate ? ` → ${fmtDate(i.endDate)}` : ""}{i.schedule ? ` · ${i.schedule}` : ""}</div>
                <div className="mt-3 space-y-2">
                  <div>
                    <div className="flex justify-between text-[11px] text-t3 mb-1"><span>Seats</span><span className="font-mono">{i.seatsTaken}/{i.capacity}</span></div>
                    <Meter pct={fill} tone={fill >= 100 ? "danger" : fill >= 80 ? "warning" : "brand"} />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-t3 mb-1"><span>Fees collected</span><span className="font-mono">{fmtMoney(i.collected, currency)} / {fmtMoney(i.expected, currency)}</span></div>
                    <Meter pct={col} tone="success" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {newOpen && <ClassFormModal onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); reload(); }} />}
    </>
  );
}

function ClassFormModal({ onClose, onSaved, courseId: initialCourse }: { onClose: () => void; onSaved: () => void; courseId?: string }) {
  const { data } = useApi<{ courses: Course[] }>("/academy/courses");
  const courses = data?.courses || [];
  const [form, setForm] = useState({
    courseId: initialCourse || "", name: "", startDate: todayStr(), endDate: "", schedule: "", tutor: "",
    capacity: "20", fee: "", plannedSessions: "",
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const course = courses.find((c) => c.id === form.courseId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/academy/intakes", {
        method: "POST",
        body: JSON.stringify({
          courseId: form.courseId,
          name: form.name.trim() || undefined,
          startDate: form.startDate,
          endDate: form.endDate,
          schedule: form.schedule,
          tutor: form.tutor,
          capacity: Number(form.capacity) || 20,
          fee: form.fee === "" ? undefined : Number(form.fee),
          plannedSessions: Number(form.plannedSessions) || 0,
        }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Schedule a class" subtitle="One run of a course — students enrol into this" wide>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Course">
          <Select required value={form.courseId} onChange={(e) => set({ courseId: e.target.value })}>
            <option value="">Choose a course…</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.category}</option>)}
          </Select>
        </Field>
        <Field label="Class name" hint="Leave blank to use the course name and start date">
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. React — Weekend Batch" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Starts"><Input type="date" required value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Ends"><Input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
          <Field label="Seats"><Input type="number" min={1} required value={form.capacity} onChange={(e) => set({ capacity: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tutor"><Input value={form.tutor} onChange={(e) => set({ tutor: e.target.value })} placeholder="Who teaches it" /></Field>
          <Field label="Schedule"><Input value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} placeholder="Mon & Wed, 6–8pm" /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Fee" hint={course ? `Course price is ${course.fee.toLocaleString()} — leave blank to use it` : "Leave blank to use the course price"}>
            <Input type="number" min={0} value={form.fee} onChange={(e) => set({ fee: e.target.value })} />
          </Field>
          <Field label="Planned sessions"><Input type="number" min={0} value={form.plannedSessions} onChange={(e) => set({ plannedSessions: e.target.value })} /></Field>
        </div>
        <Button type="submit" className="w-full" disabled={busy || !form.courseId}>{busy ? "Saving…" : "Schedule class"}</Button>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Class detail ───────────────────────── */

function ClassDetail({ id, currency, canManage, onBack }: { id: string; currency: string; canManage: boolean; onBack: () => void }) {
  const { data, loading, error, reload } = useApi<{ intake: Intake; enrollments: Enrollment[]; sessions: Session[] }>(`/academy/intakes/${id}`);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [attOpen, setAttOpen] = useState(false);
  const [openEnr, setOpenEnr] = useState<Enrollment | null>(null);
  const [statusErr, setStatusErr] = useState("");

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  const { intake, enrollments, sessions } = data;
  const live = enrollments.filter((e) => e.status !== "dropped");
  const closed = intake.status === "completed" || intake.status === "cancelled";

  async function setStatus(status: Intake["status"]) {
    setStatusErr("");
    try { await api(`/academy/intakes/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); reload(); }
    catch (err: any) { setStatusErr(err.message); }
  }

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-t3 hover:text-t1 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> All classes
      </button>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-[18px] font-semibold text-t1">{intake.name}</h2>
            <Badge tone={STATUS_TONE[intake.status]} className="capitalize">{intake.status}</Badge>
          </div>
          <p className="text-[12.5px] text-t3 mt-1">
            {intake.courseName} · {fmtDate(intake.startDate)}{intake.endDate ? ` → ${fmtDate(intake.endDate)}` : ""}
            {intake.schedule ? ` · ${intake.schedule}` : ""}{intake.tutor ? ` · ${intake.tutor}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canManage && (
            <Select value={intake.status} onChange={(e) => setStatus(e.target.value as Intake["status"])} className="!h-9 !w-auto text-[12px]">
              <option value="upcoming">Upcoming</option><option value="running">Running</option>
              <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
            </Select>
          )}
          <Button variant="secondary" onClick={() => setAttOpen(true)} disabled={intake.status === "cancelled" || live.length === 0}>
            <ClipboardCheck className="w-4 h-4" /> Take attendance
          </Button>
          <Button onClick={() => setEnrollOpen(true)} disabled={closed}><UserPlus className="w-4 h-4" /> Enrol student</Button>
        </div>
      </div>
      {statusErr && <div className="mb-4"><ErrorBanner message={statusErr} /></div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <Tile label="Seats" value={`${intake.seatsTaken}/${intake.capacity}`} tone={intake.seatsTaken >= intake.capacity ? "danger" : undefined} />
        <Tile label="Fee per student" value={fmtMoney(intake.fee, currency)} />
        <Tile label="Collected" value={fmtMoney(intake.collected, currency)} tone="success" hint={`of ${fmtMoney(intake.expected, currency)} expected`} />
        <Tile label="Owed" value={fmtMoney(intake.expected - intake.collected, currency)} tone={intake.expected - intake.collected > 0 ? "warning" : "success"}
          hint={`${sessions.length}${intake.plannedSessions ? `/${intake.plannedSessions}` : ""} sessions held`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <SectionTitle>Students</SectionTitle>
          {enrollments.length === 0 ? (
            <Card><EmptyState icon={Users} title="No students yet" body="Enrol the first student and take their deposit in one step." /></Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="divide-y divide-line">
                {enrollments.map((e) => {
                  const att = e.sessionsHeld ? Math.round(((e.sessionsAttended || 0) / e.sessionsHeld) * 100) : null;
                  return (
                    <button key={e.id} onClick={() => setOpenEnr(e)} className={cn("w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors", e.status === "dropped" && "opacity-55")}>
                      <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-semibold text-[13px] flex items-center justify-center shrink-0">{e.studentName[0]?.toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-t1 truncate flex items-center gap-1.5">
                          {e.studentName}
                          {e.certificateIssued && <Award className="w-3.5 h-3.5 text-warning shrink-0" />}
                        </div>
                        <div className="text-[11px] text-t3 mt-0.5">
                          {att !== null ? `${att}% attendance (${e.sessionsAttended}/${e.sessionsHeld})` : "No sessions yet"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[12.5px] text-t1">{fmtMoney(e.amountPaid, currency)} <span className="text-t4">/ {fmtMoney(e.fee, currency)}</span></div>
                        <div className="mt-0.5">
                          {e.status === "dropped" ? <Badge tone="danger">dropped</Badge>
                            : e.balance > 0 ? <Badge tone="warning">owes {fmtMoney(e.balance, currency)}</Badge>
                            : <Badge tone="success">{e.status === "completed" ? "completed" : "paid up"}</Badge>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        <div>
          <SectionTitle>Sessions held</SectionTitle>
          <Card className="overflow-hidden">
            {sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-t4">Nothing recorded yet.</div>
            ) : (
              <div className="divide-y divide-line">
                {sessions.map((s) => (
                  <div key={s.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12.5px] font-semibold text-t1">{fmtDate(s.date)}</div>
                      <div className="text-[11px] font-mono text-t3">{s.present}/{s.total} present</div>
                    </div>
                    {s.topic && <div className="text-[11.5px] text-t3 truncate">{s.topic}</div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {enrollOpen && <EnrollModal intake={intake} currency={currency} onClose={() => setEnrollOpen(false)} onDone={() => { setEnrollOpen(false); reload(); }} />}
      {attOpen && <AttendanceModal intakeId={id} roster={enrollments.filter((e) => e.status !== "dropped")} sessions={sessions} onClose={() => setAttOpen(false)} onDone={() => { setAttOpen(false); reload(); }} />}
      {openEnr && <EnrollmentModal enrollment={openEnr} currency={currency} onClose={() => setOpenEnr(null)} onChanged={reload} />}
    </div>
  );
}

function EnrollModal({ intake, currency, onClose, onDone }: { intake: Intake; currency: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [paying, setPaying] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const disc = Math.min(Number(discount) || 0, intake.fee);
  const fee = intake.fee - disc;
  const pay = Number(paying) || 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pay > fee) { setError(`That's more than the fee (${fmtMoney(fee, currency)}).`); return; }
    setBusy(true); setError("");
    try {
      await api("/academy/enrollments", {
        method: "POST",
        body: JSON.stringify({
          intakeId: intake.id,
          customer: { name: name.trim(), phone: phone.trim() },
          discount: disc,
          ...(pay > 0 ? { payment: { method, amount: pay } } : {}),
        }),
      });
      onDone();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Enrol a student" subtitle={intake.name}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <PersonFields label="Student name" name={name} phone={phone} onName={setName} onPhone={setPhone} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount"><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
          <Field label="Pay now (optional)"><Input type="number" min={0} value={paying} onChange={(e) => setPaying(e.target.value)} placeholder="Deposit" /></Field>
        </div>
        {pay > 0 && <Field label="Payment method"><MethodPicker value={method} onChange={setMethod} /></Field>}
        <div className="rounded-ctl bg-surface-2 border border-line px-3 py-2.5 text-[13px] space-y-1">
          <div className="flex justify-between"><span className="text-t3">Fee</span><span className="font-mono font-semibold">{fmtMoney(fee, currency)}</span></div>
          <div className="flex justify-between"><span className="text-t3">Balance after today</span><span className="font-mono font-semibold text-warning">{fmtMoney(Math.max(0, fee - pay), currency)}</span></div>
        </div>
        <Button type="submit" className="w-full" disabled={busy || !name.trim()}>{busy ? "Enrolling…" : "Enrol student"}</Button>
      </form>
    </Modal>
  );
}

function AttendanceModal({ intakeId, roster, sessions, onClose, onDone }: {
  intakeId: string; roster: Enrollment[]; sessions: Session[]; onClose: () => void; onDone: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const existing = sessions.find((s) => s.date === date);
  const [present, setPresent] = useState<Set<string>>(() => new Set(sessions.find((s) => s.date === todayStr())?.presentIds ?? roster.map((r) => r.id)));
  const [topic, setTopic] = useState(existing?.topic || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Switching the date to one already recorded loads that day, so correcting a
  // register is the same gesture as taking it.
  function changeDate(d: string) {
    setDate(d);
    const found = sessions.find((s) => s.date === d);
    setPresent(new Set(found ? found.presentIds : roster.map((r) => r.id)));
    setTopic(found?.topic || "");
  }
  const toggle = (id: string) => setPresent((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/academy/intakes/${intakeId}/sessions`, { method: "POST", body: JSON.stringify({ date, topic, presentIds: [...present] }) });
      onDone();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Take attendance" subtitle={existing ? "This day is already recorded — saving will correct it" : "Tick who is present"}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" max={todayStr()} required value={date} onChange={(e) => changeDate(e.target.value)} /></Field>
          <Field label="Topic"><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What was taught" /></Field>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-t2">{present.size} of {roster.length} present</span>
          <div className="flex gap-3 text-[12px] font-semibold text-primary">
            <button type="button" onClick={() => setPresent(new Set(roster.map((r) => r.id)))}>All</button>
            <button type="button" onClick={() => setPresent(new Set())}>None</button>
          </div>
        </div>
        <div className="rounded-ctl border border-line divide-y divide-line max-h-72 overflow-y-auto">
          {roster.map((r) => (
            <label key={r.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-2">
              <input type="checkbox" checked={present.has(r.id)} onChange={() => toggle(r.id)} className="w-4 h-4 accent-[var(--st-primary)]" />
              <span className="text-[13px] text-t1">{r.studentName}</span>
            </label>
          ))}
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : existing ? "Update register" : "Save attendance"}</Button>
      </form>
    </Modal>
  );
}

/* ───────────────────────── One student's account ───────────────────────── */

function EnrollmentModal({ enrollment, currency, onClose, onChanged }: {
  enrollment: Enrollment; currency: string; onClose: () => void; onChanged: () => void;
}) {
  const { can } = useSession();
  const [e, setE] = useState(enrollment);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(enrollment.note);

  async function patch(body: Record<string, unknown>) {
    setError(""); setBusy(true);
    try {
      const r = await api<{ enrollment: Enrollment }>(`/academy/enrollments/${e.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setE({ ...e, ...r.enrollment, sessionsHeld: e.sessionsHeld, sessionsAttended: e.sessionsAttended });
      onChanged();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function reverse() {
    if (!reversing) return;
    setError(""); setBusy(true);
    try {
      const r = await api<{ enrollment: Enrollment }>(`/academy/enrollments/${e.id}/payments/${reversing.saleId}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
      setE({ ...e, ...r.enrollment });
      setReversing(null); setReason("");
      onChanged();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Modal open onClose={onClose} title={e.studentName} subtitle={`${e.courseName} · ${e.intakeName}`} wide>
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-ctl bg-surface-2 border border-line py-2.5"><div className="text-[11.5px] font-medium text-t4">Fee</div><div className="font-mono font-semibold text-[14px]">{fmtMoney(e.fee, currency)}</div>{e.discount > 0 && <div className="text-[10px] text-t4">after {fmtMoney(e.discount, currency)} off</div>}</div>
            <div className="rounded-ctl bg-surface-2 border border-line py-2.5"><div className="text-[11.5px] font-medium text-t4">Paid</div><div className="font-mono font-semibold text-[14px] text-success">{fmtMoney(e.amountPaid, currency)}</div></div>
            <div className="rounded-ctl bg-surface-2 border border-line py-2.5"><div className="text-[11.5px] font-medium text-t4">Balance</div><div className={cn("font-mono font-semibold text-[14px]", e.balance > 0 ? "text-warning" : "text-success")}>{fmtMoney(e.balance, currency)}</div></div>
          </div>

          <div>
            <SectionTitle action={e.status !== "dropped" && e.balance > 0 ? <Button size="sm" onClick={() => setPaying(true)}><Wallet className="w-3.5 h-3.5" /> Take payment</Button> : undefined}>Payments</SectionTitle>
            {e.payments.length === 0 ? (
              <div className="text-[12px] text-t4 py-3">Nothing paid yet.</div>
            ) : (
              <div className="rounded-ctl border border-line divide-y divide-line">
                {e.payments.map((p) => (
                  <div key={p.saleId} className={cn("flex items-center gap-3 px-3 py-2.5", p.reversed && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[13px] font-semibold", p.reversed && "line-through")}>{fmtMoney(p.amount, currency)} <span className="text-t3 font-normal capitalize">· {p.method}</span></div>
                      <div className="text-[11px] text-t4">{fmtDate(p.at)} · {p.saleNo} · {p.byName}</div>
                    </div>
                    {p.reversed ? <Badge tone="danger">reversed</Badge>
                      : can("void_sales") && <button onClick={() => { setReversing(p); setReason(""); }} className="text-[11px] font-semibold text-danger hover:underline">Reverse</button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Field label="Note"><TextArea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} onBlur={() => note !== e.note && patch({ note })} placeholder="Anything worth remembering about this student" /></Field>

          <div className="flex flex-wrap gap-2 pt-1">
            {e.status === "enrolled" && <Button variant="success" size="sm" disabled={busy} onClick={() => patch({ status: "completed" })}><Award className="w-3.5 h-3.5" /> Mark course complete</Button>}
            {e.status === "completed" && !e.certificateIssued && <Button size="sm" disabled={busy} onClick={() => patch({ certificateIssued: true })}><Award className="w-3.5 h-3.5" /> Issue certificate</Button>}
            {e.status === "completed" && e.certificateIssued && <Badge tone="success"><Award className="w-3 h-3" /> Certificate issued</Badge>}
            {e.status !== "dropped" && <Button variant="outline" size="sm" disabled={busy} onClick={() => patch({ status: "dropped" })}>Drop from class</Button>}
            {e.status === "dropped" && <Button variant="outline" size="sm" disabled={busy} onClick={() => patch({ status: "enrolled" })}>Reinstate</Button>}
          </div>
          {e.status === "dropped" && <p className="text-[11.5px] text-t3">Dropped students free their seat. What they paid is kept; the unpaid balance is written off. Use Reverse above to refund a payment.</p>}
        </div>
      </Modal>

      {paying && (
        <PayModal
          title={`Take a payment — ${e.studentName}`} balance={e.balance} currency={currency}
          path={`/academy/enrollments/${e.id}/payments`}
          onClose={() => setPaying(false)}
          onDone={(r) => { setPaying(false); if (r?.enrollment) setE({ ...e, ...r.enrollment }); onChanged(); }}
        />
      )}
      {reversing && (
        <Modal open onClose={() => setReversing(null)} title="Reverse this payment?" subtitle={`${fmtMoney(reversing.amount, currency)} · ${reversing.saleNo}`}>
          <div className="space-y-3">
            <ErrorBanner message={error} />
            <p className="text-[12.5px] text-t3">The money comes off today's books and the student's balance goes back up. The original receipt stays on record, marked reversed.</p>
            <Field label="Reason"><Input autoFocus value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Entered twice / refunded" /></Field>
            <Button variant="danger" className="w-full" disabled={busy || reason.trim().length < 3} onClick={reverse}>{busy ? "Reversing…" : "Reverse payment"}</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function PayModal({ title, balance, currency, path, onClose, onDone }: {
  title: string; balance: number; currency: string; path: string; onClose: () => void;
  onDone: (r?: { enrollment?: Enrollment }) => void;
}) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PayMethod>("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api<{ enrollment?: Enrollment }>(path, { method: "POST", body: JSON.stringify({ method, amount: Number(amount) }) });
      onDone(r);
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title} subtitle={`Balance ${fmtMoney(balance, currency)}`}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Amount received">
          <Input type="number" min={1} max={balance} step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method"><MethodPicker value={method} onChange={setMethod} /></Field>
        <Button type="submit" className="w-full" disabled={busy || !(Number(amount) > 0)}>{busy ? "Saving…" : `Receive ${fmtMoney(Number(amount) || 0, currency)}`}</Button>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Students ───────────────────────── */

function StudentsTab({ currency }: { currency: string }) {
  const [q, setQ] = useState("");
  const [owing, setOwing] = useState(false);
  const path = `/academy/enrollments?${owing ? "owing=1&" : ""}${q.trim() ? `q=${encodeURIComponent(q.trim())}` : ""}`;
  const { data, loading, reload } = useApi<{ enrollments: Enrollment[] }>(path);
  const [open, setOpen] = useState<Enrollment | null>(null);
  const rows = data?.enrollments || [];

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t4 pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" className="!pl-9" />
        </div>
        <button onClick={() => setOwing((o) => !o)} className={cn(
          "h-9 px-3 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1.5 transition-colors",
          owing ? "bg-warning-soft border-warning/40 text-warning" : "border-line-2 text-t3 hover:text-t1"
        )}><AlertTriangle className="w-3.5 h-3.5" /> Owing only</button>
      </div>
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState icon={Users} title={owing ? "Nobody owes anything" : "No students found"} body={owing ? "Every enrolled student has paid in full." : "Enrol students from inside a class."} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {rows.map((e) => (
              <button key={e.id} onClick={() => setOpen(e)} className={cn("w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-surface-2", e.status === "dropped" && "opacity-55")}>
                <div className="w-9 h-9 rounded-full bg-primary-soft text-primary font-semibold text-[13px] flex items-center justify-center shrink-0">{e.studentName[0]?.toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1 truncate">{e.studentName}</div>
                  <div className="text-[11px] text-t3 truncate">{e.courseName} · {e.intakeName}{e.studentPhone ? ` · ${e.studentPhone}` : ""}</div>
                </div>
                <Badge tone={STATUS_TONE[e.status]} className="capitalize hidden sm:inline-flex">{e.status}</Badge>
                <div className="text-right shrink-0 w-28">
                  <div className="font-mono text-[12.5px]">{fmtMoney(e.amountPaid, currency)}</div>
                  {e.balance > 0 && e.status !== "dropped" ? <div className="text-[11px] text-warning font-semibold">owes {fmtMoney(e.balance, currency)}</div> : <div className="text-[11px] text-success font-semibold">{e.status === "dropped" ? "—" : "paid up"}</div>}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
      {open && <EnrollmentModal enrollment={open} currency={currency} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

/* ───────────────────────── Courses ───────────────────────── */

function CoursesTab({ currency, canManage }: { currency: string; canManage: boolean }) {
  const { data, loading, reload } = useApi<{ courses: Course[] }>("/academy/courses?all=1");
  const [edit, setEdit] = useState<Course | "new" | null>(null);
  const [schedule, setSchedule] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Course[]>();
    for (const c of data?.courses || []) (m.get(c.category) || m.set(c.category, []).get(c.category)!).push(c);
    return [...m.entries()];
  }, [data]);

  return (
    <>
      {canManage && (
        <div className="flex justify-end mb-4"><Button onClick={() => setEdit("new")}><Plus className="w-4 h-4" /> Add a course</Button></div>
      )}
      {loading && !data ? <Spinner /> : groups.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="No courses yet" body="List what you teach — Frontend, Backend, SQL, Excel, Power BI… — with a price for each." action={canManage ? <Button onClick={() => setEdit("new")}><Plus className="w-4 h-4" /> Add a course</Button> : undefined} /></Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, list]) => (
            <div key={cat}>
              <div className="text-[11.5px] font-medium tracking-[0.1em] text-t4 mb-2">{cat}</div>
              <Card className="overflow-hidden">
                <div className="divide-y divide-line">
                  {list.map((c) => (
                    <div key={c.id} className={cn("flex items-center gap-3 px-4 py-3", !c.active && "opacity-50")}>
                      <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-t1 truncate">{c.name} {!c.active && <Badge tone="neutral">archived</Badge>}</div>
                        <div className="text-[11px] text-t3 capitalize">{c.level} · {c.mode} · {c.durationWeeks} weeks</div>
                      </div>
                      <div className="font-mono font-semibold text-[13px] shrink-0">{fmtMoney(c.fee, currency)}</div>
                      {canManage && (
                        <div className="flex gap-1.5 shrink-0">
                          {c.active && <Button size="sm" variant="secondary" onClick={() => setSchedule(c.id)}><CalendarDays className="w-3.5 h-3.5" /> Class</Button>}
                          <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
      {edit && <CourseModal course={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {schedule && <ClassFormModal courseId={schedule} onClose={() => setSchedule(null)} onSaved={() => setSchedule(null)} />}
    </>
  );
}

function CourseModal({ course, onClose, onSaved }: { course: Course | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: course?.name || "", category: course?.category || "", level: course?.level || "beginner", mode: course?.mode || "hybrid",
    durationWeeks: String(course?.durationWeeks ?? 4), fee: String(course?.fee ?? ""), description: course?.description || "",
    active: course?.active ?? true,
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const body = JSON.stringify({
      name: form.name.trim(), category: form.category.trim() || "General", level: form.level, mode: form.mode,
      durationWeeks: Number(form.durationWeeks) || 0, fee: Number(form.fee), description: form.description, active: form.active,
    });
    try {
      await api(course ? `/academy/courses/${course.id}` : "/academy/courses", { method: course ? "PATCH" : "POST", body });
      onSaved();
    } catch (err: any) {
      setError(err.message); setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={course ? "Edit course" : "Add a course"}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Course name"><Input autoFocus required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Power BI" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Track / category"><Input value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Web, Data, Mobile…" /></Field>
          <Field label="Fee"><Input type="number" min={0} required value={form.fee} onChange={(e) => set({ fee: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Level">
            <Select value={form.level} onChange={(e) => set({ level: e.target.value })}>
              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
            </Select>
          </Field>
          <Field label="Mode">
            <Select value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
              <option value="online">Online</option><option value="physical">Physical</option><option value="hybrid">Hybrid</option>
            </Select>
          </Field>
          <Field label="Weeks"><Input type="number" min={0} value={form.durationWeeks} onChange={(e) => set({ durationWeeks: e.target.value })} /></Field>
        </div>
        <Field label="Description"><TextArea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        {course && (
          <label className="flex items-center gap-2 text-[13px] text-t2 cursor-pointer">
            <input type="checkbox" checked={!form.active} onChange={(e) => set({ active: !e.target.checked })} className="w-4 h-4" />
            Archive this course (hide it from new classes)
          </label>
        )}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : course ? "Save changes" : "Add course"}</Button>
      </form>
    </Modal>
  );
}
