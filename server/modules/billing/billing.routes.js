import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Account } from "#modules/auth/account.model.js";
import { Membership } from "#modules/auth/membership.model.js";
import { User } from "#modules/auth/user.model.js";
import { Business } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Product } from "#modules/products/product.model.js";
import { config } from "#core/config.js";
import { publicBase } from "#core/share.js";
import { emailPaymentReceipt } from "#modules/billing/billingNotices.js";
import { rateLimit } from "#core/rateLimit.js";
import { PAYMENTS_ENABLED, isLegacyAccount, planStatus, PLANS, planRank, TRIAL_DAYS, bonusPlanFor } from "#shared/plans.js";

/**
 * Subscriptions. Payment goes through Paystack (cards, bank transfer, USSD).
 * The browser never decides anything: the server creates the charge for a price
 * it owns, then — on the customer's return and again from Paystack's signed
 * webhook — asks Paystack what actually happened and applies the plan only if
 * the amount, currency and account all match. Each reference applies once.
 *
 * Payments are one-off per month (no automatic re-charge): the plan runs 30
 * days from payment, then the account is back on Freemium until it pays again.
 */
export const billingRouter = Router();

const PERIOD_DAYS = 30;
const DAY = 86_400_000;
const paystackReady = () => !!config.paystack.secretKey;

async function ownerOf(req) {
  return Membership.findOne({ userId: req.auth.userId, accountId: req.auth.accountId, role: "owner", status: "active" });
}

async function paystack(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://api.paystack.co${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.paystack.secretKey}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return res.ok && json?.status ? json.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies a verified Paystack transaction to its account. Returns what happened
 * so the caller can answer honestly. Safe to call repeatedly for the same payment.
 */
export async function applyTransaction(tx) {
  if (!tx || tx.status !== "success") return { ok: false, reason: "not_paid" };
  const plan = tx.metadata?.plan;
  const accountId = tx.metadata?.accountId;
  if (!PLANS[plan] || !accountId) return { ok: false, reason: "unknown_payment" };
  if (tx.currency && tx.currency !== "NGN") return { ok: false, reason: "wrong_currency" };
  if (Number(tx.amount) !== PLANS[plan].price * 100) return { ok: false, reason: "wrong_amount" };

  const account = await Account.findById(accountId);
  if (!account) return { ok: false, reason: "unknown_account" };
  if ((account.subscription?.payments || []).some((p) => p.reference === tx.reference)) return { ok: true, plan, already: true, account };

  const now = new Date();
  const current = account.subscription;
  // Paying again for the plan you're already on stacks onto what's left of it.
  // (A trial doesn't stack: the first payment starts the paid month from today.)
  const stillRunning = current?.plan === plan && !current.trial && current.currentPeriodEnd && new Date(current.currentPeriodEnd) > now;
  const start = stillRunning ? new Date(current.currentPeriodEnd) : now;
  const end = new Date(start.getTime() + PERIOD_DAYS * DAY);

  // The reference is claimed in the same write that grants the plan, so two
  // simultaneous callers (return page + webhook) can't both extend it.
  // Someone who signed up for Freemium and pays for it for the first time gets Pro free for
  // TRIAL_DAYS, inside this paid month. Once only: renewing never repeats it.
  const bonusPlan = plan === "free" && current?.registeredPlan === "free" && !current?.bonusUsed ? bonusPlanFor("free") : null;
  const bonusUntil = bonusPlan ? new Date(Math.min(now.getTime() + TRIAL_DAYS * DAY, end.getTime())) : null;

  const claimed = await Account.updateOne(
    { _id: account._id, "subscription.payments.reference": { $ne: tx.reference } },
    {
      $set: {
        plan, "subscription.plan": plan, "subscription.trial": false, "subscription.currentPeriodEnd": end,
        ...(bonusPlan ? { "subscription.bonus": { plan: bonusPlan, until: bonusUntil }, "subscription.bonusUsed": true } : {}),
      },
      $push: { "subscription.payments": { reference: tx.reference, plan, amount: PLANS[plan].price, at: now } },
    }
  );
  if (!claimed.modifiedCount) return { ok: true, plan, already: true, account };
  const fresh = await Account.findById(account._id);
  emailPaymentReceipt(fresh, { plan, amount: PLANS[plan].price, periodEnd: end, bonusUntil });
  return { ok: true, plan, periodEnd: end, account: fresh };
}

// GET /api/billing — what plan you're on, what it allows, how much of it you use
billingRouter.get("/", async (req, res) => {
  const account = await Account.findById(req.auth.accountId);
  if (!account) return res.status(404).json({ error: "not_found" });
  const status = planStatus(account);
  const plan = status.plan;
  const businesses = await Business.find({ accountId: account._id }).select("name").sort({ createdAt: 1 });
  const ids = businesses.map((b) => b._id);
  const [products, staff, branches, customers] = await Promise.all([
    Product.aggregate([{ $match: { businessId: { $in: ids }, status: "active" } }, { $group: { _id: "$businessId", n: { $sum: 1 } } }]),
    Membership.aggregate([{ $match: { businessId: { $in: ids }, status: "active", role: { $ne: "owner" } } }, { $group: { _id: "$businessId", n: { $sum: 1 } } }]),
    Branch.aggregate([{ $match: { businessId: { $in: ids } } }, { $group: { _id: "$businessId", n: { $sum: 1 } } }]),
    Customer.aggregate([{ $match: { businessId: { $in: ids } } }, { $group: { _id: "$businessId", n: { $sum: 1 } } }]),
  ]);
  const by = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));
  const [pm, sm, bm, cm] = [by(products), by(staff), by(branches), by(customers)];
  res.json({
    plan,
    planName: PLANS[plan].name,
    legacy: status.legacy,
    trial: status.trial,
    lapsed: status.lapsed,
    periodEnd: status.periodEnd,
    canManage: !!(await ownerOf(req)),
    paymentsEnabled: paystackReady() && PAYMENTS_ENABLED,
    paymentsOn: PAYMENTS_ENABLED,
    trialEnded: !!status.trialEnded,
    awaitingPayment: !!status.awaitingPayment,
    paidUntil: status.paidUntil || null,
    paidPlan: status.paidPlan || null,
    limits: PLANS[plan].limits,
    usage: {
      businesses: businesses.length,
      perBusiness: businesses.map((b) => ({ id: b._id, name: b.name, products: pm.get(String(b._id)) || 0, staff: sm.get(String(b._id)) || 0, branches: bm.get(String(b._id)) || 0, customers: cm.get(String(b._id)) || 0 })),
    },
    payments: (account.subscription?.payments || []).slice(-10).reverse(),
  });
});

