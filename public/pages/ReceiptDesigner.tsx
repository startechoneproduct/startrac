import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { LockChip, requestUpgrade } from "@/components/plan/PlanUi";
import { ReceiptPaper, SAMPLE_RECEIPT, type ReceiptDesign } from "@/components/receipt/ReceiptPaper";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Settings = {
  business: { name: string; taxId?: string; logoUrl?: string; settings: { receiptFooter: string; currency: string; receipt: Omit<ReceiptDesign, "taxId"> & { showTaxId: boolean } } };
};
type Draft = Omit<ReceiptDesign, "taxId"> & { showTaxId: boolean; footer: string };

const TEMPLATES: { key: ReceiptDesign["template"]; label: string; blurb: string }[] = [
  { key: "classic", label: "Classic", blurb: "Centred, clean and familiar" },
  { key: "modern", label: "Modern", blurb: "Left-aligned with a total card" },
  { key: "compact", label: "Compact", blurb: "Dense, for small paper" },
  { key: "bold", label: "Bold", blurb: "Black bands, big total" },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 cursor-pointer">
      <span className="text-[13px] font-semibold text-t1">{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0", on ? "bg-primary" : "bg-line-2")}>
        <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
      </button>
    </label>
  );
}

/**
 * Pro: set what the receipt says and shows (header, address, footer, paper size…).
 * Business: also pick a designed layout and let the AI write the wording.
 */
