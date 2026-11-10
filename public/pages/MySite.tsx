import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, BadgeCheck, Check, Clock, Copy, ExternalLink, Globe, HelpCircle, Images, ImagePlus, LayoutGrid, Loader2, Megaphone, Monitor, Palette,
  Phone, Plus, Quote, Rocket, ShoppingBag, Smartphone, Sparkles, Star, Trash2, Type, X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { SiteView } from "@/components/site/SiteView";
import { StoreSettings } from "@/pages/StoreSettings";
import { api } from "@/lib/api";
import { qrDataUrl } from "@/lib/qrcode";
import { useSession } from "@/lib/session";
import {
  ACCENTS, DAYS, DAY_ORDER, FEATURE_ICONS, SECTIONS, TEMPLATES,
  type SectionKey, type SiteCta, type SiteData, type SiteFaq, type SiteFeature, type SiteHours, type SiteStat, type SiteTestimonial,
} from "@/lib/site";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { animateSwitch } from "@/lib/viewTransition";

type Config = {
  enabled: boolean; slug: string;
  template: SiteData["template"]; mode: SiteData["mode"]; accent: string;
  headline: string; tagline: string; about: string; announcement: string;
  contact: SiteData["contact"]; social: SiteData["social"];
  hours: SiteHours[]; show: SiteData["show"];
  stats: SiteStat[]; features: SiteFeature[]; testimonials: SiteTestimonial[]; faqs: SiteFaq[]; cta: SiteCta;
  order: SectionKey[];
  productMode: "all" | "featured" | "none"; featuredIds: string[];
};
type Item = { id: string; name: string; category: string; price: number; imageUrl: string };
type GalleryItem = { url: string; id: string };
type Payload = {
  site: Config & { logoUrl: string; heroUrl: string; aboutImageUrl: string; gallery: GalleryItem[]; name: string; typeLabel: string; currency: string; slugSaved: boolean };
  products: Item[]; canUpload: boolean; aiEnabled: boolean;
};

const CONFIG_KEYS: (keyof Config)[] = ["enabled", "slug", "template", "mode", "accent", "headline", "tagline", "about", "announcement", "contact", "social", "hours", "show", "stats", "features", "testimonials", "faqs", "cta", "order", "productMode", "featuredIds"];
const pickConfig = (s: Config): Config => JSON.parse(JSON.stringify(Object.fromEntries(CONFIG_KEYS.map((k) => [k, s[k]]))));
const TABS = [
  { key: "setup", label: "Setup", icon: Rocket },
  { key: "content", label: "Content", icon: Type },
  { key: "business", label: "Business", icon: Phone },
  { key: "layout", label: "Layout", icon: LayoutGrid },
  { key: "store", label: "Online store", icon: ShoppingBag },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0", on ? "bg-primary" : "bg-line-2")}>
      <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
    </button>
  );
}

function ImageSlot({ label, hint, url, canUpload, busy, onPick, onRemove, wide }: { label: string; hint: string; url: string; canUpload: boolean; busy: boolean; onPick: (f: File) => void; onRemove: () => void; wide?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="text-[12.5px] font-semibold text-t2 mb-1.5">{label}</div>
      <div className="flex items-center gap-3">
        <div className={cn("rounded-xl border border-dashed border-line-2 bg-surface-2 grid place-items-center overflow-hidden shrink-0", wide ? "w-28 h-16" : "w-16 h-16")}>
          {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <ImagePlus className="w-5 h-5 text-t4" />}
        </div>
        <div className="min-w-0">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={!canUpload || busy} onClick={() => ref.current?.click()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {url ? "Replace" : "Upload"}
            </Button>
            {url && <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}><Trash2 className="w-3.5 h-3.5" /></Button>}
          </div>
          <div className="text-[11.5px] text-t3 mt-1">{canUpload ? hint : "Photo upload isn't set up on this server yet."}</div>
        </div>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}

/** A repeatable block (a number, a review, a question…) with add / remove / reorder. */
function Repeater<T>({ items, max, addLabel, onChange, blank, children }: {
  items: T[]; max: number; addLabel: string; onChange: (next: T[]) => void; blank: () => T;
  children: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= items.length) return; const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface-2/50 p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11.5px] font-bold text-t3 uppercase tracking-wide">#{i + 1}</span>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="w-7 h-7 grid place-items-center rounded-lg text-t3 hover:bg-surface-3 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down" className="w-7 h-7 grid place-items-center rounded-lg text-t3 hover:bg-surface-3 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => onChange(items.filter((_, n) => n !== i))} aria-label="Remove" className="w-7 h-7 grid place-items-center rounded-lg text-t3 hover:bg-danger-soft hover:text-danger"><X className="w-4 h-4" /></button>
            </div>
          </div>
          {children(it, (patch) => onChange(items.map((x, n) => (n === i ? { ...x, ...patch } : x))), i)}
        </div>
      ))}
      {items.length < max && (
        <Button variant="secondary" size="sm" onClick={() => onChange([...items, blank()])}><Plus className="w-3.5 h-3.5" /> {addLabel}</Button>
      )}
      <div className="text-[11.5px] text-t3">{items.length} of {max}</div>
    </div>
  );
}