const checkoutSchema = z.object({ plan: z.enum(["free", "pro", "business"]), returnUrl: z.string().url().max(300).optional() });

// POST /api/billing/checkout — start paying for a plan; returns where to send the browser
billingRouter.post("/checkout", async (req, res) => {
  if (!PAYMENTS_ENABLED) return res.status(400).json({ error: "payments_off", message: "Plans are free right now and payments are switched off, so there's nothing to buy." });
  if (!(await ownerOf(req))) return res.status(403).json({ error: "forbidden", message: "Only the account owner can change the plan." });
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "Choose a plan." });
  if (!paystackReady()) {
    return res.status(400).json({ error: "payments_off", message: "Online payment isn't set up on this server yet. Contact support to upgrade." });
  }
  if (!rateLimit(`checkout:${req.auth.userId}`, { max: 10, windowMs: 60 * 60 * 1000 })) {
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Try again in a while." });
  }
  const account = await Account.findById(req.auth.accountId);
  if (isLegacyAccount(account)) {
    return res.status(400).json({ error: "invalid", message: "Your account already has full access. There's nothing to buy." });
  }
  const standing = planStatus(account);
  if (!standing.lapsed && !standing.trial && planRank(standing.plan) > planRank(parsed.data.plan)) {
    // Paying for a lower plan while on a higher one would shorten what they have.
    return res.status(400).json({ error: "invalid", message: "You're already on a higher plan." });
  }
  const user = await User.findById(req.auth.userId).select("email");
  if (!user?.email) return res.status(400).json({ error: "invalid", message: "Add an email address to your profile first." });

  // Where Paystack sends them back: this app, never a caller-chosen site.
  const base = publicBase(req);
  const reference = `st_${account._id}_${crypto.randomBytes(6).toString("hex")}`;
  const data = await paystack("POST", "/transaction/initialize", {
    email: user.email,
    amount: PLANS[parsed.data.plan].price * 100,
    currency: "NGN",
    reference,
    callback_url: `${base}/app/billing`,
    metadata: { accountId: String(account._id), plan: parsed.data.plan, userId: String(req.auth.userId) },
  });
  if (!data?.authorization_url) return res.status(502).json({ error: "payment_failed", message: "Couldn't reach the payment provider. Please try again." });
  res.json({ url: data.authorization_url, reference });
});

// GET /api/billing/verify?reference=… — the customer is back; confirm with Paystack and apply
billingRouter.get("/verify", async (req, res) => {
  const reference = String(req.query.reference || "");
  if (!/^[\w-]{6,80}$/.test(reference)) return res.status(400).json({ error: "invalid", message: "That payment reference isn't valid." });
  if (!paystackReady()) return res.status(400).json({ error: "payments_off", message: "Online payment isn't set up on this server." });
  const tx = await paystack("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  if (!tx) return res.status(502).json({ error: "payment_failed", message: "Couldn't confirm the payment yet. Try again in a moment." });
  // A payment made by someone else's account can't be claimed here.
  if (String(tx.metadata?.accountId) !== String(req.auth.accountId)) return res.status(403).json({ error: "forbidden", message: "That payment belongs to a different account." });
  const out = await applyTransaction(tx);
  if (!out.ok) {
    const message = out.reason === "not_paid" ? "That payment hasn't been completed." : "That payment couldn't be matched to a plan. Contact support with your reference.";
    return res.status(out.reason === "not_paid" ? 402 : 422).json({ error: out.reason, message });
  }
  res.json({ ok: true, plan: out.plan, already: !!out.already, periodEnd: out.account?.subscription?.currentPeriodEnd || null });
});

/**
 * POST /api/billing/webhook — Paystack tells us a charge succeeded, whether or
 * not the customer ever came back to the app. Mounted with the RAW body (the
 * signature is over the exact bytes) and checked before anything is read.
 */
export async function billingWebhook(req, res) {
  const secret = config.paystack.secretKey;
  const raw = req.body;
  if (!secret || !Buffer.isBuffer(raw)) return res.sendStatus(400);
  const sig = String(req.headers["x-paystack-signature"] || "");
  const expected = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { return res.sendStatus(400); }
  if (event?.event === "charge.success" && event.data?.reference) {
    // Ask Paystack rather than trust the body, even though it's signed.
    const tx = await paystack("GET", `/transaction/verify/${encodeURIComponent(event.data.reference)}`);
    if (tx) await applyTransaction(tx).catch((e) => console.error("billing webhook apply failed:", e.message));
  }
  res.sendStatus(200);
}

