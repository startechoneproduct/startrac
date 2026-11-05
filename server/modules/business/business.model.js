import mongoose from "mongoose";

// A brand/shop within an account. Carries the business type (vertical) and its
// settings. This is what the user thinks of as "my business".
const businessSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    name: { type: String, required: true, trim: true },
    typeKey: { type: String, default: "restaurant" }, // hotel | electronics | blinds | water | poultry | restaurant
    // What the business is REGISTERED as, versus what the sign says. Receipts
    // and invoices need the legal name; customers only ever see the trading one.
    tradingName: { type: String, default: "", trim: true },
    taxId: { type: String, default: "", trim: true },
    employees: { type: Number, default: 0, min: 0 },
    // Short code staff type once on a till device before PIN login.
    code: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    // The public page at /s/<slug> — owner-edited (modules/site). Absent until the
    // owner first opens the editor; `enabled` is what actually publishes it.
    // Logo/hero files are only ever set through the upload route, never from a
    // client-supplied URL, so a page can't be pointed at arbitrary hosts.
    site: {
      enabled: { type: Boolean, default: false },
      slug: { type: String, trim: true, lowercase: true },
      template: { type: String, enum: ["classic", "bold", "minimal"], default: "classic" },
      mode: { type: String, enum: ["light", "dark"], default: "light" },
      accent: { type: String, default: "#3538f0" },
      headline: { type: String, default: "" },
      tagline: { type: String, default: "" },
      about: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
      logoPublicId: { type: String, default: "" },
      heroUrl: { type: String, default: "" },
      heroPublicId: { type: String, default: "" },
      contact: {
        phone: { type: String, default: "" },
        whatsapp: { type: String, default: "" },
        email: { type: String, default: "" },
        address: { type: String, default: "" },
        mapUrl: { type: String, default: "" },
      },
      social: {
        instagram: { type: String, default: "" },
        facebook: { type: String, default: "" },
        tiktok: { type: String, default: "" },
        website: { type: String, default: "" },
      },
      // Seven entries, Sunday = 0. Empty = hours aren't shown.
      hours: { type: [{ _id: false, day: Number, open: String, close: String, closed: Boolean }], default: [] },
      show: {
        about: { type: Boolean, default: true },
        products: { type: Boolean, default: true },
        hours: { type: Boolean, default: true },
        contact: { type: Boolean, default: true },
        stats: { type: Boolean, default: true },
        features: { type: Boolean, default: true },
        gallery: { type: Boolean, default: true },
        testimonials: { type: Boolean, default: true },
        faq: { type: Boolean, default: true },
        cta: { type: Boolean, default: true },
      },
      // A thin bar above the page ("Free delivery this week").
      announcement: { type: String, default: "" },
      aboutImageUrl: { type: String, default: "" },
      aboutImagePublicId: { type: String, default: "" },
      stats: { type: [{ _id: false, value: String, label: String }], default: [] },
      features: { type: [{ _id: false, icon: String, title: String, text: String }], default: [] },
      // Photos are added/removed through the upload routes, never from the form.
      gallery: { type: [{ _id: false, url: String, publicId: String }], default: [] },
      testimonials: { type: [{ _id: false, name: String, role: String, quote: String, rating: Number }], default: [] },
      faqs: { type: [{ _id: false, q: String, a: String }], default: [] },
      cta: {
        headline: { type: String, default: "" },
        text: { type: String, default: "" },
        label: { type: String, default: "" },
        action: { type: String, enum: ["whatsapp", "call", "email", "directions"], default: "whatsapp" },
      },
      // Order of the middle sections on the page.
      order: { type: [String], default: [] },
      productMode: { type: String, enum: ["all", "featured", "none"], default: "all" },
      featuredIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      // How many times the page was opened, and how many of those came from the
      // printed QR code — so an owner can see whether the poster is earning its wall.
      visits: { type: Number, default: 0 },
      qrScans: { type: Number, default: 0 },
      // The online store: customers register on the page, then order from it.
      // Off by default — a page with this off is the plain public brochure it
      // always was.
      storefront: {
        enabled: { type: Boolean, default: false },
        // A pause switch: the shop stays visible but takes no new orders.
        acceptingOrders: { type: Boolean, default: true },
        // The branch whose stock online orders sell from. Empty = the first branch.
        branchId: { type: mongoose.Schema.Types.ObjectId, default: null },
        pickup: { type: Boolean, default: true },
        delivery: { type: Boolean, default: false },
        deliveryFee: { type: Number, default: 0, min: 0 },
        freeDeliveryOver: { type: Number, default: 0, min: 0 }, // 0 = never free
        minOrder: { type: Number, default: 0, min: 0 },
        payOnDelivery: { type: Boolean, default: true },
        payAtPickup: { type: Boolean, default: true },
        transfer: { type: Boolean, default: false },
        bankName: { type: String, default: "" },
        accountName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        // Shown to the customer after they order ("Ready in about 30 minutes").
        leadTime: { type: String, default: "" },
        instructions: { type: String, default: "" },
        // Customers must have a delivery area on file only if the owner says so.
        deliveryAreas: { type: String, default: "" },
      },
    },
    settings: {
      currency: { type: String, default: "₦" }, // the symbol printed on prices, receipts and reports
      // ISO code ("NGN"). No default: businesses from before codes have only the
      // symbol, and currencyCodeOf() works the code out from it.
      currencyCode: { type: String },
      // The business's own logo (bytes in FileDoc, see business/logo.js) and the
      // contact details printed under its name on every receipt and invoice.
      logo: {
        fileId: { type: mongoose.Schema.Types.ObjectId, default: null },
        mime: { type: String, default: "" },
        version: { type: Number, default: 0 },
      },
      address: { type: String, default: "" },
      phone: { type: String, default: "" },
      vatEnabled: { type: Boolean, default: false },
      vatRate: { type: Number, default: 7.5 },
      // How this business's invoices read and when they fall due.
      invoice: {
        dueDays: { type: Number, default: 14, min: 0, max: 365 },
        terms: { type: String, default: "Payment is due by the date shown above." },
        footer: { type: String, default: "Thank you for your business." },
        bankName: { type: String, default: "" },
        accountName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
      },
      receiptFooter: { type: String, default: "Thank you for your patronage!" },
      // How the printed/shared receipt looks (see receiptDesign.js, which also
      // applies what the plan allows). Template choice needs the Business plan.
      receipt: {
        template: { type: String, enum: ["classic", "modern", "compact", "bold"], default: "classic" },
        headerNote: { type: String, default: "" },
        address: { type: String, default: "" },
        phone: { type: String, default: "" },
        showTaxId: { type: Boolean, default: false },
        showCashier: { type: Boolean, default: true },
        showCustomer: { type: Boolean, default: true },
        showPayments: { type: Boolean, default: true },
        paperWidth: { type: String, enum: ["58", "80"], default: "80" },
        textSize: { type: String, enum: ["sm", "md", "lg"], default: "md" },
      },
      // Kept for documents written before alerts went multi-recipient. Read
      // through alertRecipients() below, never directly.
      alertEmail: { type: String, default: "" },
      // Everyone who should hear about low stock, expiry and pending returns.
      // A shop usually wants the owner AND whoever actually does the ordering.
      alertEmails: { type: [String], default: undefined },
      alerts: {
        lowStock: { type: Boolean, default: true },
        outOfStock: { type: Boolean, default: true },
        expiry: { type: Boolean, default: true },
        pendingReturns: { type: Boolean, default: true },
        // Days before expiry to speak up. Each threshold fires once per
        // product per expiry date, so a tightening set escalates rather
        // than repeats: a month's notice, a fortnight's, then a week's.
        expiryDays: { type: [Number], default: [30, 14, 7] },
        // Whether anything is emailed at all — the in-app bell is always on.
        email: { type: Boolean, default: true },
      },
      // Which optional modules this business uses (seeded from its type,
      // owner-editable in Settings). Missing (legacy docs) = everything on.
      modules: { type: [String], default: undefined },
      // The "loyalty" capability's two constants (water, for now). Missing
      // (legacy docs, or a business that never touched this screen) falls
      // back to these exact defaults wherever loyalty math is computed.
      loyalty: {
        sachetBagsPerToken: { type: Number, default: 2, min: 1 },
        tokensPerFreePack: { type: Number, default: 5, min: 1 },
      },
      // The "loyaltyCard" module's qualification rule + reward — separate
      // from `loyalty` above (water's free-pack mechanic). windowDays 0 =
      // lifetime totals, never reset.
      loyaltyRule: {
        mode: { type: String, enum: ["off", "visits", "spend"], default: "off" },
        threshold: { type: Number, default: 5, min: 1 },
        windowDays: { type: Number, default: 0, min: 0 },
        discountType: { type: String, enum: ["percent", "flat"], default: "percent" },
        discountValue: { type: Number, default: 5, min: 0 },
      },
      // Opt-in: off by default since it spends an AI request and adds
      // content to an email that might otherwise not exist at all — see
      // alerts.service.js's sendDigest, which only ever piggybacks this onto
      // an email already going out, never sends a second one just for it.
      ai: {
        digestEnabled: { type: Boolean, default: false },
      },
      // Gym memberships only (capability: "memberships") — how far ahead of
      // expiry to remind, and whether that reminder also SMS's the member
      // directly (opt-in/off by default — a direct member-facing text is a
      // bigger step than the owner-facing bell/digest every other alert uses).
      gym: {
        renewalReminderDays: { type: Number, default: 3, min: 0, max: 30 },
        smsReminders: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
);

/**
 * Who gets alert email for this business. Prefers the list, falls back to the
 * single address older documents carry, and de-duplicates — so a business
 * saved before the list existed keeps working without a migration.
 */
export function alertRecipients(business) {
  const list = business?.settings?.alertEmails?.length
    ? business.settings.alertEmails
    : [business?.settings?.alertEmail].filter(Boolean);
  return [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

// Unambiguous alphabet (no O/0/I/1 confusion) for codes read out loud to staff.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateBusinessCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

businessSchema.pre("validate", function (next) {
  if (!this.code) this.code = generateBusinessCode();
  next();
});

businessSchema.index({ "site.slug": 1 }, { unique: true, partialFilterExpression: { "site.slug": { $type: "string" } } });

export const Business = mongoose.model("Business", businessSchema);
