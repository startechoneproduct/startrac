import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Save, Plus, MapPin, KeyRound, RefreshCw, BellRing, X, Store, Blocks, Wrench,
  Check, Copy, Mail, MailWarning, ShieldCheck, Users, QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { Table, TR, TH, TD } from "@/components/ui/Table";
import { PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input } from "@/components/ui/Field";
import { CurrencySelect } from "@/components/ui/CurrencySelect";
import { LogoPicker } from "@/components/business/LogoPicker";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { findCurrency } from "#shared/currencies.js";

type AlertPrefs = {
  lowStock: boolean; outOfStock: boolean; expiry: boolean; pendingReturns: boolean;
  expiryDays: number[]; email: boolean;
};
type LoyaltyRule = {
  mode: "off" | "visits" | "spend";
  threshold: number;
  windowDays: number;
  discountType: "percent" | "flat";
  discountValue: number;
};
type SettingsData = {
  business: {
    id: string; name: string; typeKey: string; typeLabel: string; code: string; logoUrl: string;
    settings: {
      currency: string; currencyCode: string; address: string; phone: string; vatEnabled: boolean; vatRate: number; receiptFooter: string;
      alertEmails: string[]; alerts: AlertPrefs; modules: string[]; loyaltyRule: LoyaltyRule;
      ai: { digestEnabled: boolean };
    };
    emailConfigured: boolean;
    aiConfigured: boolean;
  };
  branches: { id: string; name: string; address: string }[];
  availableModules: { key: string; label: string; hint: string }[];
};

type SectionKey = "business" | "alerts" | "modules" | "loyaltyCard" | "permissions" | "branches" | "advanced";

const SECTIONS: { key: SectionKey; label: string; icon: any; blurb: string; ownerOnly?: boolean }[] = [
  { key: "business", label: "Business", icon: Store, blurb: "Name, currency, VAT and what prints on receipts" },
  { key: "alerts", label: "Alerts", icon: BellRing, blurb: "What the shop tells you about, and who else hears it" },
  { key: "modules", label: "Features", icon: Blocks, blurb: "Switch off anything this business doesn't use" },
  { key: "loyaltyCard", label: "Loyalty Cards", icon: QrCode, blurb: "Who qualifies for a card, and the discount it carries" },
  { key: "permissions", label: "Permissions", icon: ShieldCheck, blurb: "Roles, permission overrides and PINs" },
  { key: "branches", label: "Branches", icon: MapPin, blurb: "Where this business trades" },
  { key: "advanced", label: "Advanced", icon: Wrench, blurb: "Tools for when something looks wrong", ownerOnly: true },
];

/**
 * One page, one thing at a time.
 *
 * This used to be two unbalanced columns of cards — a short one on the left
 * and five stacked on the right, with three different save buttons that each
 * behaved differently. Settings pages only ever grow, so the sections are
 * explicit now and each one owns a single save.
 */