/**
 * The owner's editor for the business's public page. Owner-only: the server
 * refuses everyone else, and the menu entry is hidden from them too.
 */
export function MySite() {
  const { activeBusiness, refreshData } = useSession();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [saved, setSaved] = useState<Config | null>(null);
  const [images, setImages] = useState({ logoUrl: "", heroUrl: "", aboutImageUrl: "" });
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [uploading, setUploading] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [tone, setTone] = useState("warm");
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState("");
  const [pickQuery, setPickQuery] = useState("");
  const [tab, setTab] = useState<Tab>("setup");
  const galleryInput = useRef<HTMLInputElement>(null);

  function apply(p: Payload) {
    setPayload(p);
    const cfg = pickConfig(p.site);
    setDraft(cfg);
    setSaved(cfg);
    setImages({ logoUrl: p.site.logoUrl, heroUrl: p.site.heroUrl, aboutImageUrl: p.site.aboutImageUrl });
    setGallery(p.site.gallery);
  }

  useEffect(() => {
    let live = true;
    api<Payload>("/site").then((p) => live && apply(p)).catch((e) => live && setLoadError(e?.message || "Couldn't open the page editor."));
    return () => { live = false; };
  }, [activeBusiness?.id]);

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (saved?.enabled && payload?.site.slugSaved) qrDataUrl(`${window.location.origin}/s/${saved.slug}`, 220).then(setQr).catch(() => setQr(""));
    else setQr("");
  }, [saved?.enabled, saved?.slug, payload?.site.slugSaved]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = <K extends keyof Config>(k: K, v: Config[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setJustSaved(false); };
  const setIn = <K extends "contact" | "social" | "show" | "cta">(k: K, field: keyof Config[K], v: any) => { setDraft((d) => (d ? { ...d, [k]: { ...d[k], [field]: v } } : d)); setJustSaved(false); };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const p = await api<Payload>("/site", { method: "PUT", body: JSON.stringify(draft) });
      apply(p);
      setJustSaved(true);
      refreshData();
    } catch (e: any) {
      setError(e?.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: "logo" | "hero" | "about", file: File) {
    setUploading(kind);
    setError("");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const r = await api<{ url: string }>(`/site/image?kind=${kind}`, { method: "POST", body: fd });
      setImages((i) => ({ ...i, [kind === "about" ? "aboutImageUrl" : `${kind}Url`]: r.url }));
    } catch (e: any) {
      setError(e?.message || "Couldn't upload that image.");
    } finally {
      setUploading("");
    }
  }
  async function removeImage(kind: "logo" | "hero" | "about") {
    setUploading(kind);
    try {
      await api(`/site/image?kind=${kind}`, { method: "DELETE" });
      setImages((i) => ({ ...i, [kind === "about" ? "aboutImageUrl" : `${kind}Url`]: "" }));
    } catch (e: any) {
      setError(e?.message || "Couldn't remove that image.");
    } finally {
      setUploading("");
    }
  }
  async function addGallery(files: FileList) {
    setUploading("gallery");
    setError("");
    try {
      for (const f of Array.from(files).slice(0, 8)) {
        const fd = new FormData();
        fd.append("image", f);
        const r = await api<{ gallery: GalleryItem[] }>("/site/gallery", { method: "POST", body: fd });
        setGallery(r.gallery);
      }
    } catch (e: any) {
      setError(e?.message || "Couldn't upload that photo.");
    } finally {
      setUploading("");
    }
  }
  async function removeGallery(id: string) {
    setUploading("gallery");
    try {
      const r = await api<{ gallery: GalleryItem[] }>(`/site/gallery?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setGallery(r.gallery);
    } catch (e: any) {
      setError(e?.message || "Couldn't remove that photo.");
    } finally {
      setUploading("");
    }
  }

  async function aiDraft() {
    setDrafting(true);
    setError("");
    try {
      const r = await api<{ headline: string; tagline: string; about: string; features: SiteFeature[]; cta: { headline: string; text: string; label: string } | null }>("/site/draft", { method: "POST", body: JSON.stringify({ tone }) });
      setDraft((d) => d && ({
        ...d, headline: r.headline, tagline: r.tagline, about: r.about,
        // Only fill what's empty, so a draft never wipes content the owner wrote.
        features: d.features.length ? d.features : r.features,
        cta: d.cta.headline ? d.cta : r.cta ? { ...d.cta, ...r.cta } : d.cta,
      }));
      setJustSaved(false);
    } catch (e: any) {
      setError(e?.message || "Couldn't draft that right now.");
    } finally {
      setDrafting(false);
    }
  }

  const preview: SiteData | null = useMemo(() => {
    if (!payload || !draft) return null;
    const items = draft.productMode === "none" ? [] : draft.productMode === "featured"
      ? draft.featuredIds.map((id) => payload.products.find((p) => p.id === id)).filter((p): p is Item => !!p)
      : payload.products.slice(0, 12);
    return {
      name: payload.site.name, typeLabel: payload.site.typeLabel, currency: payload.site.currency,
      template: draft.template, mode: draft.mode, accent: draft.accent,
      headline: draft.headline, tagline: draft.tagline, about: draft.about,
      logoUrl: images.logoUrl, heroUrl: images.heroUrl, aboutImageUrl: images.aboutImageUrl,
      contact: draft.contact, social: draft.social, hours: draft.show.hours ? draft.hours : [], show: draft.show,
      products: items.map(({ name, category, price, imageUrl }) => ({ name, category, price, imageUrl })),
      announcement: draft.announcement,
      stats: draft.stats.filter((s) => s.value && s.label),
      features: draft.features.filter((f) => f.title),
      gallery: gallery.map((g) => g.url),
      testimonials: draft.testimonials.filter((r) => r.quote && r.name),
      faqs: draft.faqs.filter((f) => f.q && f.a),
      cta: draft.cta.headline ? draft.cta : null,
      order: draft.order,
    };
  }, [payload, draft, images, gallery]);

  if (loadError) return <div className="p-4 sm:p-6 lg:p-8 max-w-[900px] mx-auto"><ErrorBanner message={loadError} /><EmptyState icon={Globe} title="Only the owner can edit this page" body="Ask the business owner to open Settings → Business page." /></div>;
  if (!payload || !draft || !preview) return <div className="p-8"><Spinner /></div>;

  const featuredSet = new Set(draft.featuredIds);
  const pickable = payload.products.filter((p) => p.name.toLowerCase().includes(pickQuery.trim().toLowerCase()));
  const canUpload = payload.canUpload;
  const filled: Record<SectionKey, boolean> = {
    stats: preview.stats.length > 0, about: !!(draft.about || images.aboutImageUrl), features: preview.features.length > 0,
    products: payload.products.length > 0 && draft.productMode !== "none", gallery: gallery.length > 0, testimonials: preview.testimonials.length > 0,
    faq: preview.faqs.length > 0, cta: !!preview.cta, visit: !!(draft.contact.address || draft.contact.phone || draft.contact.whatsapp || draft.contact.email || draft.show.hours),
  };
  const moveSection = (k: SectionKey, dir: -1 | 1) => {
    const o = [...draft.order]; const i = o.indexOf(k); const j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; set("order", o);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1320px] mx-auto pb-28">
      <PageHeader
        title="Business page"
        subtitle="Your own public page. Customers open it from a link or QR code, and only you can change it."
        actions={
          <span className={cn("inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12.5px] font-bold", saved?.enabled ? "bg-success-soft text-success" : "bg-surface-3 text-t3")}>
            <i className={cn("w-2 h-2 rounded-full", saved?.enabled ? "bg-success" : "bg-t4")} /> {saved?.enabled ? "Live" : "Not published"}
          </span>
        }
      />
      <ErrorBanner message={error} />

      <div className="flex p-1 rounded-2xl border border-line bg-surface-2 gap-1 mb-5 w-full sm:w-fit overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => animateSwitch("tab", () => setTab(key))} className={cn("flex items-center gap-2 px-4 h-10 rounded-xl text-[13px] font-bold whitespace-nowrap transition-all", tab === key ? "bg-surface text-primary shadow-e1" : "text-t3 hover:text-t1")}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className={cn("grid gap-6 items-start", tab !== "store" && "lg:grid-cols-[minmax(0,1fr)_430px]")}>
        <div className="space-y-5 min-w-0">
          {tab === "setup" && (
            <>
              <Panel title="Publish" subtitle="Switch it on when you're happy with how it looks" icon={Rocket} tone="success">
                <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 border border-line px-4 py-3">
                  <div>
                    <div className="text-[13.5px] font-bold text-t1">Page is {draft.enabled ? "on" : "off"}</div>
                    <div className="text-[12px] text-t3">{draft.enabled ? "Anyone with the link can see it." : "Nobody can see it yet."}</div>
                  </div>
                  <Switch on={draft.enabled} onChange={(v) => set("enabled", v)} label="Publish page" />
                </div>
                <div className="mt-4">
                  <Field label="Page address" hint="Letters, numbers and hyphens. Changing it breaks links you've already shared.">
                    <div className="flex items-center rounded-xl border border-line-2 bg-surface focus-within:border-primary overflow-hidden">
                      <span className="pl-3.5 pr-1 text-[13px] text-t3 shrink-0 hidden sm:block">{window.location.host}/s/</span>
                      <input value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="flex-1 min-w-0 h-10 px-3 sm:px-0 bg-transparent text-[13px] text-t1 outline-none" maxLength={40} />
                    </div>
                  </Field>
                </div>
                {saved?.enabled && payload.site.slugSaved && (
                  <div className="mt-4 flex items-center gap-4 flex-wrap">
                    {qr && <img src={qr} alt="QR code for your page" className="w-24 h-24 rounded-xl border border-line" />}
                    <div className="space-y-2">
                      <div className="text-[12.5px] text-t3 break-all">{`${window.location.origin}/s/${saved.slug}`}</div>
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/s/${saved.slug}`); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy link"}
                        </Button>
                        <a href={`/s/${saved.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-line-2 text-[12.5px] font-bold text-t1 hover:border-primary hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /> Open page</a>
                        {qr && <a href={qr} download={`${saved.slug}-qr.png`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-line-2 text-[12.5px] font-bold text-t1 hover:border-primary hover:text-primary">Download QR</a>}
                      </div>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Look & feel" subtitle="Template, colour and pictures" icon={Palette} tone="brand">
                <div className="grid grid-cols-3 gap-3">
                  {TEMPLATES.map((t) => (
                    <button key={t.key} type="button" onClick={() => set("template", t.key)}
                      className={cn("text-left rounded-xl border p-3 transition-all", draft.template === t.key ? "border-primary bg-primary-softer shadow-e1" : "border-line hover:border-line-2")}>
                      <div className="h-14 rounded-lg mb-2 overflow-hidden relative" style={{ background: t.key === "minimal" ? "#fff" : draft.accent, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)" }}>
                        <div className="absolute left-2 top-2 h-1.5 rounded-full" style={{ width: t.key === "bold" ? "70%" : "50%", background: t.key === "minimal" ? draft.accent : "rgba(255,255,255,0.9)" }} />
                        <div className="absolute left-2 top-5 h-1 w-1/3 rounded-full" style={{ background: t.key === "minimal" ? "#cbd0e6" : "rgba(255,255,255,0.6)" }} />
                      </div>
                      <div className="text-[13px] font-bold text-t1">{t.label}</div>
                      <div className="text-[11.5px] text-t3">{t.blurb}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid sm:grid-cols-2 gap-4">
                  <Field label="Colour">
                    <div className="flex flex-wrap gap-2 items-center">
                      {ACCENTS.map((a) => (
                        <button key={a.hex} type="button" title={a.name} onClick={() => set("accent", a.hex)} className={cn("w-8 h-8 rounded-full grid place-items-center ring-offset-2 ring-offset-surface transition-shadow", draft.accent.toLowerCase() === a.hex && "ring-2 ring-primary")} style={{ background: a.hex }}>
                          {draft.accent.toLowerCase() === a.hex && <Check className="w-4 h-4 text-white" />}
                        </button>
                      ))}
                      <label className="w-8 h-8 rounded-full border border-dashed border-line-2 grid place-items-center cursor-pointer overflow-hidden relative" title="Custom colour">
                        <Palette className="w-4 h-4 text-t3" />
                        <input type="color" value={draft.accent} onChange={(e) => set("accent", e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                      </label>
                    </div>
                  </Field>
                  <Field label="Mode">
                    <div className="flex p-1 rounded-xl border border-line-2 bg-surface-2 gap-0.5 w-fit">
                      {(["light", "dark"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => set("mode", m)} className={cn("px-4 h-8 rounded-[9px] text-[12.5px] font-bold capitalize", draft.mode === m ? "bg-surface text-primary shadow-e1" : "text-t3")}>{m}</button>
                      ))}
                    </div>
                  </Field>
                </div>
                <div className="mt-5 grid sm:grid-cols-2 gap-5">
                  <ImageSlot label="Logo" hint="Square works best" url={images.logoUrl} canUpload={canUpload} busy={uploading === "logo"} onPick={(f) => upload("logo", f)} onRemove={() => removeImage("logo")} />
                  <ImageSlot label="Cover photo" hint="Wide photo of your place or products" url={images.heroUrl} canUpload={canUpload} busy={uploading === "hero"} onPick={(f) => upload("hero", f)} onRemove={() => removeImage("hero")} wide />
                </div>
              </Panel>
            </>
          )}

          {tab === "content" && (
            <>
              <Panel
                title="Headline & story" subtitle="What visitors read first" icon={Type} tone="warning"
                action={payload.aiEnabled ? (
                  <div className="flex items-center gap-2">
                    <Select value={tone} onChange={(e) => setTone(e.target.value)} className="!h-9 !w-[110px] !text-[12.5px]">
                      <option value="warm">Warm</option><option value="professional">Professional</option><option value="playful">Playful</option>
                    </Select>
                    <Button variant="secondary" size="sm" onClick={aiDraft} disabled={drafting}>{drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Draft with AI</Button>
                  </div>
                ) : undefined}
              >
                <div className="space-y-4">
                  <Field label="Announcement bar" hint="Optional thin bar at the very top, e.g. “Free delivery this weekend”"><Input value={draft.announcement} maxLength={120} onChange={(e) => set("announcement", e.target.value)} placeholder="Free delivery on orders over ₦10,000" /></Field>
                  <Field label="Headline" hint={`${draft.headline.length}/90`}><Input value={draft.headline} maxLength={90} onChange={(e) => set("headline", e.target.value)} placeholder="Home-style meals, made fresh daily" /></Field>
                  <Field label="Tagline" hint={`${draft.tagline.length}/160`}><Input value={draft.tagline} maxLength={160} onChange={(e) => set("tagline", e.target.value)} placeholder="One line about what makes you different" /></Field>
                  <Field label="About your business" hint={`${draft.about.length}/1500`}><TextArea rows={5} value={draft.about} maxLength={1500} onChange={(e) => set("about", e.target.value)} placeholder="Your story, what you sell, why customers trust you…" /></Field>
                  <ImageSlot label="About photo" hint="A photo of you, your team or your place" url={images.aboutImageUrl} canUpload={canUpload} busy={uploading === "about"} onPick={(f) => upload("about", f)} onRemove={() => removeImage("about")} />
                </div>
              </Panel>

              <Panel title="Numbers" subtitle="A strip of headline figures, like “10+ years”" icon={BadgeCheck} tone="brand">
                <Repeater items={draft.stats} max={4} addLabel="Add a number" onChange={(v) => set("stats", v)} blank={() => ({ value: "", label: "" })}>
                  {(it, up) => (
                    <div className="grid grid-cols-[110px_1fr] gap-3">
                      <Input value={it.value} maxLength={14} onChange={(e) => up({ value: e.target.value })} placeholder="500+" />
                      <Input value={it.label} maxLength={40} onChange={(e) => up({ label: e.target.value })} placeholder="Happy customers" />
                    </div>
                  )}
                </Repeater>
                <p className="mt-2 text-[12px] text-t3">Only add figures that are true. Customers notice.</p>
              </Panel>

              <Panel title="Why choose us" subtitle="Up to 6 reasons, each with an icon" icon={Sparkles} tone="success">
                <Repeater items={draft.features} max={6} addLabel="Add a reason" onChange={(v) => set("features", v)} blank={() => ({ icon: "sparkles", title: "", text: "" })}>
                  {(it, up) => (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(FEATURE_ICONS).map(([k, Icon]) => (
                          <button key={k} type="button" onClick={() => up({ icon: k })} aria-label={k} className={cn("w-9 h-9 grid place-items-center rounded-lg border", it.icon === k ? "border-primary bg-primary-soft text-primary" : "border-line text-t3 hover:text-t1")}><Icon className="w-4 h-4" /></button>
                        ))}
                      </div>
                      <Input value={it.title} maxLength={50} onChange={(e) => up({ title: e.target.value })} placeholder="Freshly made" />
                      <TextArea rows={2} value={it.text} maxLength={220} onChange={(e) => up({ text: e.target.value })} placeholder="One short sentence that explains it" />
                    </div>
                  )}
                </Repeater>
              </Panel>

              <Panel title="Reviews" subtitle="What customers say, in their words" icon={Quote} tone="warning">
                <Repeater items={draft.testimonials} max={6} addLabel="Add a review" onChange={(v) => set("testimonials", v)} blank={() => ({ name: "", role: "", quote: "", rating: 5 })}>
                  {(it, up) => (
                    <div className="space-y-3">
                      <TextArea rows={3} value={it.quote} maxLength={400} onChange={(e) => up({ quote: e.target.value })} placeholder="“The jollof was perfect and delivery was quick.”" />
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Input value={it.name} maxLength={60} onChange={(e) => up({ name: e.target.value })} placeholder="Customer's name" />
                        <Input value={it.role} maxLength={60} onChange={(e) => up({ role: e.target.value })} placeholder="e.g. Regular customer (optional)" />
                      </div>
                      <div className="flex items-center gap-1" aria-label="Rating">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" onClick={() => up({ rating: n })} aria-label={`${n} stars`}><Star className="w-5 h-5" style={{ color: "#f5a524" }} fill={n <= it.rating ? "#f5a524" : "none"} /></button>
                        ))}
                      </div>
                    </div>
                  )}
                </Repeater>
                <p className="mt-2 text-[12px] text-t3">Use real reviews, with the customer's permission.</p>
              </Panel>

              <Panel title="Gallery" subtitle="Photos of your place, work or products" icon={Images} tone="brand">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {gallery.map((g) => (
                    <div key={g.id || g.url} className="relative aspect-square rounded-xl overflow-hidden border border-line group">
                      <img src={g.url} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeGallery(g.id)} disabled={uploading === "gallery"} aria-label="Remove photo" className="absolute top-1.5 right-1.5 w-7 h-7 grid place-items-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                  {gallery.length < 8 && (
                    <button type="button" disabled={!canUpload || uploading === "gallery"} onClick={() => galleryInput.current?.click()} className="aspect-square rounded-xl border border-dashed border-line-2 bg-surface-2 grid place-items-center text-t3 hover:text-primary hover:border-primary disabled:opacity-50">
                      <span className="grid place-items-center gap-1 text-[12px] font-semibold">{uploading === "gallery" ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />} Add photos</span>
                    </button>
                  )}
                </div>
                <input ref={galleryInput} type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { if (e.target.files?.length) addGallery(e.target.files); e.target.value = ""; }} />
                <p className="mt-3 text-[12px] text-t3">{canUpload ? `${gallery.length} of 8 photos. They save as soon as they upload.` : "Photo upload isn't set up on this server yet."}</p>
              </Panel>

              <Panel title="Questions & answers" subtitle="Answer what customers always ask" icon={HelpCircle} tone="neutral">
                <Repeater items={draft.faqs} max={8} addLabel="Add a question" onChange={(v) => set("faqs", v)} blank={() => ({ q: "", a: "" })}>
                  {(it, up) => (
                    <div className="space-y-3">
                      <Input value={it.q} maxLength={140} onChange={(e) => up({ q: e.target.value })} placeholder="Do you deliver?" />
                      <TextArea rows={3} value={it.a} maxLength={600} onChange={(e) => up({ a: e.target.value })} placeholder="Yes, within Ikeja. Delivery takes about 45 minutes." />
                    </div>
                  )}
                </Repeater>
              </Panel>

              <Panel title="Call to action" subtitle="A final nudge before they leave" icon={Megaphone} tone="danger">
                <div className="space-y-4">
                  <Field label="Headline"><Input value={draft.cta.headline} maxLength={90} onChange={(e) => setIn("cta", "headline", e.target.value)} placeholder="Ready to order?" /></Field>
                  <Field label="Supporting line"><Input value={draft.cta.text} maxLength={200} onChange={(e) => setIn("cta", "text", e.target.value)} placeholder="Message us and we'll have it ready." /></Field>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Button text"><Input value={draft.cta.label} maxLength={30} onChange={(e) => setIn("cta", "label", e.target.value)} placeholder="Order on WhatsApp" /></Field>
                    <Field label="Button does">
                      <Select value={draft.cta.action} onChange={(e) => setIn("cta", "action", e.target.value)}>
                        <option value="whatsapp">Opens WhatsApp</option><option value="call">Calls your phone</option><option value="email">Sends an email</option><option value="directions">Shows directions</option>
                      </Select>
                    </Field>
                  </div>
                  <p className="text-[12px] text-t3">Leave the headline empty to hide this section.</p>
                </div>
              </Panel>
            </>
          )}

          {tab === "business" && (
            <>
              <Panel title="Contact & social" subtitle="How customers reach you" icon={Phone} tone="success">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Phone"><Input value={draft.contact.phone} onChange={(e) => setIn("contact", "phone", e.target.value)} placeholder="0801 234 5678" /></Field>
                  <Field label="WhatsApp number" hint="Adds a “Chat on WhatsApp” button"><Input value={draft.contact.whatsapp} onChange={(e) => setIn("contact", "whatsapp", e.target.value)} placeholder="0801 234 5678" /></Field>
                  <Field label="Email"><Input type="email" value={draft.contact.email} onChange={(e) => setIn("contact", "email", e.target.value)} placeholder="hello@yourshop.com" /></Field>
                  <Field label="Map link (optional)" hint="Paste a Google Maps link, or leave blank to search by address"><Input value={draft.contact.mapUrl} onChange={(e) => setIn("contact", "mapUrl", e.target.value)} placeholder="https://maps.google.com/…" /></Field>
                  <Field label="Address" className="sm:col-span-2" hint="Also shows a map on your page"><Input value={draft.contact.address} onChange={(e) => setIn("contact", "address", e.target.value)} placeholder="12 Allen Avenue, Ikeja, Lagos" /></Field>
                  <Field label="Instagram"><Input value={draft.social.instagram} onChange={(e) => setIn("social", "instagram", e.target.value)} placeholder="@yourshop" /></Field>
                  <Field label="Facebook"><Input value={draft.social.facebook} onChange={(e) => setIn("social", "facebook", e.target.value)} placeholder="yourshop" /></Field>
                  <Field label="TikTok"><Input value={draft.social.tiktok} onChange={(e) => setIn("social", "tiktok", e.target.value)} placeholder="@yourshop" /></Field>
                  <Field label="Website"><Input value={draft.social.website} onChange={(e) => setIn("social", "website", e.target.value)} placeholder="https://yourshop.com" /></Field>
                </div>
              </Panel>

              <Panel
                title="Opening hours" subtitle="Shows “Open now” to visitors" icon={Clock} tone="neutral"
                action={<Button variant="ghost" size="sm" onClick={() => { const m = draft.hours.find((h) => h.day === 1)!; set("hours", draft.hours.map((h) => ({ ...h, open: m.open, close: m.close, closed: h.day === 0 ? h.closed : m.closed }))); }}>Copy Monday to all</Button>}
              >
                <div className="space-y-2">
                  {DAY_ORDER.map((day) => {
                    const h = draft.hours.find((x) => x.day === day)!;
                    const upd = (patch: Partial<SiteHours>) => set("hours", draft.hours.map((x) => (x.day === day ? { ...x, ...patch } : x)));
                    return (
                      <div key={day} className="flex items-center gap-3 flex-wrap">
                        <div className="w-24 text-[13px] font-semibold text-t1">{DAYS[day]}</div>
                        <Switch on={!h.closed} onChange={(v) => upd({ closed: !v })} label={`${DAYS[day]} open`} />
                        {h.closed ? <span className="text-[12.5px] text-t3">Closed</span> : (
                          <div className="flex items-center gap-2">
                            <input type="time" value={h.open} onChange={(e) => upd({ open: e.target.value })} className="h-9 px-2.5 rounded-lg border border-line-2 bg-surface text-[13px] text-t1" />
                            <span className="text-t3 text-[12px]">to</span>
                            <input type="time" value={h.close} onChange={(e) => upd({ close: e.target.value })} className="h-9 px-2.5 rounded-lg border border-line-2 bg-surface text-[13px] text-t1" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Products on the page" subtitle="Which items customers see" icon={LayoutGrid} tone="brand">
                <Field label="Which products to show">
                  <div className="flex p-1 rounded-xl border border-line-2 bg-surface-2 gap-0.5 w-fit">
                    {([["all", "All"], ["featured", "Pick some"], ["none", "None"]] as const).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => set("productMode", k)} className={cn("px-4 h-8 rounded-[9px] text-[12.5px] font-bold", draft.productMode === k ? "bg-surface text-primary shadow-e1" : "text-t3")}>{label}</button>
                    ))}
                  </div>
                </Field>
                <p className="mt-2 text-[12px] text-t3">Only names, photos and prices are shown. Cost, stock levels and customers are never shown.</p>
                {draft.productMode === "featured" && (
                  <div className="mt-3">
                    <Input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder={`Search ${payload.products.length} products…`} />
                    <div className="mt-2 rounded-xl border border-line divide-y divide-line max-h-64 overflow-y-auto">
                      {pickable.length === 0 && <div className="p-4 text-[12.5px] text-t3">No products match.</div>}
                      {pickable.slice(0, 80).map((p) => {
                        const on = featuredSet.has(p.id);
                        return (
                          <button key={p.id} type="button" onClick={() => set("featuredIds", on ? draft.featuredIds.filter((i) => i !== p.id) : draft.featuredIds.length < 24 ? [...draft.featuredIds, p.id] : draft.featuredIds)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                            <span className={cn("w-5 h-5 rounded-md border grid place-items-center shrink-0", on ? "bg-primary border-primary text-white" : "border-line-2")}>{on && <Check className="w-3.5 h-3.5" />}</span>
                            <span className="w-9 h-9 rounded-lg bg-surface-3 overflow-hidden shrink-0">{p.imageUrl && <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />}</span>
                            <span className="min-w-0 flex-1 text-[13px] font-semibold text-t1 truncate">{p.name}</span>
                            <span className="text-[12px] text-t3 font-mono">{fmtMoney(p.price, payload.site.currency)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-1.5 text-[12px] text-t3">{draft.featuredIds.length} of 24 picked</div>
                  </div>
                )}
              </Panel>
            </>
          )}

          {tab === "store" && <StoreSettings />}

          {tab === "layout" && (
            <Panel title="Sections" subtitle="Switch sections on or off and put them in the order you like" icon={LayoutGrid} tone="brand">
              <div className="space-y-2">
                {draft.order.map((k, i) => {
                  const meta = SECTIONS.find((s) => s.key === k)!;
                  const flag = k === "visit" ? null : (k as keyof SiteData["show"]);
                  const on = k === "visit" ? draft.show.hours || draft.show.contact : draft.show[flag!];
                  return (
                    <div key={k} className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors", on ? "border-line bg-surface" : "border-line bg-surface-2/60")}>
                      <div className="flex flex-col">
                        <button type="button" onClick={() => moveSection(k, -1)} disabled={i === 0} aria-label={`Move ${meta.label} up`} className="w-6 h-5 grid place-items-center text-t3 hover:text-t1 disabled:opacity-25"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => moveSection(k, 1)} disabled={i === draft.order.length - 1} aria-label={`Move ${meta.label} down`} className="w-6 h-5 grid place-items-center text-t3 hover:text-t1 disabled:opacity-25"><ArrowDown className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-[13.5px] font-bold", on ? "text-t1" : "text-t3")}>{meta.label}</div>
                        <div className="text-[12px] text-t3 truncate">{on && !filled[k] ? <span className="text-warning font-semibold">Nothing to show yet, so it's hidden. Add content in the Content tab.</span> : meta.blurb}</div>
                      </div>
                      {k === "visit" ? (
                        <div className="flex items-center gap-3 text-[12px] text-t3">
                          <label className="flex items-center gap-1.5">Hours <Switch on={draft.show.hours} onChange={(v) => setIn("show", "hours", v)} label="Show hours" /></label>
                          <label className="flex items-center gap-1.5">Contact <Switch on={draft.show.contact} onChange={(v) => setIn("show", "contact", v)} label="Show contact" /></label>
                        </div>
                      ) : (
                        <Switch on={on} onChange={(v) => setIn("show", flag!, v)} label={`Show ${meta.label}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-t3">The cover section and footer are always shown. A section with no content stays hidden even when it's switched on.</p>
            </Panel>
          )}
        </div>

        {tab !== "store" && <aside className="lg:sticky lg:top-4 space-y-3 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-bold text-t1">Live preview</div>
            <div className="flex p-1 rounded-xl border border-line-2 bg-surface-2 gap-0.5">
              {([["phone", Smartphone], ["desktop", Monitor]] as const).map(([k, Icon]) => (
                <button key={k} type="button" onClick={() => setDevice(k)} aria-label={k} className={cn("w-9 h-7 grid place-items-center rounded-[8px]", device === k ? "bg-surface text-primary shadow-e1" : "text-t3")}><Icon className="w-4 h-4" /></button>
              ))}
            </div>
          </div>
          <div className={cn("mx-auto rounded-[26px] border-[6px] overflow-hidden bg-surface shadow-e3", device === "phone" ? "w-[300px]" : "w-full")} style={{ borderColor: "#1b1e3a" }}>
            <div className="max-h-[72vh] overflow-y-auto"><SiteView data={preview} preview /></div>
          </div>
          <p className="text-[11.5px] text-t3 text-center">Preview shows up to 12 products. The live page shows them all.</p>
        </aside>}
      </div>

      {tab !== "store" && <div className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none">
        <div className="max-w-[1320px] mx-auto px-6 lg:px-8 pb-4 flex justify-end lg:pl-[calc(80px+2rem)]">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-surface/95 backdrop-blur px-4 py-2.5 shadow-e3">
            <span className="text-[12.5px] text-t3">{saving ? "Saving…" : dirty ? "You have unsaved changes" : justSaved ? "All changes saved" : "No changes"}</span>
            {dirty && <Button variant="ghost" size="sm" onClick={() => saved && setDraft(JSON.parse(JSON.stringify(saved)))}>Discard</Button>}
            <Button onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save changes</Button>
          </div>
        </div>
      </div>}
    </div>
  );
}
