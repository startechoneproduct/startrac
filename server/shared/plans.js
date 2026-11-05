/**
 * The three subscription plans, and which feature belongs to which. This one
 * file is read by the server (to refuse what a plan doesn't include) and by the
 * app and landing page (to show what each plan includes) — so what a plan
 * promises and what it enforces can never drift apart.
 *
 * Plans are paid, monthly (PAYMENTS_ENABLED below). Someone who signs up for
 * Freemium pays for it, and as a welcome gets Pro free for TRIAL_DAYS inside that
 * first paid month; when those days end they carry on with the Freemium they paid
 * for. Pro and Business sign-ups simply pay for what they chose. Prices are in
 * naira per month and live ONLY here so the landing page, the billing screen and
 * the payment amount can never disagree.
 */

export const PLAN_ORDER = ["free", "pro", "business"];

/**
 * Are plans being charged for? Yes: an account is read-only until its first payment,
 * and again whenever a paid month runs out, until it renews (Paystack checkout).
 * Set this to false to make every plan free: accounts then just drop to Freemium
 * when a period ends and nothing is ever paused.
 */
export const PAYMENTS_ENABLED = true;

/** The welcome bonus: this many days of BONUS_PLAN, once, for someone who pays for Freemium as their first plan. */
export const TRIAL_DAYS = 14;
export const BONUS_PLAN = "pro";

/** The plan an account gets free for its first TRIAL_DAYS after paying, or null (only Freemium sign-ups get one). */
export const bonusPlanFor = (signedUpFor) => (signedUpFor === "free" ? BONUS_PLAN : null);