export function ReceiptDesigner() {
  const { hasFeature, activeBusiness } = useSession();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [taxId, setTaxId] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("₦");
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [done, setDone] = useState(false);
  const [tone, setTone] = useState("warm");
  const templates = hasFeature("receiptTemplates");
  const ai = hasFeature("ai") && templates;

  useEffect(() => {
    api<Settings>("/settings").then((s) => {
      const r = s.business.settings.receipt;
      const d: Draft = { ...r, footer: s.business.settings.receiptFooter };
      setDraft(d); setSaved(d); setTaxId(s.business.taxId || ""); setName(s.business.name); setCurrency(s.business.settings.currency); setLogoUrl(s.business.logoUrl || "");
    }).catch((e) => setError(e?.message || "Couldn't load your receipt settings."));
  }, [activeBusiness?.id]);

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setDone(false); };

  const preview = useMemo(() => {
    if (!draft) return null;
    const { footer, showTaxId, ...design } = draft;
    // The logo shows here only where it will really print: on the Business plan.
    const logo = hasFeature("receiptLogo") ? logoUrl : "";
    return { ...SAMPLE_RECEIPT, businessName: name, currency, footer, logoUrl: logo, design: { ...design, taxId: showTaxId ? taxId : "" } as ReceiptDesign };
  }, [draft, name, currency, taxId, logoUrl, hasFeature]);

  async function save() {
    if (!draft) return;
    setSaving(true); setError("");
    try {
      const { footer, ...receipt } = draft;
      await api("/settings", { method: "PATCH", body: JSON.stringify({ receipt, receiptFooter: footer }) });
      setSaved(draft); setDone(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function aiWrite() {
    setDrafting(true); setError("");
    try {
      const r = await api<{ headerNote: string; footer: string }>("/settings/receipt/draft", { method: "POST", body: JSON.stringify({ tone }) });
      setDraft((d) => (d ? { ...d, headerNote: r.headerNote, footer: r.footer } : d)); setDone(false);
    } catch (e: any) {
      setError(e?.message || "Couldn't draft that right now.");
    } finally {
      setDrafting(false);
    }
  }

  if (!draft || !preview) return <div className="p-8">{error ? <ErrorBanner message={error} /> : <Spinner />}</div>;

  return (
    <div className="p-6 lg:p-8 max-w-[1180px] mx-auto pb-28">
      <PageHeader title="Receipt designer" subtitle="What your customers see on paper and on WhatsApp" />
      <ErrorBanner message={error} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        <div className="space-y-5 min-w-0">
          <Panel
            title="Wording" subtitle="Your header, address and thank-you line" icon={FileText} tone="brand"
            action={
              <div className="flex items-center gap-2">
                {ai && <Select value={tone} onChange={(e) => setTone(e.target.value)} className="!h-9 !w-[110px] !text-[12.5px]"><option value="warm">Warm</option><option value="professional">Professional</option><option value="playful">Playful</option></Select>}
                <Button variant="secondary" size="sm" onClick={() => (ai ? aiWrite() : requestUpgrade("receiptTemplates"))} disabled={drafting}>
                  {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : ai ? <Sparkles className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Write with AI <LockChip feature="receiptTemplates" />
                </Button>
              </div>
            }
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Welcome line" hint="Under your business name" className="sm:col-span-2"><Input value={draft.headerNote} maxLength={120} onChange={(e) => set("headerNote", e.target.value)} placeholder="Fresh, hot and on time" /></Field>
              <Field label="Address"><Input value={draft.address} maxLength={160} onChange={(e) => set("address", e.target.value)} placeholder="12 Allen Avenue, Ikeja" /></Field>
              <Field label="Phone"><Input value={draft.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} placeholder="0801 234 5678" /></Field>
              <Field label="Thank-you message" className="sm:col-span-2"><Input value={draft.footer} maxLength={200} onChange={(e) => set("footer", e.target.value)} placeholder="Thank you for your patronage!" /></Field>
            </div>
          </Panel>

          <Panel title="What it shows" subtitle="Switch lines on or off" icon={Check} tone="success">
            <div className="grid sm:grid-cols-2 gap-2.5">
              <Toggle on={draft.showCashier} onChange={(v) => set("showCashier", v)} label="Who served" />
              <Toggle on={draft.showCustomer} onChange={(v) => set("showCustomer", v)} label="Customer name" />
              <Toggle on={draft.showPayments} onChange={(v) => set("showPayments", v)} label="Payment & change" />
              <Toggle on={draft.showTaxId} onChange={(v) => set("showTaxId", v)} label={taxId ? `Tax ID (${taxId})` : "Tax ID (add one in Settings)"} />
            </div>
            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <Field label="Paper width">
                <div className="flex p-1 rounded-xl border border-line-2 bg-surface-2 gap-0.5 w-fit">
                  {(["58", "80"] as const).map((w) => <button key={w} type="button" onClick={() => set("paperWidth", w)} className={cn("px-4 h-8 rounded-[9px] text-[12.5px] font-bold", draft.paperWidth === w ? "bg-surface text-primary shadow-e1" : "text-t3")}>{w} mm</button>)}
                </div>
              </Field>
              <Field label="Text size">
                <div className="flex p-1 rounded-xl border border-line-2 bg-surface-2 gap-0.5 w-fit">
                  {([["sm", "Small"], ["md", "Normal"], ["lg", "Large"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => set("textSize", k)} className={cn("px-4 h-8 rounded-[9px] text-[12.5px] font-bold", draft.textSize === k ? "bg-surface text-primary shadow-e1" : "text-t3")}>{l}</button>)}
                </div>
              </Field>
            </div>
          </Panel>

          <Panel title="Layout" subtitle={templates ? "Pick a designed receipt" : "Designed layouts are part of the Business plan"} icon={FileText} tone="warning" action={<LockChip feature="receiptTemplates" />}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TEMPLATES.map((t) => {
                const locked = !templates && t.key !== "classic";
                return (
                  <button key={t.key} type="button" onClick={() => (locked ? requestUpgrade("receiptTemplates") : set("template", t.key))}
                    className={cn("relative text-left rounded-xl border p-3 transition-all", draft.template === t.key ? "border-primary bg-primary-softer shadow-e1" : "border-line hover:border-line-2")}>
                    <div className="h-16 rounded-md bg-white border border-line mb-2 p-1.5 space-y-1 overflow-hidden">
                      <div className={cn("h-1.5 rounded-full bg-black/80", t.key === "classic" || t.key === "compact" ? "mx-auto w-1/2" : "w-2/3", t.key === "bold" && "h-3 rounded-none w-full")} />
                      <div className="h-1 rounded-full bg-black/20" /><div className="h-1 rounded-full bg-black/20 w-3/4" />
                      <div className={cn("h-1.5 rounded-full bg-black/70 w-1/2 ml-auto", t.key === "bold" && "h-2.5 rounded-none w-full", t.key === "modern" && "h-2.5 rounded-md bg-black/15 w-full")} />
                    </div>
                    <div className="flex items-center justify-between gap-1"><span className="text-[13px] font-bold text-t1">{t.label}</span>{locked && <Lock className="w-3.5 h-3.5 text-t4" />}</div>
                    <div className="text-[11.5px] text-t3 leading-snug">{t.blurb}</div>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>

        <aside className="lg:sticky lg:top-4 min-w-0">
          <div className="text-[13px] font-bold text-t1 mb-3">Preview</div>
          <div className="rounded-[22px] bg-surface-3 border border-line p-5"><ReceiptPaper receipt={preview} /></div>
          <p className="mt-3 text-[11.5px] text-t3 text-center">A sample sale. Real receipts use the till's items and totals.</p>
        </aside>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none">
        <div className="max-w-[1180px] mx-auto px-6 lg:px-8 pb-4 flex justify-end lg:pl-[calc(80px+2rem)]">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-surface/95 backdrop-blur px-4 py-2.5 shadow-e3">
            <span className="text-[12.5px] text-t3">{saving ? "Saving…" : dirty ? "You have unsaved changes" : done ? "Receipt saved" : "No changes"}</span>
            {dirty && <Button variant="ghost" size="sm" onClick={() => saved && setDraft(saved)}>Discard</Button>}
            <Button onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save receipt</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
