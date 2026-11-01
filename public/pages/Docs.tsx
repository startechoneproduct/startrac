import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, ArrowUp, BookOpen, Boxes, Brain, Check, ChevronRight, CloudOff, CreditCard, Cpu, Globe, Info,
  KeyRound, LayoutDashboard, LifeBuoy, Lightbulb, Lock, Menu, QrCode, Rocket, Search, ShieldCheck, ShoppingCart, Store, Users, X,
  Layers, Bell, Sparkles, Wrench, Briefcase, Receipt, ScrollText,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BrandMark } from "@/components/brand/BrandMark";
import { PAYMENTS_ENABLED, PLANS, PLAN_ORDER, FEATURES, TRIAL_DAYS } from "#shared/plans.js";
import { BUSINESS_TYPES, CAPABILITIES, TOGGLEABLE_MODULES } from "#shared/businessTypes.js";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────
 * StarTrack documentation — a static, read-only walkthrough of the system.
 *
 * Plan prices, plan features, trade types, capabilities and optional modules
 * are read from the SAME shared files the server enforces (#shared/*), so this
 * page can never promise something the app doesn't do. Everything else is
 * written copy, grouped into sections in the SECTIONS list below.
 * ──────────────────────────────────────────────────────────────────── */

const GRADIENT = "linear-gradient(135deg, #3538f0, #5a3bf4 60%, #7b3cf5)";

type Section = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; group: string };

const SECTIONS: Section[] = [
  { id: "overview", label: "What is StarTrack", icon: BookOpen, group: "Start here" },
  { id: "getting-started", label: "Getting started", icon: Rocket, group: "Start here" },
  { id: "structure", label: "Accounts, businesses & branches", icon: Layers, group: "Start here" },
  { id: "roles", label: "Roles & permissions", icon: KeyRound, group: "Start here" },

  { id: "selling", label: "Selling at the till", icon: ShoppingCart, group: "Daily operations" },
  { id: "offline", label: "Working offline", icon: CloudOff, group: "Daily operations" },
  { id: "returns", label: "Returns, voids & refunds", icon: Receipt, group: "Daily operations" },
  { id: "inventory", label: "Products & inventory", icon: Boxes, group: "Daily operations" },
  { id: "customers", label: "Customers & loyalty", icon: QrCode, group: "Daily operations" },
  { id: "expenses", label: "Expenses", icon: ScrollText, group: "Daily operations" },
  { id: "staff", label: "Staff, attendance & tasks", icon: Users, group: "Daily operations" },

  { id: "dashboard", label: "Dashboard & reports", icon: LayoutDashboard, group: "Insight" },
  { id: "ai", label: "AI assistant", icon: Brain, group: "Insight" },
  { id: "alerts", label: "Alerts & notifications", icon: Bell, group: "Insight" },

  { id: "industries", label: "Industry modules", icon: Store, group: "Built for your trade" },
  { id: "capabilities", label: "Capability reference", icon: Cpu, group: "Built for your trade" },
  { id: "optional-modules", label: "Optional features", icon: Wrench, group: "Built for your trade" },

  { id: "brand", label: "Receipts & business page", icon: Globe, group: "Brand & admin" },
  { id: "audit", label: "Audit log, activity & support", icon: LifeBuoy, group: "Brand & admin" },
  { id: "plans", label: "Plans & billing", icon: CreditCard, group: "Brand & admin" },
  { id: "platform", label: "Platform administration", icon: Briefcase, group: "Brand & admin" },

  { id: "security", label: "Security & data integrity", icon: ShieldCheck, group: "Under the hood" },
  { id: "architecture", label: "Architecture & tech stack", icon: Lock, group: "Under the hood" },
  { id: "shortcuts", label: "Shortcuts & FAQ", icon: Lightbulb, group: "Under the hood" },
];

/* ── Small building blocks ───────────────────────────────────────── */

function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pb-16 mb-16 border-b border-line last:border-0 last:mb-0">
      <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">{eyebrow}</div>
      <h2 className="mt-2 text-[30px] sm:text-[36px] font-extrabold tracking-[-0.03em] leading-[1.1] text-t1">{title}</h2>
      {intro && <p className="mt-4 text-[16.5px] leading-relaxed text-t3 max-w-[720px]">{intro}</p>}
      <div className="mt-8 space-y-8">{children}</div>
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="text-[19px] font-bold tracking-[-0.01em] text-t1 mb-3">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[15.5px] leading-[1.75] text-t2 max-w-[760px]">{children}</p>;
}

function Callout({ kind = "info", title, children }: { kind?: "info" | "tip" | "warn"; title?: string; children: ReactNode }) {
  const styles = {
    info: { box: "bg-primary-softer border-primary/25", icon: "text-primary", I: Info },
    tip: { box: "bg-success-soft border-success/30", icon: "text-success", I: Lightbulb },
    warn: { box: "bg-warning-soft border-warning/35", icon: "text-warning", I: Info },
  }[kind];
  return (
    <div className={cn("rounded-2xl border p-4 sm:p-5 flex gap-3.5 max-w-[760px]", styles.box)}>
      <styles.I className={cn("w-5 h-5 shrink-0 mt-0.5", styles.icon)} />
      <div className="text-[14.5px] leading-relaxed text-t2">
        {title && <div className="font-bold text-t1 mb-1">{title}</div>}
        {children}
      </div>
    </div>
  );
}