export const PLANS = {
  free: {
    key: "free",
    name: "Freemium",
    tagline: "Run one shop, the simple way",
    price: 2000,
    // null = unlimited
    limits: { businesses: 1, branches: 1, staff: 2, products: 50, customers: 100 },
    highlights: [
      "1 business, 1 branch",
      "Up to 50 products & 100 customers",
      "2 staff accounts",
      "Point of sale & sales history",
      "Stock in & basic inventory",
      "Customers & expenses",
      "Basic dashboard",
      "Standard receipt",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    tagline: "Grow with AI and smarter stock",
    price: 7500,
    limits: { businesses: 1, branches: 3, staff: 10, products: 2000, customers: 2000 },
    highlights: [
      "Everything in Freemium",
      "Profit & loss: costs, margins and net profit",
      "AI assistant & Ask AI",
      "PDF & Excel reports",
      "Spreadsheet import, read by AI",
      "Barcodes & label printing",
      "Loyalty cards",
      "Invoices & part-payments",
      "Branch transfers",
      "Expiry tracking",
      "Suppliers & stock counts",
      "Custom receipt (no template)",
      "Up to 3 branches, 10 staff, 2,000 customers",
    ],
  },
  business: {
    key: "business",
    name: "Business",
    tagline: "Everything, for serious operators",
    price: 20000,
    limits: { businesses: null, branches: null, staff: null, products: null, customers: null },
    highlights: [
      "Everything in Pro",
      "Unlimited branches, staff, products & customers",
      "Multiple businesses + All-stores dashboard",
      "Your logo on every receipt",
      "Receipt templates & AI receipt writer",
      "Your own business landing page",
      "Audit log",
      "Priority support",
    ],
  },
};

/** Each gated feature, and the lowest plan that includes it. Anything not listed is free. */
export const FEATURES = {
  ai: { plan: "pro", label: "AI assistant", blurb: "Ask questions about your business, draft actions and import spreadsheets." },
  reports: { plan: "pro", label: "Reports", blurb: "Download PDF and Excel reports." },
  advancedDashboard: { plan: "pro", label: "Full dashboard", blurb: "Profit and loss, inventory, movement, customers, staff and archive views, on top of Overview, Sales and Expenses." },
  barcodes: { plan: "pro", label: "Barcodes & labels", blurb: "Scan products at the till and print barcode labels." },
  loyalty: { plan: "pro", label: "Loyalty cards", blurb: "Reward repeat customers with QR loyalty cards." },
  transfers: { plan: "pro", label: "Branch transfers", blurb: "Move stock between your branches." },
  expiry: { plan: "pro", label: "Expiry tracking", blurb: "Track expiry dates and get warned before stock goes off." },
  suppliers: { plan: "pro", label: "Suppliers", blurb: "Keep supplier records and what you buy from them." },
  stockCount: { plan: "pro", label: "Stock counts", blurb: "Count stock and reconcile differences." },
  returns: { plan: "pro", label: "Returns & refunds", blurb: "Process returns with approvals." },
  attendance: { plan: "pro", label: "Attendance", blurb: "Clock staff in and out." },
  invoices: { plan: "pro", label: "Invoices", blurb: "Bill customers, track what they owe, record part-payments and send invoices by link, WhatsApp, email or PDF." },
  csvImport: { plan: "pro", label: "Bulk import", blurb: "Import products from a spreadsheet." },
  productPhotos: { plan: "pro", label: "Product photos", blurb: "Add photos to products, or find them by name." },
  verticals: { plan: "pro", label: "Trade-specific tools", blurb: "Rooms, memberships, classes, appointments, kitchen queue, cold room and more." },
  receiptCustom: { plan: "pro", label: "Custom receipt", blurb: "Set your receipt's header, footer and what it shows." },
  receiptTemplates: { plan: "business", label: "Receipt templates", blurb: "Pick a designed receipt layout and let AI write your message." },
  receiptLogo: { plan: "business", label: "Logo on receipts", blurb: "Print your business logo at the top of every receipt." },
  multiStore: { plan: "business", label: "All-stores dashboard", blurb: "Profit, loss and stock across all your businesses." },
  sitePage: { plan: "business", label: "Business landing page", blurb: "Your own public page, customised to your brand." },
  auditLog: { plan: "business", label: "Audit log", blurb: "See who changed what, and when." },
};

export const planRank = (plan) => Math.max(0, PLAN_ORDER.indexOf(plan));
export const isPlan = (v) => PLAN_ORDER.includes(v);

/** Does this plan include this feature? Unknown features are open to everyone. */
export function planAllows(plan, feature) {
  const f = FEATURES[feature];
  return !f || planRank(plan) >= planRank(f.plan);
}

export const requiredPlanFor = (feature) => FEATURES[feature]?.plan || "free";

/** Every feature key this plan includes. */
export const featuresFor = (plan) => Object.keys(FEATURES).filter((k) => planAllows(plan, k));

/** A plan's cap for "businesses" | "branches" | "staff" | "products"; null = unlimited. */
export const limitOf = (plan, name) => (PLANS[plan] || PLANS.free).limits[name] ?? null;

/**
 * Where an account stands.
 *  - demo sandboxes show everything;
 *  - early-access accounts (no subscription, or `grandfathered`) keep full
 *    access for good — that is how accounts that existed before the trial rules
 *    were carried over;
 *  - everyone else has a plan that runs until `periodEnd` (a trial first, then
 *    any period StarTrack staff grant). When it ends the account drops to
 *    Freemium. With payments off that is all that happens; with payments on it
 *    is also `lapsed`, and the server pauses changes until it renews.
 */
export function planStatus(account, now = new Date()) {
  if (!account) return { plan: "free", lapsed: true, trial: false, legacy: false, periodEnd: null };
  if (account.isSandbox) return { plan: "business", lapsed: false, trial: false, legacy: false, periodEnd: null };
  const sub = account.subscription;
  if (!sub || !sub.plan || sub.grandfathered) return { plan: "business", lapsed: false, trial: false, legacy: true, periodEnd: null };

  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const paid = isPlan(sub.plan) && !!end && end >= now;
  if (!paid) {
    // Never paid (no period yet) or the paid month has run out.
    return { plan: "free", lapsed: PAYMENTS_ENABLED, trial: false, legacy: false, periodEnd: end, paidUntil: end, awaitingPayment: !end, trialEnded: !!sub.trial };
  }

  // The welcome bonus: a bigger plan, free, for a few days inside what was paid for.
  const bonus = sub.bonus;
  const bonusUntil = bonus?.until ? new Date(bonus.until) : null;
  if (bonusUntil && isPlan(bonus.plan) && bonusUntil > now && planRank(bonus.plan) > planRank(sub.plan)) {
    return { plan: bonus.plan, lapsed: false, trial: true, legacy: false, periodEnd: bonusUntil, paidUntil: end, paidPlan: sub.plan };
  }
  return { plan: sub.plan, lapsed: false, trial: !!sub.trial, legacy: false, periodEnd: end, paidUntil: end, paidPlan: sub.plan, trialEnded: !!bonusUntil && bonusUntil <= now };
}

/** The plan whose features apply right now. */
export const effectivePlan = (account, now) => planStatus(account, now).plan;

/** True when the account predates plans and was carried over with full access. */
export const isLegacyAccount = (account) => !!account && !account.isSandbox && (!account.subscription || !account.subscription.plan || !!account.subscription.grandfathered);
