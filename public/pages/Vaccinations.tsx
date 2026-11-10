import { useState } from "react";
import { Syringe, Pill, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Record_ = {
  id: string; type: "vaccination" | "medication"; name: string; batchLabel: string;
  dosage: string; administeredAt: string; nextDueAt: string | null; notes: string; staffName: string;
};

const TYPE_META = {
  vaccination: { label: "Vaccination", icon: Syringe, tone: "success" as const },
  medication: { label: "Medication", icon: Pill, tone: "warning" as const },
};

// A pure log — no stock, cost or money moves because of a record here. "Next
// due" is kept for reference only; nothing currently reads it back to remind
// anyone, same honest limit as the source spec this was built from.
export function Vaccinations() {
  const { activeBranch, can } = useSession();
  const [filter, setFilter] = useState<"" | "vaccination" | "medication">("");
  const { data, loading, reload } = useApi<{ records: Record_[] }>(
    `/vaccinations${filter ? `?type=${filter}` : ""}`,
    [activeBranch?.id, filter]
  );
  const records = data?.records || [];
  const paged = usePaged(records);
  const [adding, setAdding] = useState(false);

  async function remove(r: Record_) {
    if (!confirm(`Delete this ${TYPE_META[r.type].label.toLowerCase()} record for "${r.name}"?`)) return;
    await api(`/vaccinations/${r.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[900px] mx-auto">
      <PageHeader
        title="Vaccination & Medication"
        subtitle="Dosage records for a flock or batch"
        actions={can("stock") ? <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Record</Button> : undefined}
      />

      <div className="flex gap-1.5 mb-4">
        {(["", "vaccination", "medication"] as const).map((f) => (
          <button
            key={f || "all"}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 h-8 rounded-full text-[12px] font-semibold border transition-colors",
              filter === f ? "bg-primary-soft border-brand-400 text-primary" : "bg-surface-2 border-line-2 text-t3 hover:text-t1"
            )}
          >
            {f ? TYPE_META[f].label + "s" : "All"}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : records.length === 0 ? (
          <EmptyState icon={Syringe} title="Nothing recorded yet" body="Vaccination and medication doses show up here, newest first." />
        ) : (
          <>
            <div className="divide-y divide-line">
              {paged.rows.map((r) => {
                const meta = TYPE_META[r.type];
                const Icon = meta.icon;
                return (
                  <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-3 text-t2 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-t1">{r.name}</span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {r.batchLabel && <Badge tone="neutral">{r.batchLabel}</Badge>}
                      </div>
                      <div className="text-[11px] text-t3 mt-0.5">
                        {r.dosage && `${r.dosage} · `}{fmtDate(r.administeredAt)} · {r.staffName}
                        {r.nextDueAt && ` · next due ${fmtDate(r.nextDueAt)}`}
                      </div>
                      {r.notes && <div className="text-[12px] text-t2 mt-1">{r.notes}</div>}
                    </div>
                    {can("stock") && (
                      <button onClick={() => remove(r)} className="p-1.5 rounded-lg text-t4 hover:text-danger hover:bg-danger-soft transition-colors shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <Pager {...paged} onPage={paged.setPage} noun="records" />
          </>
        )}
      </Card>

      <RecordModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
    </div>
  );
}

function RecordModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    type: "vaccination" as "vaccination" | "medication",
    name: "", batchLabel: "", dosage: "",
    administeredAt: new Date().toISOString().slice(0, 10),
    nextDueAt: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/vaccinations", {
        method: "POST",
        body: JSON.stringify({ ...form, nextDueAt: form.nextDueAt || undefined }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record a dose" subtitle="Vaccination or medication given to a flock or batch">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Type">
          <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
            <option value="vaccination">Vaccination</option>
            <option value="medication">Medication</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input autoFocus required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Newcastle Disease" /></Field>
          <Field label="Batch / flock" hint="Optional"><Input value={form.batchLabel} onChange={(e) => set("batchLabel", e.target.value)} placeholder="Pen 3" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dosage" hint="Optional"><Input value={form.dosage} onChange={(e) => set("dosage", e.target.value)} placeholder="1 drop per bird" /></Field>
          <Field label="Date given"><Input required type="date" value={form.administeredAt} onChange={(e) => set("administeredAt", e.target.value)} /></Field>
        </div>
        <Field label="Next due" hint="Optional — kept for reference, not yet reminded automatically">
          <Input type="date" value={form.nextDueAt} onChange={(e) => set("nextDueAt", e.target.value)} />
        </Field>
        <Field label="Notes" hint="Optional">
          <TextArea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Record"}</Button>
      </form>
    </Modal>
  );
}