function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="space-y-3 max-w-[760px]">
      {items.map(([t, d], i) => (
        <li key={t} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
          <span className="grid place-items-center w-8 h-8 rounded-full text-white text-[13px] font-extrabold shrink-0" style={{ background: GRADIENT }}>{i + 1}</span>
          <div>
            <div className="font-bold text-[15.5px] text-t1">{t}</div>
            <div className="text-[14.5px] text-t3 leading-relaxed mt-0.5">{d}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Cards({ items, cols = 2 }: { items: { title: string; body: string; tag?: string }[]; cols?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-4", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map((c) => (
        <div key={c.title} className="rounded-2xl border border-line bg-surface p-5 hover:border-primary/40 hover:shadow-e2 transition-all">
          <div className="flex items-start justify-between gap-3">
            <div className="font-bold text-[15.5px] text-t1">{c.title}</div>
            {c.tag && <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-soft text-primary">{c.tag}</span>}
          </div>
          <p className="mt-1.5 text-[14px] text-t3 leading-relaxed">{c.body}</p>
        </div>
      ))}
    </div>
  );
}

function Checks({ items }: { items: string[] }) {
  return (
    <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 max-w-[860px]">
      {items.map((i) => (
        <li key={i} className="flex gap-2.5 text-[14.5px] text-t2 leading-relaxed">
          <Check className="w-4 h-4 text-success shrink-0 mt-1" strokeWidth={3} /> <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full text-[14px] min-w-[560px]">
        <thead>
          <tr className="bg-surface-2 text-left">
            {head.map((h) => <th key={h} className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider text-t4">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className={cn("px-4 py-3 text-t2 leading-relaxed", j === 0 && "font-semibold text-t1")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="px-2 py-0.5 rounded-md border border-line-2 bg-surface-2 text-[12px] font-semibold text-t1">{children}</kbd>
);
const Code = ({ children }: { children: ReactNode }) => (
  <code className="px-1.5 py-0.5 rounded-md bg-surface-3 text-[13px] text-t1 font-mono">{children}</code>
);

/* ── Navigation ──────────────────────────────────────────────────── */

function useActiveSection() {
  const [active, setActive] = useState(SECTIONS[0].id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -65% 0px", threshold: 0 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  return active;
}

function TocList({ active, query, onPick }: { active: string; query: string; onPick?: () => void }) {
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const map = new Map<string, Section[]>();
    for (const s of SECTIONS) {
      if (q && !s.label.toLowerCase().includes(q) && !s.group.toLowerCase().includes(q)) continue;
      map.set(s.group, [...(map.get(s.group) || []), s]);
    }
    return [...map.entries()];
  }, [q]);

  if (!groups.length) return <p className="px-3 text-[13.5px] text-t4">No sections match “{query}”.</p>;
  return (
    <nav className="space-y-6">
      {groups.map(([g, items]) => (
        <div key={g}>
          <div className="px-3 mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-t4">{g}</div>
          <ul className="space-y-0.5">
            {items.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={onPick}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] font-semibold transition-colors",
                    active === s.id ? "bg-primary-soft text-primary" : "text-t3 hover:text-t1 hover:bg-surface-3"
                  )}
                >
                  <s.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="max-w-[1320px] mx-auto px-5 h-[64px] flex items-center gap-4">
        <button onClick={onMenu} aria-label="Open sections" className="lg:hidden grid place-items-center w-10 h-10 rounded-full bg-surface-3 text-t1"><Menu className="w-5 h-5" /></button>
        <Link to="/" className="flex items-center gap-2.5" aria-label="StarTrack home">
          <BrandMark className="w-8 h-8" />
          <span className="font-extrabold text-[18px] tracking-[-0.02em] text-t1">StarTrack</span>
        </Link>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-soft text-primary text-[12px] font-bold"><BookOpen className="w-3.5 h-3.5" /> Documentation</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link to="/" className="hidden sm:inline-flex h-10 px-4 items-center text-[14px] font-semibold text-t2 hover:text-t1">Home</Link>
          <Link to="/login" className="hidden sm:inline-flex h-10 px-4 items-center text-[14px] font-semibold text-t2 hover:text-t1">Sign in</Link>
          <Link to="/register" className="inline-flex items-center h-10 px-5 rounded-full text-[14px] font-bold text-white" style={{ background: GRADIENT }}>{PAYMENTS_ENABLED ? "Start free trial" : "Start free"}</Link>
        </div>
      </div>
    </header>
  );
}

/* ── The page ────────────────────────────────────────────────────── */

export function Docs() {
  const active = useActiveSection();
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    document.title = "Documentation — StarTrack";
    const onScroll = () => setShowTop(window.scrollY > 900);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Land on the right section when someone opens /docs#plans directly.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 60);
  }, []);

  const types = Object.entries(BUSINESS_TYPES);
  const capEntries = Object.entries(CAPABILITIES);
  const featureEntries = Object.entries(FEATURES);

  return (
    <div className="bg-canvas text-t1 min-h-screen overflow-x-clip" style={{ scrollBehavior: "smooth" }}>
      <TopBar onMenu={() => setDrawer(true)} />

      {/* Hero */}
      <div className="relative overflow-hidden text-white" style={{ background: "radial-gradient(1000px 520px at 85% -20%, #3a2fd6 0%, transparent 60%), radial-gradient(800px 420px at -10% 60%, #1d2bb8 0%, transparent 55%), #070b33" }}>
        <div className="absolute inset-0 opacity-[0.16]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)", backgroundSize: "26px 26px", maskImage: "linear-gradient(180deg, #000 0%, transparent 85%)" }} />
        <div className="relative max-w-[1320px] mx-auto px-5 py-16 sm:py-24">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-[12.5px] font-bold"><Sparkles className="w-3.5 h-3.5" /> The complete walkthrough</div>
          <h1 className="mt-6 text-[40px] sm:text-[62px] font-extrabold tracking-[-0.04em] leading-[1.02] max-w-[820px]">
            Everything StarTrack does, <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(90deg,#9fb0ff,#d3a8ff)" }}>explained.</span>
          </h1>
          <p className="mt-6 text-[18px] text-white/75 leading-relaxed max-w-[640px]">
            From your first sale to multi-branch reporting, AI-assisted stock entry and industry-specific tools. Read it top to bottom, or jump to the part you need.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#getting-started" className="inline-flex items-center gap-2 h-12 px-6 rounded-full text-[15px] font-bold bg-white text-[#0a1045] hover:-translate-y-0.5 transition-transform">Get started <ArrowRight className="w-4 h-4" /></a>
            <a href="#industries" className="inline-flex items-center gap-2 h-12 px-6 rounded-full text-[15px] font-bold text-white border border-white/25 bg-white/5 hover:bg-white/10 transition-colors">Browse industries</a>
          </div>
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-[760px]">
            {[
              [String(types.length), "industry setups"],
              [String(capEntries.length), "trade capabilities"],
              [String(PLAN_ORDER.length), "plans"],
              [`${TRIAL_DAYS} days`, PAYMENTS_ENABLED ? "of Pro with your first month" : "of Pro, free"],
            ].map(([v, l]) => (
              <div key={l} className="rounded-2xl bg-white/8 border border-white/12 px-4 py-3.5 backdrop-blur-sm" style={{ background: "rgba(255,255,255,0.07)" }}>
                <div className="font-extrabold text-[24px] tracking-[-0.02em]">{v}</div>
                <div className="text-[12.5px] text-white/65 font-medium">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[1320px] mx-auto px-5 flex gap-12">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-[280px] shrink-0">
          <div className="sticky top-[84px] max-h-[calc(100vh-100px)] overflow-y-auto py-10 pr-2">
            <div className="relative mb-6">
              <Search className="w-4 h-4 text-t4 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter sections…"
                className="w-full h-10 pl-10 pr-3 rounded-xl border border-line bg-surface text-[14px] text-t1 placeholder:text-t4 outline-none focus:border-primary"
              />
            </div>
            <TocList active={active} query={query} />
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 py-12 sm:py-16">
          {/* ═══ START HERE ═══ */}
          <Section
            id="overview"
            eyebrow="Start here"
            title="What is StarTrack"
            intro="StarTrack is a multi-tenant business operations platform for small and growing businesses. It brings the till, stock, customers, staff, reporting and an AI assistant into one app — and shapes itself around the kind of business you run."
          >
            <Cards
              cols={3}
              items={[
                { title: "One app for the whole shop", body: "Point of sale, inventory, customers, expenses, staff, attendance, returns, reports and alerts live together, so every number agrees with every other number." },
                { title: "Shaped to your trade", body: `A restaurant, a cold room, a hotel and a gym don't work alike. StarTrack ships ${types.length} industry setups with their own screens, vocabulary and workflows.` },
                { title: "Works on any device", body: "A progressive web app: installable on a phone or tablet, usable on a laptop, and able to keep selling when the internet drops." },
              ]}
            />
            <H3>How the pieces fit</H3>
            <Table
              head={["Layer", "What it is", "Example"]}
              rows={[
                ["Account", "The paying customer. Owns the subscription, plan and billing.", "Ada's Holdings"],
                ["Business", "One trading operation with its own catalog, stock, sales and staff. Each has a trade type.", "Ada's Kitchen (Restaurant)"],
                ["Branch", "A physical location of a business. Stock and sales are kept per branch.", "Wuse 2 branch"],
                ["Member", "A person with a role in a business (and optionally a single branch).", "Chidi — Manager, Wuse 2"],
              ]}
            />
            <Callout kind="info" title="Prices are in naira by default">
              Currency, VAT and what prints on receipts are set per business under Settings → Business.
            </Callout>
          </Section>

          <Section
            id="getting-started"
            eyebrow="Start here"
            title="Getting started"
            intro={PAYMENTS_ENABLED ? `You can look around before committing anything. Pay for Freemium to start and your first month includes ${TRIAL_DAYS} days of Pro, free.` : `You can look around before committing anything. Every new account also starts with ${TRIAL_DAYS} days of Pro, free and with no card, then carries on free on Freemium.`}
          >
            <H3>Try the live demo (no sign-up)</H3>
            <P>
              On the landing page choose <strong>Live demo</strong> and pick your kind of business. You land in a stocked sandbox with a week of sample sales, so every screen has real-looking data. Sandboxes are temporary and cleaned up automatically; they show every feature regardless of plan.
            </P>
            <H3>Create your own account</H3>
            <Steps
              items={[
                ["Register", "Choose a plan to try, enter your details and name your business. Your email and phone can be verified with a short code (email over SMTP, Gmail by default; SMS via Termii when configured)."],
                ["Pick your business type", `Select the trade closest to yours (${types.length} available). StarTrack pre-loads the right categories, terminology, optional features and trade-specific tools.`],
                ["Take the product tour", "The first time you open the dashboard a short guided tour points out the sidebar, New Sale, dashboard tabs, search, alerts, settings and help. You can replay it any time from the button beside Refresh."],
                ["Add your products", "Add items one by one, or import a spreadsheet. On Pro and above, the AI reads your file, maps the columns and shows a preview you approve before anything is created."],
                ["Stock in and sell", "Record opening stock under Stock In, then ring up your first sale from the till."],
                ["Invite your team", "Add staff under Dashboard → Staff, give each a role, and set PINs for those who will use the shared till."],
              ]}
            />
            <H3>How staff sign in</H3>
            <Cards
              items={[
                { title: "Email & password", body: "Owners, admins and managers sign in normally. They land on the dashboard.", tag: "Full login" },
                { title: "Business code + PIN", body: "Staff type the business code once on the till device, then use only their PIN afterwards. They land straight on the till (or their trade's front desk) because speed matters at the counter.", tag: "Till mode" },
              ]}
            />
            <Callout kind="tip">
              The business code is shown to owners in the Help panel (the “Stuck? Ask here” button at the bottom of the sidebar). Account-login staff without dashboard access land on their own home screen with clock in/out, tasks and schedule.
            </Callout>
          </Section>

          <Section
            id="structure"
            eyebrow="Start here"
            title="Accounts, businesses & branches"
            intro="StarTrack is built to scale from a single shop to a group of businesses, each with several locations."
          >
            <Checks
              items={[
                "One account can own several businesses (Business plan) — e.g. a restaurant and a water factory.",
                "Each business can have several branches (Pro: up to 3; Business: unlimited).",
                "Stock, sales, staff, alerts and metrics are scoped to the branch you're working in.",
                "Switch between businesses from Settings → My Businesses.",
                "The All Stores dashboard (Business plan) rolls up profit, loss and stock across every business you own.",
                "Staff can be tied to one branch, or to all branches.",
              ]}
            />
            <Callout kind="info" title="Tenant isolation">
              Every request carries the account and business it belongs to, derived from the signed-in session — never from anything typed into a form. One customer can never read another's data.
            </Callout>
          </Section>

          <Section
            id="roles"
            eyebrow="Start here"
            title="Roles & permissions"
            intro="Four roles set sensible defaults. Individual people can be given extra permissions on top, without changing their role."
          >
            <Table
              head={["Role", "Default access"]}
              rows={[
                ["Owner", "Everything, across the account."],
                ["Admin", "Sales, returns and approvals, voids, stock, prices, expenses, both dashboards (operations + finance), staff management, settings, customers, activity, audit and support."],
                ["Manager", "Sales, returns and approvals, voids, stock, prices, expenses, operations dashboard, customers, activity and support. No finance view and no staff management by default."],
                ["Staff", "Sales, returns (request) and their own activity — the till and nothing more."],
              ]}
            />
            <H3>Permission keys</H3>
            <Table
              head={["Permission", "What it unlocks"]}
              rows={[
                [<Code key="a">sales</Code>, "Use the till and view sales."],
                [<Code key="b">returns</Code>, "Start a return."],
                [<Code key="c">approve_returns</Code>, "Approve or reject a return (this is when stock and money move)."],
                [<Code key="d">void_sales</Code>, "Cancel a completed sale."],
                [<Code key="e">stock</Code>, "Stock in, adjustments, waste, transfers, counts, suppliers."],
                [<Code key="f">prices</Code>, "Create, edit and delete products and prices; import and photos."],
                [<Code key="g">expenses</Code>, "Record and view expenses."],
                [<Code key="h">dashboard_ops</Code>, "Operations dashboard, sales history, reports, Ask AI."],
                [<Code key="i">dashboard_finance</Code>, "Cost, profit and the All Stores dashboard."],
                [<Code key="j">staff_mgmt</Code>, "Add staff, set roles, PINs and shifts."],
                [<Code key="k">settings</Code>, "Business settings, receipt designer, audit log."],
                [<Code key="l">customers</Code>, "Customer records and loyalty cards."],
              ]}
            />
            <Callout kind="tip" title="Cost and profit are protected on the server">
              A cashier without the finance permission never receives cost or margin figures at all — the server strips them before the response leaves, rather than hiding them in the page.
            </Callout>
            <P>
              Job titles and reporting lines (shown in the Staff org-chart view) are purely organisational. They never grant or remove access; only the role and permission overrides do.
            </P>
          </Section>

          {/* ═══ DAILY OPERATIONS ═══ */}
          <Section
            id="selling"
            eyebrow="Daily operations"
            title="Selling at the till"
            intro="The till is the heart of the app. It is named for your trade — “Order Point” for a restaurant, “Front Desk” for a hotel, “Sales Point” for a water factory — but the engine is the same."
          >
            <Checks
              items={[
                "Search by name or SKU, or scan a barcode (Pro) — press Enter to add the matching item.",
                "Adjust quantities, apply discounts and see VAT calculated automatically.",
                "Attach a customer (existing or new) with an optional phone/WhatsApp number.",
                "Split payments across cash, POS terminal and bank transfer — at most one line per method, and they must add up to the total.",
                "Cash handed over and change given are recorded so the till count balances at close.",
                "Made-to-order items (blinds, curtains, tailoring) are priced from dimensions you enter, such as width × height.",
                "Serial-numbered goods (electronics) are tied to the specific unit sold.",
                "Loyalty cards can be scanned by QR to apply the card's discount.",
              ]}
            />
            <H3>Receipts</H3>
            <P>
              After checkout a receipt appears with three options: <strong>Print</strong>, <strong>WhatsApp</strong> (opens WhatsApp with the receipt text addressed to the customer's number) and close. Each sale gets a sequential sale number. Owners can customise the receipt (Pro) or pick a designed template with an AI-written message (Business).
            </P>
            <H3>Sales history</H3>
            <P>
              <strong>History</strong> lists every sale with filters and detail view. Staff without dashboard rights see only their own sales under <strong>My Activity</strong>.
            </P>
          </Section>

          <Section
            id="offline"
            eyebrow="Daily operations"
            title="Working offline"
            intro="Shops lose connectivity. The till keeps working."
          >
            <Steps
              items={[
                ["The sale is queued", "If checkout can't reach the server, the sale is stored on the device, per business and branch, and the till shows how many are waiting."],
                ["It syncs on its own", "When the network returns the queue replays oldest-first. A service worker can also finish the job in the background, even if the tab was closed (where the browser supports Background Sync)."],
                ["Nothing posts twice", "Every queued sale carries a unique client ID and the server de-duplicates on it, so retrying is always safe."],
                ["Problems are flagged", "If the server rejects a queued sale (for example, insufficient stock by the time it syncs), it stays in the queue with the reason so a person can decide what to do."],
              ]}
            />
            <Callout kind="warn" title="What works offline">
              The app shell loads from cache and sales queue locally. Screens that read live data (dashboard, reports, AI) need a connection.
            </Callout>
          </Section>

          <Section
            id="returns"
            eyebrow="Daily operations"
            title="Returns, voids & refunds"
            intro="Anything that undoes a sale is deliberate, permissioned and recorded."
          >
            <Cards
              items={[
                { title: "Returns with approval", body: "Staff can request a return against a sale. A manager or admin approves or rejects it; only on approval does stock go back and money get adjusted. Pending returns raise an alert.", tag: "Pro" },
                { title: "Voiding a sale", body: "Users with the void permission can cancel a completed sale. Stock is restored and, for credit sales, the customer's ledger is reversed. Voids appear in the audit log and in staff performance reports." },
              ]}
            />
          </Section>

          <Section
            id="inventory"
            eyebrow="Daily operations"
            title="Products & inventory"
            intro="Stock is the source of truth for the whole app. Every change is a recorded movement, so you can always explain why a number is what it is."
          >
            <Cards
              cols={3}
              items={[
                { title: "Catalog", body: "Products with SKU (trade-prefixed), category, unit, price, cost, reorder level and optional expiry. Archive instead of destroying history." },
                { title: "Stock In", body: "Record deliveries and opening balances per branch, with supplier and cost." },
                { title: "Adjustments & waste", body: "Correct counts and write off spoilage or breakage with a reason, kept in the movement log." },
                { title: "Branch transfers", body: "Move stock between branches with matching movements on both sides.", tag: "Pro" },
                { title: "Stock counts", body: "Run a physical count, compare with the system and reconcile the differences.", tag: "Pro" },
                { title: "Suppliers", body: "Keep supplier records and what you buy from them.", tag: "Pro" },
                { title: "Expiry tracking", body: "Dates on stock and “expiring soon” alerts before it goes off.", tag: "Pro" },
                { title: "Barcodes & labels", body: "Scan at the till and print barcode labels for your products.", tag: "Pro" },
                { title: "Product photos", body: "Upload a photo, or let StarTrack suggest candidates from the product name — nothing is attached until a person approves it.", tag: "Pro" },
              ]}
            />
            <H3>Bulk import</H3>
            <P>
              Upload a spreadsheet and StarTrack's AI reads it: it guesses which column is the name, price, cost and quantity, skips duplicates, and shows a preview. Nothing is created until you press approve. A downloadable template is available if you'd rather start from a clean sheet.
            </P>
            <H3>Movement history</H3>
            <P>
              Every sale, return, stock-in, adjustment, waste entry and transfer writes a stock movement. The Dashboard's Movement tab and the inventory report read from this log.
            </P>
          </Section>

          <Section
            id="customers"
            eyebrow="Daily operations"
            title="Customers & loyalty"
            intro="Know who buys, how much, and who owes you."
          >
            <Checks
              items={[
                "Customer records with contact details and purchase history.",
                "Top spenders, newest customers and outstanding balances in the Customers report.",
                "Customer credit (water, poultry, cold-room trades): supply now, invoice later, with a running ledger per customer.",
                "Loyalty cards (Pro): QR cards for regulars with a scan-to-apply discount and rules for who qualifies, configured in Settings → Loyalty Cards.",
                "Cards can be emailed to the customer and opened on a public page at /loyalty/<code> — no login needed.",
                "Scan a card with the device camera at the till to apply the discount.",
                "Water trade only: reward tokens from repeat purchases, redeemable for free packs.",
              ]}
            />
          </Section>

          <Section
            id="expenses"
            eyebrow="Daily operations"
            title="Expenses"
            intro="Spending is recorded against the business so profit reflects reality, not just sales."
          >
            <P>
              Record an expense with a category, amount, date and note. Expenses feed the dashboard's Expenses tab, the profit figures, the Expenses report and the AI assistant. The module can be switched off for trades that don't need it.
            </P>
          </Section>

          <Section
            id="staff"
            eyebrow="Daily operations"
            title="Staff, attendance & tasks"
            intro="Everything about the people running the business."
          >
            <Cards
              cols={3}
              items={[
                { title: "Staff management", body: "Add people, set role, branch, PIN, position and who they report to. An org-chart view shows the structure." },
                { title: "Shifts & schedule", body: "Named work windows (for example “Morning 8am–2pm”) assigned to staff, with a roster so nobody has to guess when they're next in." },
                { title: "Attendance", body: "Staff clock in and out from their own home screen. Attendance records what actually happened, separate from the plan.", tag: "Pro" },
                { title: "Tasks", body: "Managers assign tasks with priority; staff see theirs on their home screen with urgent items flagged." },
                { title: "Announcements", body: "Short notices for the team, scoped to a branch." },
                { title: "Staff performance", body: "Sales, discounts, voids and hours per person — in the dashboard and as a downloadable report." },
              ]}
            />
          </Section>

          {/* ═══ INSIGHT ═══ */}
          <Section
            id="dashboard"
            eyebrow="Insight"
            title="Dashboard & reports"
            intro="Today's numbers by default, with tabs for everything else."
          >
            <H3>Dashboard tabs</H3>
            <Table
              head={["Tab", "Shows", "Plan"]}
              rows={[
                ["Overview", "Revenue, profit, transactions, trend vs. the last 7 days, top-selling products, low stock.", "All"],
                ["Sales", "Sales breakdown by period, staff, category and payment method.", "All"],
                ["Expenses", "Spending by category and over time.", "All"],
                ["Inventory", "Stock on hand, its value and the reorder list.", "Pro"],
                ["Movement", "Every stock movement, filterable.", "Pro"],
                ["Customers", "Top spenders, new customers, balances owed.", "Pro"],
                ["Staff", "Performance per person.", "Pro"],
                ["Expiry & Archive", "Items nearing expiry; archived products.", "Pro"],
              ]}
            />
            <H3>Downloadable reports (Pro)</H3>
            <P>
              Every report is built fresh from the database at the moment you download it, in PDF or Excel, and is gated by the same permission as the screen it mirrors — a report can never show someone more than the app would.
            </P>
            <Cards
              cols={3}
              items={[
                { title: "Business summary", body: "Today, this week, top sellers and stock alerts on one page." },
                { title: "Sales report", body: "Revenue, profit, staff, category and payment breakdown for 1, 7, 30 or 90 days." },
                { title: "Sales transactions", body: "Every receipt in the period, line by line." },
                { title: "Expenses report", body: "What was spent, on what, and by whom." },
                { title: "Inventory report", body: "Stock on hand and its value, reorder list and expiry." },
                { title: "Customers report", body: "Top spenders, newest customers and who owes money." },
                { title: "Staff performance", body: "Sales, discounts, voids and hours per person." },
              ]}
            />
            <Callout kind="tip" title="If a dashboard number looks wrong">
              Owners can use Settings → Advanced → Recalculate this period. It reads sales, returns and expenses back and rewrites the daily summary. Nothing is deleted.
            </Callout>
            <H3>All Stores (Business plan)</H3>
            <P>Profit, loss and stock across every business you own, in one view.</P>
          </Section>

          <Section
            id="ai"
            eyebrow="Insight"
            title="AI assistant"
            intro="An assistant that reads your live data and can propose actions — but never acts without your approval. Available on Pro and above."
          >
            <Cards
              items={[
                { title: "Daily digest", body: "A short written summary of how the business is doing, generated from your real numbers." },
                { title: "Ask AI", body: "Chat about your business. Every figure the assistant quotes comes from your data; it can see only what your role is allowed to see (no cost or margin for people without the finance permission)." },
                { title: "Help in every module", body: "From any screen you can ask about that module, with context tailored to your trade (for example cold-chain shrinkage or flock conversion ratios)." },
                { title: "Reports on request", body: "Ask for “a PDF of this month's sales” and the assistant hands you a download card. The file is built from the database, not from the model's memory." },
                { title: "Spreadsheet import", body: "Attach a spreadsheet in chat; the assistant maps the columns and shows an import preview to approve." },
                { title: "Restock suggestions", body: "Suggested reorder quantities for low items with reasoning. Approve to apply the stock-in, or dismiss." },
                { title: "Saved chat history", body: "Conversations are saved so you can return to, rename or delete them." },
                { title: "Read-only receipt writer", body: "On the Business plan, AI can draft the message printed on your receipts and your public page copy." },
              ]}
            />
            <H3>Actions the assistant can propose</H3>
            <P>
              Create a customer, create a product, adjust stock, record a sale, process a return, create a staff member, record an expense, archive products and import a catalog. Each appears as a pending action card. <strong>Nothing happens until a person with the matching permission approves it</strong>, and approvals are checked against that person's rights, not the assistant's.
            </P>
            <Callout kind="info" title="AI must be configured">
              The assistant needs an AI provider key on the server. When none is set, AI features stay off and say so, rather than failing silently.
            </Callout>
          </Section>

          <Section
            id="alerts"
            eyebrow="Insight"
            title="Alerts & notifications"
            intro="StarTrack tells you before you have to notice."
          >
            <Checks
              items={[
                "Out of stock — something has run out completely.",
                "Running low — stock has fallen to its reorder level.",
                "Expiry — stock nearing or past its date.",
                "Returns waiting — a return needs a manager's decision.",
                "A notification bell in the header collects these in-app.",
                "Email alerts over SMTP (Gmail by default), with a choice of who else hears them.",
                "Gym renewal reminders by SMS (opt-in).",
                "Each alert type can be switched on or off under Settings → Alerts.",
              ]}
            />
          </Section>

          {/* ═══ BUILT FOR YOUR TRADE ═══ */}
          <Section
            id="industries"
            eyebrow="Built for your trade"
            title="Industry modules"
            intro={`StarTrack ships ${types.length} industry setups. Each pre-loads categories, vocabulary, the right optional features and the trade-specific screens listed below.`}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {types.map(([key, t]) => (
                <div key={key} className="rounded-2xl border border-line bg-surface p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-extrabold text-[17px] text-t1">{t.label}</div>
                      <div className="text-[13.5px] text-t3 mt-0.5 leading-snug">{t.tagline}</div>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold px-2 py-1 rounded-lg bg-surface-3 text-t3 font-mono">{t.skuPrefix || "GEN"}</span>
                  </div>
                  <dl className="mt-4 space-y-3 text-[13.5px]">
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-t4 mb-1.5">Till is called</dt>
                      <dd className="text-t2">{t.posLabel} <span className="text-t4">· sells “{t.terminology.products}”</span></dd>
                    </div>
                    {t.capabilities.length > 0 && (
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-wider text-t4 mb-1.5">Trade tools</dt>
                        <dd className="flex flex-wrap gap-1.5">
                          {t.capabilities.map((c) => (
                            <span key={c} className="px-2.5 py-1 rounded-full bg-primary-soft text-primary text-[12px] font-semibold">{CAPABILITIES[c]?.label || c}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-t4 mb-1.5">Starter categories</dt>
                      <dd className="text-t3 leading-relaxed">{t.defaultCategories.join(" · ")}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <H3>Trade-specific screens</H3>
            <Table
              head={["Screen", "Where", "What it does"]}
              rows={[
                ["Front Desk (Hotel)", "Till group", "Rooms as a calendar, check-in/out, and a folio that collects charges from reception, kitchen and extras and settles once at check-out."],
                ["Kitchen Queue", "Till group", "Sale lines routed to the kitchen with a prep status per line."],
                ["Job Tickets", "Till group", "Work taken in, progressed through stages over days, then collected. Used by blinds, electronics and laundry."],
                ["Members (Gym)", "Till group", "Membership plans, subscriptions, check-ins and renewal reminders."],
                ["Academy", "Till group", "Courses run as intakes; students enrol, pay fees in instalments and are marked present each session."],
                ["Appointments (Salon)", "Till group", "Booked time against a person or a chair, with service catalog."],
                ["Projects (Agency)", "Till group", "Work agreed for a budget, delivered in milestones, paid in stages and logged against hours."],
                ["Cold Room", "Till group", "Cartons converted into kilograms and pieces, with shrinkage and power-failure loss tracked explicitly."],
                ["Serial Numbers", "Stock group", "Each unit tracked individually with warranty and repair history."],
                ["Production", "Stock group", "Consume raw materials, yield finished goods and measure the waste between."],
                ["Batches (Poultry)", "Stock group", "Living batches that eat daily, suffer mortality and are harvested."],
                ["Vaccination & Medication", "Dashboard group", "Dosage records for a flock or batch with next-due tracking."],
              ]}
            />
            <Callout kind="info" title="Service businesses sell time, not stock">
              Academy, Salon and Agency record their money as ordinary sales and daily metrics, so the dashboard, reports and AI treat them like any other business.
            </Callout>
          </Section>

          <Section
            id="capabilities"
            eyebrow="Built for your trade"
            title="Capability reference"
            intro="A capability is a structural building block a trade cannot work without — the reason a supermarket's software fails a poultry farm. Trades are assembled from these."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {capEntries.map(([key, c]) => (
                <div key={key} className="rounded-xl border border-line bg-surface px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[14.5px] text-t1">{c.label}</span>
                    <Code>{key}</Code>
                  </div>
                  <p className="text-[13.5px] text-t3 mt-1 leading-relaxed">{c.hint}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="optional-modules"
            eyebrow="Built for your trade"
            title="Optional features"
            intro="Anything your business doesn't use can be switched off under Settings → Features, so the sidebar only shows what you need."
          >
            <Table
              head={["Feature", "What it does"]}
              rows={TOGGLEABLE_MODULES.map((m) => [m.label, m.hint])}
            />
          </Section>

          {/* ═══ BRAND & ADMIN ═══ */}
          <Section
            id="brand"
            eyebrow="Brand & admin"
            title="Receipts & your business page"
            intro="Make StarTrack look like your business."
          >
            <Cards
              items={[
                { title: "Receipt customisation", body: "Set the header, footer and which details a receipt shows — no template needed.", tag: "Pro" },
                { title: "Receipt templates & AI writer", body: "Choose a designed receipt layout and let the assistant draft your thank-you message.", tag: "Business" },
                { title: "Your own public page", body: "A customisable landing page for your business at /s/<your-slug>, with your brand, sections and products. Anyone can open it — no account required.", tag: "Business" },
                { title: "Business profile", body: "Name, logo, currency, VAT and printed details live under Settings → Business." },
              ]}
            />
          </Section>

          <Section
            id="audit"
            eyebrow="Brand & admin"
            title="Audit log, activity & support"
            intro="Accountability and help, built in."
          >
            <Cards
              items={[
                { title: "Audit log", body: "A timeline of sensitive actions — who did what, and when — such as voids, price changes, report downloads and AI-approved actions.", tag: "Business" },
                { title: "My Activity", body: "Every user can see their own sales and actions for the day." },
                { title: "Support tickets", body: "Raise a ticket from inside the app; the StarTrack support team sees and answers it from the platform console." },
                { title: "Help panel", body: "Till codes, shortcuts and common questions, one click from the sidebar." },
                { title: "Global search", body: "Press Ctrl/⌘ + K to jump to any page, product, customer, sale or expense." },
                { title: "Product tour", body: "A guided walkthrough for owners and a shorter one for staff, replayable at any time." },
              ]}
            />
          </Section>

          <Section
            id="plans"
            eyebrow="Brand & admin"
            title="Plans & billing"
            intro={PAYMENTS_ENABLED ? `Every plan is paid; Freemium is simply the lightest. Start on Freemium and your first month includes ${TRIAL_DAYS} days of Pro, free; when they end you carry on with Freemium.` : `Nobody is being charged right now. A new account gets ${TRIAL_DAYS} days of Pro (or the plan it picked), then carries on free on Freemium. Nothing is deleted when the trial ends.`}
          >
            <div className="grid gap-4 md:grid-cols-3">
              {PLAN_ORDER.map((k) => {
                const p = PLANS[k];
                return (
                  <div key={k} className={cn("rounded-2xl border p-5 bg-surface", k === "pro" ? "border-primary shadow-e2" : "border-line")}>
                    <div className="flex items-center justify-between">
                      <div className="font-extrabold text-[18px] text-t1">{p.name}</div>
                      {k === "pro" && <span className="text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full text-white" style={{ background: GRADIENT }}>Popular</span>}
                    </div>
                    <div className="text-[13.5px] text-t3 mt-0.5">{p.tagline}</div>
                    <div className="mt-4 font-extrabold text-[28px] tracking-[-0.03em] text-t1">{PAYMENTS_ENABLED ? fmtMoney(p.price, "₦") : "Free"}{PAYMENTS_ENABLED && <span className="text-[13px] font-semibold text-t4"> / month</span>}</div>
                    <ul className="mt-4 space-y-2">
                      {p.highlights.map((h) => (
                        <li key={h} className="flex gap-2 text-[13.5px] text-t2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" strokeWidth={3} /> {h}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <H3>Limits</H3>
            <Table
              head={["", ...PLAN_ORDER.map((k) => PLANS[k].name)]}
              rows={(["businesses", "branches", "staff", "products"] as const).map((n) => [
                n[0].toUpperCase() + n.slice(1),
                ...PLAN_ORDER.map((k) => PLANS[k].limits[n] ?? "Unlimited"),
              ])}
            />
            <H3>Which plan unlocks what</H3>
            <Table
              head={["Feature", "Included from", "What it does"]}
              rows={featureEntries.map(([, f]) => [f.label, PLANS[f.plan].name, f.blurb])}
            />
            <H3>How billing works</H3>
            <Checks
              items={[
                "Payments are processed by Paystack: card, bank transfer or USSD.",
                "Plans don't auto-renew, so there are no surprise charges. Pay again when you're ready.",
                "Payment is confirmed by asking Paystack what actually happened, both when you return and from its signed webhook, before any plan is applied.",
                "If a period lapses, the account drops to the lightest feature set and changes pause (you can still view everything) until you renew.",
                "Downgrading never deletes data. Higher-plan features lock, and if you're over a limit you simply can't add more until you're back under it.",
                "Accounts created before plans existed keep full access.",
              ]}
            />
          </Section>

          <Section
            id="platform"
            eyebrow="Brand & admin"
            title="Platform administration"
            intro="A separate console for the StarTrack team itself. It sits outside the tenant system and is never visible to customers."
          >
            <Table
              head={["Platform role", "Can do"]}
              rows={[
                ["Support", "View the overview, accounts, account detail and support tickets. Read-only."],
                ["Overseer", "Everything support can, plus change an account's plan or status, and add or remove platform staff."],
              ]}
            />
            <P>The console shows platform-wide totals, the list of accounts with their plans and status, and the queue of support tickets raised by customers.</P>
          </Section>

          {/* ═══ UNDER THE HOOD ═══ */}
          <Section
            id="security"
            eyebrow="Under the hood"
            title="Security & data integrity"
            intro="The rules that keep your numbers and your customers' data safe."
          >
            <Cards
              items={[
                { title: "Signed sessions", body: "Requests carry a signed token; tenant scoping always comes from the token, never from the request body." },
                { title: "Hashed secrets", body: "Passwords and till PINs are stored hashed, never in plain text." },
                { title: "Permission checks on the server", body: "Every endpoint checks the caller's permission. Hiding a button is never the only protection." },
                { title: "Cost stripped server-side", body: "People without the finance permission never receive cost or profit data." },
                { title: "Validated input", body: "Every request body is validated against a schema before it touches the database." },
                { title: "Rate limiting", body: "Sensitive endpoints such as report downloads, AI and verification codes are rate-limited." },
                { title: "Transactions", body: "A sale, its stock movements and its metrics are written together so they can't get out of step." },
                { title: "Idempotent sales", body: "Each sale carries a client ID so retries and offline replays can never double-post." },
                { title: "Audit trail", body: "Sensitive actions are logged with who, what and when." },
                { title: "AI guardrails", body: "The assistant proposes; humans approve. Actions are checked against the approver's permissions." },
              ]}
            />
          </Section>

          <Section
            id="architecture"
            eyebrow="Under the hood"
            title="Architecture & tech stack"
            intro="One repository, two halves: a web client and an API that serves it."
          >
            <Table
              head={["Layer", "Technology"]}
              rows={[
                ["Web client", "React 19, TypeScript, React Router, Tailwind CSS 4, Recharts, Lucide icons, built with Vite"],
                ["Installable app", "Progressive web app with a custom service worker (offline shell, background sync of queued sales)"],
                ["API", "Node.js 20+, Express, Zod validation, JWT sessions"],
                ["Database", "MongoDB through Mongoose"],
                ["Files & media", "Cloudinary for images; PDFKit and ExcelJS for reports; QR and barcode generation and scanning in the browser"],
                ["Messaging", "SMTP / Gmail (email) and Termii (SMS)"],
                ["Payments", "Paystack"],
                ["Hosting", "Static client plus a serverless API function on Netlify, or a single Node process on Render"],
              ]}
            />
            <P>
              In production the API serves the built client from the same origin, so the browser talks to a single address and there is no cross-origin setup. Server code is organised as modules (sales, inventory, customers, AI, reports and so on), with each trade's logic isolated under its own folder.
            </P>
          </Section>

          <Section
            id="shortcuts"
            eyebrow="Under the hood"
            title="Shortcuts & FAQ"
          >
            <Table
              head={["Shortcut", "Action"]}
              rows={[
                [<span key="1" className="inline-flex gap-1"><Kbd>Ctrl</Kbd> / <Kbd>⌘</Kbd> + <Kbd>K</Kbd></span>, "Open search from anywhere"],
                [<Kbd key="2">Enter</Kbd>, "In POS search: add the scanned or matching item"],
                [<Kbd key="3">Esc</Kbd>, "Close whatever is open"],
              ]}
            />
            <H3>Frequently asked questions</H3>
            <Faq
              items={[
                ["How do my staff sign in?", "They type the business code once on the till device, then use only their PIN afterwards. Add staff and set PINs under Dashboard → Staff."],
                ["Why can't my cashier see profit?", "Cost and profit are removed on the server for accounts without the finance permission. Grant it on their staff record if they should see it."],
                ["The internet went down mid-sale.", "Keep selling. Sales queue on the device and sync when the connection returns; the till shows how many are waiting."],
                ["A dashboard number looks wrong.", "Settings → Advanced → Recalculate this period rewrites the summary from your sales, returns and expenses. Nothing is deleted."],
                ["Can I change my business type later?", "Business types set the starting vocabulary, categories and tools. For a different trade, add another business under My Businesses (Business plan allows several)."],
                !PAYMENTS_ENABLED
                  ? ["What happens when my trial ends?", `After ${TRIAL_DAYS} days you carry on free on Freemium. Nothing is deleted: your data stays, features from Pro lock, and if you're over a limit you simply can't add more.`]
                  : ["What happens when my free Pro days end?", `You carry on with the plan you paid for (Freemium), until your paid month ends. Pro features pause and Freemium limits apply; nothing is deleted. When a paid month ends and isn't renewed, the account becomes read-only until you renew.`],
                ["Can I try it before signing up?", "Yes — open the live demo from the landing page, pick your kind of business and explore a stocked sandbox."],
              ]}
            />

            <div className="rounded-3xl text-white p-8 sm:p-10 relative overflow-hidden" style={{ background: "radial-gradient(700px 360px at 85% 0%, #4a3be8 0%, transparent 60%), #0a1045" }}>
              <h3 className="text-[26px] sm:text-[32px] font-extrabold tracking-[-0.03em] leading-tight max-w-[520px]">Ready to run your business on StarTrack?</h3>
              <p className="mt-3 text-white/70 text-[15.5px] max-w-[520px]">{PAYMENTS_ENABLED ? `${TRIAL_DAYS} days of Pro with your first month.` : `${TRIAL_DAYS} days of Pro, free. No card needed.`} Set up in minutes.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/register" className="inline-flex items-center gap-2 h-12 px-6 rounded-full text-[15px] font-bold bg-white text-[#0a1045] hover:-translate-y-0.5 transition-transform">{PAYMENTS_ENABLED ? "Start free trial" : "Start free"} <ArrowRight className="w-4 h-4" /></Link>
                <Link to="/" className="inline-flex items-center gap-2 h-12 px-6 rounded-full text-[15px] font-bold text-white border border-white/25 bg-white/5 hover:bg-white/10 transition-colors">Back to home</Link>
              </div>
            </div>
          </Section>
        </main>
      </div>

      <footer className="border-t border-line">
        <div className="max-w-[1320px] mx-auto px-5 py-8 text-[13px] text-t4 flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} StarTrack. All rights reserved.</span>
          <Link to="/" className="hover:text-primary">Back to StarTrack</Link>
        </div>
      </footer>

      {/* Mobile drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[300px] max-w-[85vw] bg-canvas border-r border-line p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <span className="font-extrabold text-[17px] text-t1">Sections</span>
              <button onClick={() => setDrawer(false)} aria-label="Close" className="grid place-items-center w-9 h-9 rounded-full bg-surface-3 text-t1"><X className="w-4 h-4" /></button>
            </div>
            <div className="relative mb-5">
              <Search className="w-4 h-4 text-t4 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter sections…" className="w-full h-10 pl-10 pr-3 rounded-xl border border-line bg-surface text-[14px] text-t1 placeholder:text-t4 outline-none focus:border-primary" />
            </div>
            <TocList active={active} query={query} onPick={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-40 grid place-items-center w-12 h-12 rounded-full text-white shadow-e2 hover:-translate-y-0.5 transition-transform"
          style={{ background: GRADIENT }}
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

function Faq({ items }: { items: [string, string][] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3 max-w-[820px]">
      {items.map(([q, a], i) => (
        <div key={q} className={cn("rounded-2xl bg-surface border transition-colors", open === i ? "border-primary/50 shadow-e2" : "border-line")}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left">
            <span className="text-[15.5px] font-bold text-t1">{q}</span>
            <ChevronRight className={cn("w-5 h-5 text-primary shrink-0 transition-transform", open === i && "rotate-90")} />
          </button>
          {open === i && <p className="px-5 pb-5 -mt-1 text-[14.5px] text-t3 leading-relaxed">{a}</p>}
        </div>
      ))}
    </div>
  );
}
