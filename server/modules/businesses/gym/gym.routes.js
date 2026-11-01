import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { GymPlan } from "#modules/businesses/gym/gymPlan.model.js";
import { GymSubscription } from "#modules/businesses/gym/gymSubscription.model.js";
import { GymCheckIn } from "#modules/businesses/gym/gymCheckIn.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { LoyaltyCard } from "#modules/loyalty/loyaltyCard.model.js";
import { issueCardForCustomer } from "#modules/loyalty/loyaltyCard.service.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { withTransaction } from "#core/tx.js";
import { nextSeq } from "#core/counters.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { badRequest, notFound } from "#core/httpError.js";

export const gymRouter = Router();

// ── Plans ────────────────────────────────────────────────────────────

function shapePlan(p) {
  return { id: p._id, name: p.name, description: p.description, price: p.price, durationDays: p.durationDays, active: p.active };
}

// GET /api/gym/plans — everyone who sells needs to see what's on offer.
gymRouter.get("/plans", requirePerm("sales"), async (req, res) => {
  const plans = await GymPlan.find({ businessId: req.ctx.businessId, active: true }).sort({ price: 1 });
  res.json({ plans: plans.map(shapePlan) });
});

const planSchema = z.object({
  name: z.string().min(2, "Name the plan"),
  description: z.string().default(""),
  price: z.number().min(0),
  durationDays: z.number().int().min(1),
});

// POST /api/gym/plans — defining what's for sale is a business decision.
gymRouter.post("/plans", requirePerm("settings"), async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const plan = await GymPlan.create({ accountId: req.ctx.accountId, businessId: req.ctx.businessId, ...parsed.data });
  audit(req.ctx, "gym.plan.create", { type: "gymPlan", id: plan._id, label: plan.name });
  res.status(201).json({ plan: shapePlan(plan) });
});

gymRouter.patch("/plans/:id", requirePerm("settings"), async (req, res) => {
  const parsed = planSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const plan = await GymPlan.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!plan) return res.status(404).json({ error: "not_found", message: "Plan not found." });
  Object.assign(plan, parsed.data);
  await plan.save();
  res.json({ plan: shapePlan(plan) });
});

// ── Subscriptions ────────────────────────────────────────────────────

function shapeSubscription(s) {
  return {
    id: s._id, customerId: s.customerId, customerName: s.customerName,
    planId: s.planId, planName: s.planName, startDate: s.startDate, expiresAt: s.expiresAt,
    status: s.expiresAt < new Date() && s.status === "active" ? "expired" : s.status,
    purchasedAt: s.purchasedAt, renewalHistory: s.renewalHistory,
  };
}

const purchaseSchema = z.object({
  customerId: z.string().optional(),
  customer: z.object({ name: z.string().min(1), phone: z.string().default("") }).optional(),
  planId: z.string(),
  payments: z.array(z.object({ method: z.enum(["cash", "pos", "transfer"]), amount: z.number().min(0) })).min(1),
});

/**
 * POST /api/gym/subscriptions — a purchase or a renewal, whichever applies.
 * Converts to a real Sale exactly like Job collection (jobs.routes.js
 * POST /:id/collect) and hotel check-out do — a non-stock line item, the
 * same deposit-then-balance-free full-payment-up-front shape (a membership
 * has no deposit concept, payment is simply due in full).
 */