export function Settings() {
  const { can, hasFeature } = useSession();
  const { data, loading, reload } = useApi<SettingsData>("/settings", []);
  const [section, setSection] = useState<SectionKey>("business");

  if (loading || !data) return <div className="p-8"><Spinner /></div>;

  // Loyalty cards are a Pro feature, so their settings only appear on plans that have them.
  const visible = SECTIONS.filter((s) => (!s.ownerOnly || can("dashboard_finance")) && (s.key !== "loyaltyCard" || hasFeature("loyalty")));
  const current = visible.find((s) => s.key === section) || visible[0];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader title="Settings" subtitle={`${data.business.typeLabel} · changes here are recorded in the audit trail`} />

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Section rail — a sidebar on desktop, scrollable chips on mobile */}
        <nav className="lg:w-52 shrink-0 w-full">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
            {visible.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={cn(
                  "flex items-center gap-2.5 px-3 h-10 rounded-ctl text-[13px] font-semibold whitespace-nowrap transition-colors shrink-0 lg:w-full",
                  section === key
                    ? "bg-primary-soft text-primary"
                    : "text-t3 hover:text-t1 hover:bg-surface-2"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0 w-full">
          <div className="mb-4">
            <h2 className="text-[17px] font-semibold text-t1">{current.label}</h2>
            <p className="text-[13px] text-t3 mt-0.5">{current.blurb}</p>
          </div>

          {current.key === "business" && <BusinessSection data={data} onSaved={reload} />}
          {current.key === "alerts" && (
            <AlertsSection
              emails={data.business.settings.alertEmails}
              prefs={data.business.settings.alerts}
              emailConfigured={data.business.emailConfigured}
              aiDigestEnabled={data.business.settings.ai.digestEnabled}
              aiConfigured={data.business.aiConfigured && hasFeature("ai")}
              onSaved={reload}
            />
          )}
          {current.key === "modules" && (
            <ModulesSection available={data.availableModules} enabled={data.business.settings.modules} />
          )}
          {current.key === "loyaltyCard" && (
            <LoyaltyCardSection rule={data.business.settings.loyaltyRule} currency={data.business.settings.currency} onSaved={reload} />
          )}
          {current.key === "permissions" && <PermissionsSection />}
          {current.key === "branches" && <BranchesSection branches={data.branches} canAdd={can("*")} onSaved={reload} />}
          {current.key === "advanced" && <AdvancedSection />}
        </div>
      </div>
    </div>
  );
}

// A consistent footer for every section that saves: same place, same wording,
// and it only appears once there is something to save.
function SaveBar({ dirty, busy, saved, onSave, label = "Save changes" }: {
  dirty: boolean; busy: boolean; saved: boolean; onSave: () => void; label?: string;
}) {
  if (!dirty && !saved) return null;
  return (
    <div className="flex items-center gap-3 mt-4">
      {dirty && (
        <Button onClick={onSave} disabled={busy}>
          <Save className="w-4 h-4" /> {busy ? "Saving…" : label}
        </Button>
      )}
      {saved && !dirty && (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-success">
          <Check className="w-4 h-4" /> Saved
        </span>
      )}
    </div>
  );
}

// ── Business ─────────────────────────────────────────────────────────

function BusinessSection({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const initial = {
    name: data.business.name,
    // The code, or a symbol typed by hand before the list existed.
    currency: findCurrency(data.business.settings.currency) ? data.business.settings.currencyCode : data.business.settings.currency,
    vatEnabled: data.business.settings.vatEnabled,
    vatRate: String(data.business.settings.vatRate),
    receiptFooter: data.business.settings.receiptFooter,
    address: data.business.settings.address || "",
    phone: data.business.settings.phone || "",
  };
  const [form, setForm] = useState(initial);
  const [logoUrl, setLogoUrl] = useState(data.business.logoUrl);
  const [logoBusy, setLogoBusy] = useState(false);
  // The logo saves on its own, straight away; the rest waits for Save changes.
  async function uploadLogo(image: Blob) {
    setLogoBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", image, "logo");
      const r = await api<{ logoUrl: string }>("/settings/logo", { method: "POST", body: fd });
      setLogoUrl(r.logoUrl);
      refreshSession().catch(() => {});
    } catch (err: any) { setError(err.message); } finally { setLogoBusy(false); }
  }
  async function removeLogo() {
    if (!confirm("Remove your logo?")) return;
    setLogoBusy(true); setError("");
    try {
      await api("/settings/logo", { method: "DELETE" });
      setLogoUrl("");
      refreshSession().catch(() => {});
    } catch (err: any) { setError(err.message); } finally { setLogoBusy(false); }
  }
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const { refreshSession } = useSession();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ ...form, vatRate: Number(form.vatRate) || 0 }) });
      setSaved(true);
      onSaved();
      // Name and currency show all over the app; pick them up without signing in again.
      if (form.currency !== initial.currency || form.name !== initial.name) refreshSession().catch(() => {});
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <ErrorBanner message={error} />
        <div><div className="text-[12.5px] font-semibold text-t2 mb-1.5">Logo</div><LogoPicker url={logoUrl} onPick={uploadLogo} onRemove={removeLogo} busy={logoBusy} /></div>
        <Field label="Business name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Address" hint="Printed under your name on receipts and invoices"><Input value={form.address} maxLength={160} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. 12 Allen Avenue, Ikeja, Lagos" /></Field>
          <Field label="Phone" hint="Printed on receipts and invoices"><Input value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 0803 123 4567" /></Field>
        </div>
        <Field label="Currency" hint={form.currency !== initial.currency ? "This changes the symbol shown from now on. Amounts already recorded are not converted." : "Shown on every price, receipt, invoice and report"}>
          <CurrencySelect className="sm:!w-80" value={form.currency} legacySymbol={data.business.settings.currency} onChange={(code) => setForm({ ...form, currency: code })} />
        </Field>
        <Field label="Receipt footer" hint="The last line customers read">
          <Input value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} placeholder="Thank you for your patronage!" />
        </Field>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-t1">Charge VAT</div>
            <div className="text-[12px] text-t3 mt-0.5">Added on top of the subtotal, after any discount</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {form.vatEnabled && (
              <div className="flex items-center gap-1">
                <Input type="number" min="0" max="50" step="0.5" value={form.vatRate}
                  onChange={(e) => setForm({ ...form, vatRate: e.target.value })} className="!w-20 !h-8 text-right" />
                <span className="text-[12px] text-t3">%</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setForm({ ...form, vatEnabled: !form.vatEnabled })}
              className={cn("w-11 h-6 rounded-full transition-colors relative", form.vatEnabled ? "bg-primary" : "bg-surface-3 border border-line-2")}
            >
              <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", form.vatEnabled ? "left-[22px]" : "left-0.5")} />
            </button>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} busy={busy} saved={saved} onSave={save} />

      {/* Identity rather than a setting — nothing to save, so it sits apart. */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-primary" />
          <div className="text-[13px] font-semibold text-t1">Till login code</div>
        </div>
        <div className="text-[12px] text-t3 mb-3">
          Staff type this once on a till device. After that they sign in with only their PIN.
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 font-mono text-[22px] font-semibold tracking-[0.3em] text-primary text-center py-3 rounded-ctl bg-primary-softer border border-line">
            {data.business.code}
          </div>
          <button
            onClick={() => { navigator.clipboard?.writeText(data.business.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="w-11 h-11 rounded-ctl border border-line-2 bg-surface flex items-center justify-center text-t3 hover:text-primary hover:border-brand-400 transition-colors"
            title="Copy code"
          >
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────

function AlertsSection({ emails, prefs, emailConfigured, aiDigestEnabled, aiConfigured, onSaved }: {
  emails: string[]; prefs: AlertPrefs; emailConfigured: boolean; aiDigestEnabled: boolean; aiConfigured: boolean; onSaved: () => void;
}) {
  const [list, setList] = useState<string[]>(emails);
  const [draft, setDraft] = useState("");
  const [p, setP] = useState<AlertPrefs>(prefs);
  const [aiDigest, setAiDigest] = useState(aiDigestEnabled);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const dirty = JSON.stringify(list) !== JSON.stringify(emails) || JSON.stringify(p) !== JSON.stringify(prefs) || aiDigest !== aiDigestEnabled;

  function addEmail() {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { setError("That doesn't look like an email address."); return; }
    if (list.includes(value)) { setDraft(""); return; }
    if (list.length >= 5) { setError("Five addresses is the maximum."); return; }
    setError("");
    setList((l) => [...l, value]);
    setDraft("");
  }

  async function save() {
    setBusy(true); setError(""); setNote(""); setSaved(false);
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ alertEmails: list, alerts: p, ai: { digestEnabled: aiDigest } }) });
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Lets an owner watch the alert system work instead of taking it on trust.
  async function checkNow() {
    setChecking(true); setError(""); setNote("");
    try {
      const r = await api<{ raised: number; email: { sent: boolean; reason?: string; count?: number } }>(
        "/notifications/check", { method: "POST" }
      );
      const mail = r.email.sent
        ? ` Emailed ${r.email.count} to ${list.length} recipient${list.length === 1 ? "" : "s"}.`
        : r.email.reason === "nothing_new" ? " Nothing new to email."
        : r.email.reason === "no_recipients" ? " No email sent — add an address below."
        : r.email.reason === "not_configured" ? " Email isn't set up on this server yet."
        : r.email.reason === "disabled" ? " Email alerts are switched off."
        : "";
      setNote(`${r.raised === 0 ? "Nothing new" : `${r.raised} alert${r.raised === 1 ? "" : "s"} raised`}.${mail}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  const toggles: { key: keyof AlertPrefs; label: string; hint: string }[] = [
    { key: "outOfStock", label: "Out of stock", hint: "Something has run out completely" },
    { key: "lowStock", label: "Running low", hint: "Stock has fallen to its reorder level" },
    { key: "expiry", label: "Expiry", hint: "Stock nearing or past its date" },
    { key: "pendingReturns", label: "Returns waiting", hint: "A return needs a manager's decision" },
  ];

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      <Card className="p-5">
        <div className="text-[13px] font-semibold text-t1 mb-1">Tell me about</div>
        <div className="text-[12px] text-t3 mb-3">These appear in the bell at the top of the screen straight away.</div>
        <div className="space-y-1.5">
          {toggles.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setP((v) => ({ ...v, [t.key]: !v[t.key] }))}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-t1">{t.label}</div>
                <div className="text-[11px] text-t3">{t.hint}</div>
              </div>
              <span className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", p[t.key] ? "bg-primary" : "bg-surface-3 border border-line-2")}>
                <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", p[t.key] ? "left-[22px]" : "left-0.5")} />
              </span>
            </button>
          ))}
        </div>

        {p.expiry && (
          <div className="mt-4 pt-4 border-t border-line">
            <Field label="Warn me this far ahead" hint="Each one fires once, so the warnings sharpen as the date gets closer">
              <div className="flex gap-1.5 flex-wrap">
                {[60, 30, 14, 7, 3].map((d) => {
                  const on = p.expiryDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        setP((v) => {
                          const next = on ? v.expiryDays.filter((x) => x !== d) : [...v.expiryDays, d];
                          return { ...v, expiryDays: next.length ? next.sort((a, b) => b - a) : v.expiryDays };
                        })
                      }
                      className={cn(
                        "h-8 px-3.5 rounded-lg border text-[12px] font-semibold transition-colors",
                        on ? "bg-primary-soft border-brand-400 text-primary" : "bg-surface-2 border-line-2 text-t3 hover:text-t1"
                      )}
                    >
                      {d} days
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          {emailConfigured ? <Mail className="w-4 h-4 text-primary" /> : <MailWarning className="w-4 h-4 text-warning" />}
          <div className="text-[13px] font-semibold text-t1">Also email these people</div>
        </div>
        <div className="text-[12px] text-t3 mb-3">
          One message per check, most urgent first — not one email per problem.
        </div>

        <div className="flex gap-2">
          <Input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
            placeholder="you@business.com"
          />
          <Button type="button" variant="secondary" onClick={addEmail} disabled={list.length >= 5}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>

        {list.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {list.map((e) => (
              <span key={e} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full bg-primary-softer border border-line text-[12px] text-t2">
                {e}
                <button type="button" onClick={() => setList((l) => l.filter((x) => x !== e))} className="text-t4 hover:text-danger">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-[12px] text-t4">Nobody yet — alerts will only show in the app.</div>
        )}

        {!emailConfigured && (
          <div className="mt-3 px-3 py-2.5 rounded-ctl bg-warning-soft text-warning text-[11px] font-semibold">
            This server has no mail account configured, so nothing will actually send yet. Alerts still appear in the bell.
          </div>
        )}
      </Card>

      <Card className="p-5">
        <button
          type="button"
          onClick={() => setAiDigest((v) => !v)}
          className="w-full flex items-center gap-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-t1">Add an AI summary to the digest</div>
            <div className="text-[12px] text-t3 mt-0.5">A short written summary of trends and risks, added to the same email above — never a second one.</div>
          </div>
          <span className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", aiDigest ? "bg-primary" : "bg-surface-3 border border-line-2")}>
            <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", aiDigest ? "left-[22px]" : "left-0.5")} />
          </span>
        </button>
        {!aiConfigured && (
          <div className="mt-3 px-3 py-2.5 rounded-ctl bg-warning-soft text-warning text-[11px] font-semibold">
            This server has no AI provider configured, so this stays off until it does.
          </div>
        )}
      </Card>

      <SaveBar dirty={dirty} busy={busy} saved={saved} onSave={save} label="Save alert settings" />

      <div className="flex items-center gap-3 pt-1">
        <Button variant="secondary" onClick={checkNow} disabled={checking}>
          <RefreshCw className={cn("w-4 h-4", checking && "animate-spin")} /> {checking ? "Checking…" : "Check now"}
        </Button>
        <span className="text-[12px] text-t3">{note || "Runs the check immediately instead of waiting for the next one."}</span>
      </div>
    </div>
  );
}

// ── Features ─────────────────────────────────────────────────────────

function ModulesSection({ available, enabled }: { available: { key: string; label: string; hint: string }[]; enabled: string[] }) {
  const [modules, setModules] = useState<string[]>(enabled);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify([...modules].sort()) !== JSON.stringify([...enabled].sort());

  const toggle = (key: string) => setModules((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));

  async function save() {
    setBusy(true);
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ modules }) });
      // The sidebar reads modules from the session, so the whole app has to
      // pick up the change — a reload is the honest way to do that.
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-[12px] text-t3 mb-3">
          Anything switched off disappears from the menu for everyone in this business. Nothing is deleted — turn it
          back on and the data is still there.
        </div>
        <div className="space-y-1.5">
          {available.map((m) => {
            const on = modules.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggle(m.key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-left hover:border-brand-300 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-t1">{m.label}</div>
                  <div className="text-[11px] text-t3">{m.hint}</div>
                </div>
                <span className={cn("w-11 h-6 rounded-full transition-colors relative shrink-0", on ? "bg-primary" : "bg-surface-3 border border-line-2")}>
                  <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      {dirty && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            <Save className="w-4 h-4" /> {busy ? "Applying…" : "Apply changes"}
          </Button>
          <span className="text-[12px] text-t3">The app reloads so the menu updates.</span>
        </div>
      )}
    </div>
  );
}

// ── Loyalty Cards ────────────────────────────────────────────────────

const MODE_LABEL: Record<LoyaltyRule["mode"], string> = { off: "Off", visits: "Visit count", spend: "Total spend" };

function LoyaltyCardSection({ rule, currency, onSaved }: { rule: LoyaltyRule; currency: string; onSaved: () => void }) {
  const [form, setForm] = useState<LoyaltyRule>(rule);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(rule);

  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ loyaltyRule: form }) });
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <Card className="p-5">
        <div className="text-[13px] font-semibold text-t1 mb-1">Who qualifies</div>
        <div className="text-[12px] text-t3 mb-3">
          A customer who crosses this line gets a QR loyalty card — emailed or shared by WhatsApp from their profile,
          scanned at the till on every visit after.
        </div>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {(["off", "visits", "spend"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setForm((f) => ({ ...f, mode: m }))}
              className={cn(
                "h-8 px-3.5 rounded-lg border text-[12px] font-semibold transition-colors",
                form.mode === m ? "bg-primary-soft border-brand-400 text-primary" : "bg-surface-2 border-line-2 text-t3 hover:text-t1"
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        {form.mode !== "off" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={form.mode === "visits" ? "Visits needed" : `Spend needed (${currency})`}>
              <Input type="number" min="1" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) || 1 }))} />
            </Field>
            <Field label="Within" hint="0 = lifetime total, never resets">
              <div className="flex items-center gap-2">
                <Input type="number" min="0" value={form.windowDays} onChange={(e) => setForm((f) => ({ ...f, windowDays: Math.max(0, Number(e.target.value) || 0) }))} />
                <span className="text-[12px] text-t3 whitespace-nowrap">days{form.windowDays === 0 ? " (lifetime)" : ""}</span>
              </div>
            </Field>
          </div>
        )}
      </Card>

      {form.mode !== "off" && (
        <Card className="p-5">
          <div className="text-[13px] font-semibold text-t1 mb-1">The reward</div>
          <div className="text-[12px] text-t3 mb-3">Applied at checkout when the cashier scans the card.</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Discount type">
              <div className="flex gap-1.5">
                {(["percent", "flat"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, discountType: t }))}
                    className={cn(
                      "h-9 px-3.5 rounded-lg border text-[12px] font-semibold transition-colors flex-1",
                      form.discountType === t ? "bg-primary-soft border-brand-400 text-primary" : "bg-surface-2 border-line-2 text-t3 hover:text-t1"
                    )}
                  >
                    {t === "percent" ? "% off" : `${currency} off`}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={form.discountType === "percent" ? "Percent off" : `Amount off (${currency})`}>
              <Input type="number" min="0" step={form.discountType === "percent" ? "1" : "0.01"} value={form.discountValue}
                onChange={(e) => setForm((f) => ({ ...f, discountValue: Math.max(0, Number(e.target.value) || 0) }))} />
            </Field>
          </div>
        </Card>
      )}

      <SaveBar dirty={dirty} busy={busy} saved={saved} onSave={save} label="Save loyalty settings" />
    </div>
  );
}

// ── Permissions ──────────────────────────────────────────────────────

const ROLE_TONE: Record<string, "brand" | "success" | "warning" | "neutral"> = {
  owner: "brand", admin: "success", manager: "warning", staff: "neutral",
};

// Read-only summary of what the server actually enforces per role — kept in
// sync with permsForRole() on the backend. Individual overrides and PINs
// stay a Staff-page job; this just orients an owner before they go there.
const ROLE_LADDER: { role: string; summary: string }[] = [
  { role: "owner", summary: "Everything, everywhere — every module, every business, billing and staff, with nothing hidden." },
  {
    role: "admin",
    summary:
      "Sales, returns, approving returns and voiding sales, stock, prices, expenses, both dashboards, staff management, settings, customers, activity and the audit trail.",
  },
  {
    role: "manager",
    summary:
      "Sales, returns, approving returns and voiding sales, stock, prices, expenses, the operations dashboard, customers and activity — no settings, staff management, finance dashboard or audit trail.",
  },
  { role: "staff", summary: "Sales, returns and their own activity — the till, and nothing beyond it." },
];

function PermissionsSection() {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-[13px] font-semibold text-t1 mb-1">Role ladder</div>
        <div className="text-[12px] text-t3 mb-4">
          What each role can do out of the box. A person can also be given permission overrides beyond their role from the Staff page.
        </div>
        <div className="overflow-x-auto -mx-5 px-5">
          <Table>
            <thead>
              <tr>
                <TH className="w-28">Role</TH>
                <TH>Can do</TH>
              </tr>
            </thead>
            <tbody>
              {ROLE_LADDER.map((r) => (
                <TR key={r.role} hover={false}>
                  <TD className="align-top whitespace-nowrap">
                    <Badge tone={ROLE_TONE[r.role]} className="capitalize">{r.role}</Badge>
                  </TD>
                  <TD className="text-t2 leading-relaxed">{r.summary}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-t1">Manage individual staff</div>
          <div className="text-[12px] text-t3 mt-0.5">
            Set roles, branches, PINs and per-person permission overrides for each team member.
          </div>
        </div>
        <Link to="/app/staff" className="shrink-0">
          <Button variant="secondary"><Users className="w-4 h-4" /> Go to Staff</Button>
        </Link>
      </Card>
    </div>
  );
}

// ── Branches ─────────────────────────────────────────────────────────

function BranchesSection({ branches, canAdd, onSaved }: {
  branches: { id: string; name: string; address: string }[]; canAdd: boolean; onSaved: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="space-y-2">
          {branches.map((b) => (
            <div key={b.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-ctl bg-surface-2 border border-line">
              <MapPin className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-t1 truncate">{b.name}</div>
                <div className="text-[11px] text-t3 truncate">{b.address || "No address set"}</div>
              </div>
            </div>
          ))}
        </div>
        {canAdd && (
          <Button variant="secondary" className="w-full mt-3" onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4" /> Add a branch
          </Button>
        )}
        {branches.length === 1 && (
          <div className="text-[12px] text-t4 mt-3">
            Add a second branch and stock transfers, per-branch dashboards and branch-scoped staff all switch on.
          </div>
        )}
      </Card>
      <AddBranch open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onSaved(); }} />
    </div>
  );
}

// ── Advanced ─────────────────────────────────────────────────────────

function AdvancedSection() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: monthAgo, to: today });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ days: number; sales: number; returns: number; expenses: number } | null>(null);

  async function run() {
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await api("/metrics/rebuild", { method: "POST", body: JSON.stringify(range) }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="text-[13px] font-semibold text-t1 mb-1">Dashboard figures look wrong?</div>
      <div className="text-[12px] text-t3 mb-3 leading-relaxed">
        The dashboard keeps a running summary so it loads instantly instead of adding up every sale each time. If a
        figure ever disagrees with the sales list, recalculate the period below — it reads your sales, returns and
        expenses back and rewrites the summary. Nothing is deleted or changed, only the totals.
      </div>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>
        <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>
      </div>
      {result && (
        <div className="mt-3 px-3 py-2.5 rounded-ctl bg-success-soft text-success text-[12px] font-semibold">
          Recalculated {result.days} day{result.days === 1 ? "" : "s"} from {result.sales} sale{result.sales === 1 ? "" : "s"}
          {result.returns > 0 && `, ${result.returns} return${result.returns === 1 ? "" : "s"}`}
          {result.expenses > 0 && `, ${result.expenses} expense${result.expenses === 1 ? "" : "s"}`}.
        </div>
      )}
      <Button variant="secondary" className="mt-3" disabled={busy} onClick={run}>
        <RefreshCw className={cn("w-4 h-4", busy && "animate-spin")} /> {busy ? "Recalculating…" : "Recalculate this period"}
      </Button>
    </Card>
  );
}

function AddBranch({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { refreshSession } = useSession();
  const [form, setForm] = useState({ name: "", address: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/settings/branches", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", address: "" });
      await refreshSession(); // the switcher reads branches from the session
      setBusy(false);
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a branch" subtitle="Transfers and per-branch dashboards light up automatically">
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Branch name"><Input autoFocus required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Retail — Main Market" /></Field>
        <Field label="Address"><Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Optional" /></Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Adding…" : "Add branch"}</Button>
      </form>
    </Modal>
  );
}