gymRouter.post("/subscriptions", requirePerm("sales"), requireBranch, async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const out = await withTransaction(async (session) => {
    const plan = await GymPlan.findOne({ _id: d.planId, businessId: req.ctx.businessId, active: true }).session(session);
    if (!plan) throw notFound("That plan isn't available.");

    let customer = null;
    if (d.customerId) {
      customer = await Customer.findOne({ _id: d.customerId, businessId: req.ctx.businessId }).session(session);
      if (!customer) throw badRequest("That customer doesn't exist.");
    } else if (d.customer?.name) {
      customer =
        (d.customer.phone &&
          (await Customer.findOne({ businessId: req.ctx.businessId, phone: d.customer.phone }).session(session))) ||
        (await Customer.create(
          [{ accountId: req.ctx.accountId, businessId: req.ctx.businessId, name: d.customer.name, phone: d.customer.phone, whatsapp: d.customer.phone }],
          { session }
        ))[0];
    } else {
      throw badRequest("A membership needs a customer.");
    }

    const paid = money(d.payments.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(paid - plan.price) > 0.01) {
      throw badRequest(`Payments (${paid}) don't match the plan price (${plan.price}).`, "payment_mismatch");
    }

    // Renewing extends from whichever is later — the current expiry (still
    // active) or today (lapsed) — never from today when time is left on
    // the clock already.
    let subscription = await GymSubscription.findOne({ businessId: req.ctx.businessId, customerId: customer._id }).session(session);
    const base = subscription && subscription.expiresAt > new Date() ? subscription.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + plan.durationDays * 24 * 3600 * 1000);

    const seq = await nextSeq(`sale:${req.ctx.branchId}`, session);
    const [sale] = await Sale.create(
      [{
        accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
        saleNo: `R-${String(seq).padStart(5, "0")}`,
        staffId: req.ctx.userId, staffName: req.ctx.actorName,
        customerId: customer._id, customerName: customer.name,
        items: [{
          productId: new mongoose.Types.ObjectId(), name: `${plan.name} membership`,
          qty: 1, unitPrice: plan.price, lineCost: 0, lineNet: plan.price, returnedQty: 0,
        }],
        subtotal: plan.price, discount: 0, vat: 0, total: plan.price,
        payments: d.payments.map((p) => ({ method: p.method, amount: money(p.amount) })),
      }],
      { session }
    );

    if (subscription) {
      subscription.planId = plan._id;
      subscription.planName = plan.name;
      subscription.expiresAt = expiresAt;
      subscription.status = "active";
      subscription.saleId = sale._id;
      subscription.renewalHistory.push({ at: new Date(), planId: plan._id, planName: plan.name, saleId: sale._id, expiresAtAfter: expiresAt });
      await subscription.save({ session });
    } else {
      [subscription] = await GymSubscription.create(
        [{
          accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
          customerId: customer._id, customerName: customer.name,
          planId: plan._id, planName: plan.name,
          startDate: new Date(), expiresAt, status: "active", saleId: sale._id,
        }],
        { session }
      );
    }

    customer.totalSpend = money(customer.totalSpend + plan.price);
    customer.visits += 1;
    customer.lastSeen = new Date();
    customer.lastBranchId = req.ctx.branchId;
    await customer.save({ session });

    // Access control IS the product here — issue the check-in card on
    // signup immediately, bypassing the loyalty module's own patronage
    // rule (that's a reward for repeat custom; this is what a member is
    // buying). Reuses the exact same LoyaltyCard model/QR flow, not a
    // second card system.
    let card = await LoyaltyCard.findOne({ businessId: req.ctx.businessId, customerId: customer._id, status: "active" }).session(session);
    if (!card) card = await issueCardForCustomer(req.ctx, customer._id, "gym_signup", session);

    const split = {};
    for (const p of d.payments) split[p.method] = (split[p.method] || 0) + p.amount;
    await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(), { revenue: plan.price, profit: plan.price, txns: 1, payments: split }, session);

    return { subscription, sale, card };
  });

  audit(req.ctx, "gym.subscription.purchase", { type: "gymSubscription", id: out.subscription._id, label: out.subscription.customerName }, undefined, {
    planName: out.subscription.planName, saleNo: out.sale.saleNo,
  });
  res.status(201).json({ subscription: shapeSubscription(out.subscription), saleNo: out.sale.saleNo, cardCode: out.card?.code });
});

// GET /api/gym/subscriptions?status=active — the roster.
gymRouter.get("/subscriptions", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const filter = { businessId: req.ctx.businessId };
  if (req.query.status === "active") filter.status = "active";
  const subs = await GymSubscription.find(filter).sort({ expiresAt: 1 }).limit(200);
  res.json({ subscriptions: subs.map(shapeSubscription) });
});

// GET /api/gym/subscriptions/:customerId
gymRouter.get("/subscriptions/:customerId", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const sub = await GymSubscription.findOne({ businessId: req.ctx.businessId, customerId: req.params.customerId });
  if (!sub) return res.json({ subscription: null });
  res.json({ subscription: shapeSubscription(sub) });
});

// ── Check-in ─────────────────────────────────────────────────────────

const checkInSchema = z.object({ code: z.string().min(10) });

/**
 * POST /api/gym/check-in — resolves a scanned loyalty card to the member's
 * subscription and logs the attempt either way (a rejected check-in is
 * still worth a record — it's what "someone tried to get in on an expired
 * card" looks like later).
 */
gymRouter.post("/check-in", requirePerm("sales"), requireBranch, async (req, res) => {
  const parsed = checkInSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "That doesn't look like a member code." });

  const card = await LoyaltyCard.findOne({ businessId: req.ctx.businessId, code: parsed.data.code, status: "active" });
  if (!card) throw notFound("That card isn't recognised here.", "not_found");

  const customer = await Customer.findById(card.customerId);
  if (!customer) throw notFound("The member for this card no longer exists.", "not_found");

  const subscription = await GymSubscription.findOne({ businessId: req.ctx.businessId, customerId: card.customerId });
  const active = !!subscription && subscription.status === "active" && subscription.expiresAt > new Date();
  const reason = !subscription ? "no_membership" : !active ? "expired" : "";

  card.lastScannedAt = new Date();
  card.scanCount += 1;
  await card.save();

  const checkIn = await GymCheckIn.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
    customerId: customer._id, customerName: customer.name, subscriptionId: subscription?._id || null,
    allowed: active, reason, byStaffId: req.ctx.userId, byStaffName: req.ctx.actorName,
  });

  res.json({
    allowed: active,
    memberName: customer.name,
    planName: subscription?.planName || null,
    expiresAt: subscription?.expiresAt || null,
    reason: reason || undefined,
    checkInId: checkIn._id,
  });
});

// GET /api/gym/check-ins?date=YYYY-MM-DD — front desk's activity log.
gymRouter.get("/check-ins", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : localDay();
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const checkIns = await GymCheckIn.find({ businessId: req.ctx.businessId, at: { $gte: start, $lt: end } }).sort({ at: -1 }).limit(200);
  res.json({
    checkIns: checkIns.map((c) => ({
      id: c._id, customerName: c.customerName, allowed: c.allowed, reason: c.reason, at: c.at, byStaffName: c.byStaffName,
    })),
  });
});
