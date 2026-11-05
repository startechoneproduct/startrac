import { Router } from "express";
import { User } from "#modules/auth/user.model.js";
import { Account } from "#modules/auth/account.model.js";
import { Membership } from "#modules/auth/membership.model.js";
import { Business } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Product } from "#modules/products/product.model.js";
import { Ticket } from "#modules/support/ticket.model.js";
import { requireAuth } from "#core/middleware/requireAuth.js";
import { AuditLog } from "#modules/audit/auditLog.model.js";
import { money } from "#core/money.js";
import { typeTemplate } from "#shared/businessTypes.js";
import { PAYMENTS_ENABLED, PLANS, effectivePlan, isPlan, isLegacyAccount, planStatus } from "#shared/plans.js";
import { escapeRegex } from "#core/regex.js";
import { logPlatform } from "#modules/platform/platformLog.model.js";

export const platformRouter = Router();

/**
 * The overseer's view sits OUTSIDE the tenant system.
 *
 * Every other route in this app is scoped to one business by tenantContext.
 * These deliberately are not — which is exactly why the gate is its own
 * middleware reading a field that no business-level role can grant. A shop
 * owner is the top of their own tree and can never reach another shop's data,
 * regardless of what permissions they hold inside their own.
 */
export async function requirePlatform(req, res, next) {
  const user = await User.findById(req.auth.userId).select("name email platformRole status");
  if (!user || user.status !== "active" || !["overseer", "support"].includes(user.platformRole)) {
    // Deliberately a 404, not a 403: an unauthorised caller should not learn
    // that this surface exists at all.
    return res.status(404).json({ error: "not_found" });
  }
  req.platformUser = user;
  next();
}

// Support can look; only an overseer can change anything.
function requireOverseer(req, res, next) {
  if (req.platformUser.platformRole !== "overseer") {
    return res.status(403).json({ error: "forbidden", message: "That needs full overseer access." });
  }
  next();
}

platformRouter.use(requireAuth, requirePlatform);

const DAY = 86_400_000;

// GET /api/platform/overview — the whole platform on one screen
platformRouter.get("/overview", async (req, res) => {
  const since30 = new Date(Date.now() - 30 * DAY);
  const since7 = new Date(Date.now() - 7 * DAY);

  const [accounts, sandboxes, businesses, users, branches, newAccounts, revenue, byType, byPlan] = await Promise.all([
    Account.countDocuments({ isSandbox: { $ne: true } }),
    Account.countDocuments({ isSandbox: true }),
    Business.countDocuments({}),
    User.countDocuments({ status: "active" }),
    Branch.countDocuments({}),
    Account.countDocuments({ isSandbox: { $ne: true }, createdAt: { $gte: since30 } }),
    Sale.aggregate([
      { $match: { status: "completed", at: { $gte: since30 } } },
      { $group: { _id: null, total: { $sum: "$total" }, txns: { $sum: 1 } } },
    ]),
    Business.aggregate([{ $group: { _id: "$typeKey", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Account.aggregate([{ $match: { isSandbox: { $ne: true } } }, { $group: { _id: "$plan", n: { $sum: 1 } } }]),
  ]);

  // Which businesses actually traded this week — the number that matters more
  // than sign-ups, because a shop that stopped selling has churned quietly.
  const activeIds = await Sale.distinct("businessId", { at: { $gte: since7 } });

  res.json({
    paymentsOn: PAYMENTS_ENABLED,
    viewer: { name: req.platformUser.name, platformRole: req.platformUser.platformRole },
    totals: {
      accounts, sandboxes, businesses, users, branches,
      newAccounts30d: newAccounts,
      activeBusinesses7d: activeIds.length,
      revenue30d: money(revenue[0]?.total || 0),
      txns30d: revenue[0]?.txns || 0,
    },
    byType: byType.map((t) => ({ typeKey: t._id, label: typeTemplate(t._id).label, count: t.n })),
    byPlan: Object.fromEntries(byPlan.map((p) => [p._id || "free", p.n])),
  });
});

// GET /api/platform/accounts?q=&page=&includeSandbox=
platformRouter.get("/accounts", async (req, res) => {
  const filter = req.query.includeSandbox === "1" ? {} : { isSandbox: { $ne: true } };
  if (req.query.q) {
    filter.name = { $regex: escapeRegex(req.query.q), $options: "i" };
  }
  if (req.query.status === "suspended") filter.status = "suspended";

  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const [accounts, count] = await Promise.all([
    Account.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Account.countDocuments(filter),
  ]);
  const ids = accounts.map((a) => a._id);

  const [businesses, owners, sales] = await Promise.all([
    Business.find({ accountId: { $in: ids } }).select("accountId name typeKey").lean(),
    User.find({ _id: { $in: accounts.map((a) => a.ownerUserId) } }).select("name email").lean(),
    Sale.aggregate([
      { $match: { accountId: { $in: ids }, status: "completed" } },
      { $group: { _id: "$accountId", total: { $sum: "$total" }, txns: { $sum: 1 }, last: { $max: "$at" } } },
    ]),
  ]);

  const bizByAccount = new Map();
  for (const b of businesses) {
    if (!bizByAccount.has(String(b.accountId))) bizByAccount.set(String(b.accountId), []);
    bizByAccount.get(String(b.accountId)).push({ id: b._id, name: b.name, typeKey: b.typeKey, typeLabel: typeTemplate(b.typeKey).label });
  }
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));
  const salesByAccount = new Map(sales.map((s) => [String(s._id), s]));

  res.json({
    accounts: accounts.map((a) => {
      const owner = ownerById.get(String(a.ownerUserId));
      const s = salesByAccount.get(String(a._id));
      return {
        id: a._id,
        name: a.name,
        plan: effectivePlan(a),
        legacy: isLegacyAccount(a),
        status: a.status,
        isSandbox: !!a.isSandbox,
        createdAt: a.createdAt,
        owner: owner ? { name: owner.name, email: owner.email } : null,
        businesses: bizByAccount.get(String(a._id)) || [],
        revenue: money(s?.total || 0),
        txns: s?.txns || 0,
        lastSaleAt: s?.last || null,
      };
    }),
    page,
    pages: Math.max(1, Math.ceil(count / limit)),
    total: count,
  });
});

// GET /api/platform/accounts/:id — one tenant in detail (read-only)
platformRouter.get("/accounts/:id", async (req, res) => {
  const account = await Account.findById(req.params.id).lean();
  if (!account) return res.status(404).json({ error: "not_found", message: "Account not found." });

  const [businesses, memberships, products, sales] = await Promise.all([
    Business.find({ accountId: account._id }).lean(),
    Membership.find({ accountId: account._id }).lean(),
    Product.countDocuments({ accountId: account._id, status: "active" }),
    Sale.aggregate([
      { $match: { accountId: account._id, status: "completed" } },
      { $group: { _id: null, total: { $sum: "$total" }, txns: { $sum: 1 }, last: { $max: "$at" } } },
    ]),
  ]);
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
    .select("name email status createdAt").lean();
  const roleByUser = new Map(memberships.map((m) => [String(m.userId), m.role]));

  res.json({
    account: {
      id: account._id, name: account.name, plan: effectivePlan(account), legacy: isLegacyAccount(account), status: account.status,
      periodEnd: account.subscription?.currentPeriodEnd || null,
      isSandbox: !!account.isSandbox, createdAt: account.createdAt,
    },
    businesses: businesses.map((b) => ({
      id: b._id, name: b.name, typeKey: b.typeKey, typeLabel: typeTemplate(b.typeKey).label,
      capabilities: typeTemplate(b.typeKey).capabilities || [],
      currency: b.settings?.currency,
    })),
    // Never the password or PIN hash — the overseer has no business with those.
    people: users.map((u) => ({
      id: u._id, name: u.name, email: u.email, status: u.status,
      role: roleByUser.get(String(u._id)) || "—", joinedAt: u.createdAt,
    })),
    usage: { products, revenue: money(sales[0]?.total || 0), txns: sales[0]?.txns || 0, lastSaleAt: sales[0]?.last || null },
  });
});

// POST /api/platform/accounts/:id/plan — set an account's plan by hand (comp, refund, support fix).
// plan "legacy" returns it to the full access accounts had before plans existed.
platformRouter.post("/accounts/:id/plan", requireOverseer, async (req, res) => {
  const plan = req.body?.plan;
  const days = Math.min(3650, Math.max(1, Math.round(Number(req.body?.days) || 30)));
  if (plan !== "legacy" && !isPlan(plan)) return res.status(400).json({ error: "invalid", message: "Plan must be free, pro, business or legacy." });
  const account = await Account.findById(req.params.id);
  if (!account) return res.status(404).json({ error: "not_found", message: "Account not found." });
  if (account.isSandbox) return res.status(400).json({ error: "invalid", message: "Demo sandboxes always show everything." });

  const before = effectivePlan(account);
  if (plan === "legacy") {
    account.subscription = undefined;
    account.plan = "business";
  } else {
    account.plan = plan;
    account.subscription = {
      plan,
      trial: false,
      // Keeps this from being read as an account that predates the trial rules.
      registeredPlan: account.subscription?.registeredPlan || (isPlan(account.plan) ? account.plan : plan),
      currentPeriodEnd: new Date(Date.now() + days * DAY),
      payments: account.subscription?.payments || [],
      bonus: account.subscription?.bonus,
      bonusUsed: !!account.subscription?.bonusUsed,
    };
  }
  await account.save();
  await AuditLog.create({
    accountId: account._id, businessId: account._id, actorId: req.platformUser._id, actorName: `${req.platformUser.name} (StarTrack)`,
    action: "platform.plan", target: { type: "account", id: account._id, label: account.name },
    before: { plan: before }, after: { plan: effectivePlan(account), days: plan === "legacy" ? undefined : days },
  });
  logPlatform(req, "platform.plan", { type: "account", id: account._id, label: account.name }, { plan: before }, { plan: effectivePlan(account), days: plan === "legacy" ? undefined : days });
  res.json({ ok: true, plan: effectivePlan(account), legacy: isLegacyAccount(account), lapsed: planStatus(account).lapsed, periodEnd: account.subscription?.currentPeriodEnd || null });
});

// POST /api/platform/accounts/:id/status — suspend or restore a tenant
platformRouter.post("/accounts/:id/status", requireOverseer, async (req, res) => {
  const status = req.body?.status;
  if (!["active", "suspended"].includes(status)) {
    return res.status(400).json({ error: "invalid", message: "Status must be active or suspended." });
  }
  const account = await Account.findById(req.params.id);
  if (!account) return res.status(404).json({ error: "not_found", message: "Account not found." });
  if (account.isSandbox) return res.status(400).json({ error: "invalid", message: "Demo sandboxes expire on their own." });

  const before = account.status;
  account.status = status;
  await account.save();

  // Platform actions are logged against the tenant they affected, so the
  // account's own audit trail shows that StarTrack touched it.
  await AuditLog.create({
    accountId: account._id,
    businessId: account._id, // no single business — the action is account-wide
    actorId: req.platformUser._id,
    actorName: `${req.platformUser.name} (StarTrack)`,
    action: "platform.account_status",
    target: { type: "account", id: account._id, label: account.name },
    before: { status: before },
    after: { status, reason: String(req.body?.reason || "") },
  });
  logPlatform(req, "platform.account_status", { type: "account", id: account._id, label: account.name }, { status: before }, { status, reason: String(req.body?.reason || "") });

  res.json({ account: { id: account._id, name: account.name, status: account.status } });
});

// GET /api/platform/growth?days=30 — daily sign-ups and trading volume, zero-filled
// so the chart has a point for every day even when nothing happened.
platformRouter.get("/growth", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() - (days - 1) * DAY);

  const day = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field } });
  const [signups, sales] = await Promise.all([
    Account.aggregate([
      { $match: { isSandbox: { $ne: true }, createdAt: { $gte: start } } },
      { $group: { _id: day("$createdAt"), n: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { status: "completed", at: { $gte: start } } },
      { $group: { _id: day("$at"), total: { $sum: "$total" }, txns: { $sum: 1 } } },
    ]),
  ]);
  const signupBy = new Map(signups.map((s) => [s._id, s.n]));
  const salesBy = new Map(sales.map((s) => [s._id, s]));

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    series.push({ date: key, signups: signupBy.get(key) || 0, volume: money(salesBy.get(key)?.total || 0), txns: salesBy.get(key)?.txns || 0 });
  }
  res.json({ days, series });
});

// GET /api/platform/leaders?days=30 — which businesses and trades sold the most
// in the range. Demo sandboxes are left out so real customers show.
platformRouter.get("/leaders", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
  const since = new Date(Date.now() - days * DAY);
  const sandboxIds = await Account.distinct("_id", { isSandbox: true });
  const top = await Sale.aggregate([
    { $match: { status: "completed", at: { $gte: since }, accountId: { $nin: sandboxIds } } },
    { $group: { _id: "$businessId", accountId: { $first: "$accountId" }, total: { $sum: "$total" }, txns: { $sum: 1 }, last: { $max: "$at" } } },
    { $sort: { total: -1 } },
  ]);
  const businesses = await Business.find({ _id: { $in: top.map((t) => t._id) } }).select("name typeKey").lean();
  const bizById = new Map(businesses.map((b) => [String(b._id), b]));

  const byTrade = new Map();
  for (const t of top) {
    const key = bizById.get(String(t._id))?.typeKey || "other";
    const row = byTrade.get(key) || { typeKey: key, label: typeTemplate(key).label, total: 0, txns: 0, businesses: 0 };
    row.total += t.total; row.txns += t.txns; row.businesses++;
    byTrade.set(key, row);
  }

  res.json({
    days,
    businesses: top.slice(0, 8).map((t) => {
      const b = bizById.get(String(t._id));
      return { id: t._id, accountId: t.accountId, name: b?.name || "—", typeLabel: typeTemplate(b?.typeKey).label, total: money(t.total), txns: t.txns, lastSaleAt: t.last };
    }),
    trades: [...byTrade.values()].sort((a, b) => b.total - a.total).map((r) => ({ ...r, total: money(r.total) })),
  });
});

// GET /api/platform/businesses?q=&typeKey=&inactive=1&page= — every individual
// business (a tenant account can own several), with how recently it traded.
platformRouter.get("/businesses", async (req, res) => {
  const filter = {};
  if (req.query.q) {
    filter.name = { $regex: escapeRegex(req.query.q), $options: "i" };
  }
  if (req.query.typeKey) filter.typeKey = String(req.query.typeKey);

  // Demo sandboxes would drown out real customers, so they are always left out.
  const sandboxIds = await Account.distinct("_id", { isSandbox: true });
  if (sandboxIds.length) filter.accountId = { $nin: sandboxIds };

  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const since30 = new Date(Date.now() - 30 * DAY);

  const [rows, total] = await Promise.all([
    Business.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Business.countDocuments(filter),
  ]);
  const ids = rows.map((b) => b._id);
  const [accounts, sales, people] = await Promise.all([
    Account.find({ _id: { $in: rows.map((b) => b.accountId) } }).lean(),
    Sale.aggregate([
      { $match: { businessId: { $in: ids }, status: "completed" } },
      {
        $group: {
          _id: "$businessId",
          last: { $max: "$at" },
          txns: { $sum: 1 },
          revenue30d: { $sum: { $cond: [{ $gte: ["$at", since30] }, "$total", 0] } },
        },
      },
    ]),
    Membership.aggregate([
      { $match: { businessId: { $in: ids }, status: "active" } },
      { $group: { _id: "$businessId", n: { $sum: 1 } } },
    ]),
  ]);
  const accountById = new Map(accounts.map((a) => [String(a._id), a]));
  const salesById = new Map(sales.map((s) => [String(s._id), s]));
  const peopleById = new Map(people.map((p) => [String(p._id), p.n]));

  res.json({
    businesses: rows.map((b) => {
      const a = accountById.get(String(b.accountId));
      const s = salesById.get(String(b._id));
      return {
        id: b._id,
        accountId: b.accountId,
        name: b.name,
        typeKey: b.typeKey,
        typeLabel: typeTemplate(b.typeKey).label,
        accountName: a?.name || "—",
        plan: a ? effectivePlan(a) : "free",
        accountStatus: a?.status || "active",
        people: peopleById.get(String(b._id)) || 0,
        txns: s?.txns || 0,
        revenue30d: money(s?.revenue30d || 0),
        lastSaleAt: s?.last || null,
        createdAt: b.createdAt,
      };
    }),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

// GET /api/platform/subscriptions — who is paying, who is on trial, who is about to lapse.
platformRouter.get("/subscriptions", async (_req, res) => {
  const now = new Date();
  const accounts = await Account.find({ isSandbox: { $ne: true } })
    .select("name plan subscription status ownerUserId createdAt").lean();
  const owners = await User.find({ _id: { $in: accounts.map((a) => a.ownerUserId) } }).select("name email").lean();
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));

  const counts = { paid: 0, trialing: 0, lapsed: 0, free: 0, legacy: 0 };
  let mrr = 0;
  const expiring = [];
  const lapsed = [];
  const payments = [];
  const since30 = new Date(Date.now() - 30 * DAY);
  let collected30d = 0;
  let collectedAll = 0;

  for (const a of accounts) {
    const st = planStatus(a, now);
    const owner = ownerById.get(String(a.ownerUserId));
    const row = {
      id: a._id, name: a.name, plan: st.plan, trial: st.trial,
      periodEnd: st.periodEnd, owner: owner ? { name: owner.name, email: owner.email } : null,
    };
    if (st.legacy) counts.legacy++;
    else if (st.lapsed) { counts.lapsed++; lapsed.push({ ...row, plan: a.subscription?.plan || "free" }); }
    else if (st.trial) counts.trialing++;
    else if (st.plan === "free") counts.free++;
    else {
      counts.paid++;
      mrr += PLANS[st.plan]?.price || 0;
    }
    if (!st.legacy && !st.lapsed && st.plan !== "free" && st.periodEnd) {
      const left = new Date(st.periodEnd).getTime() - now.getTime();
      if (left <= 14 * DAY) expiring.push({ ...row, daysLeft: Math.max(0, Math.ceil(left / DAY)) });
    }
    for (const p of a.subscription?.payments || []) {
      collectedAll += p.amount || 0;
      if (p.at && new Date(p.at) >= since30) collected30d += p.amount || 0;
      payments.push({ accountId: a._id, accountName: a.name, plan: p.plan, amount: p.amount, at: p.at, reference: p.reference });
    }
  }

  expiring.sort((x, y) => x.daysLeft - y.daysLeft);
  lapsed.sort((x, y) => new Date(y.periodEnd || 0) - new Date(x.periodEnd || 0));
  payments.sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));

  res.json({
    paymentsOn: PAYMENTS_ENABLED,
    counts,
    mrr: money(mrr),
    collected30d: money(collected30d),
    collectedAll: money(collectedAll),
    expiring: expiring.slice(0, 25),
    lapsed: lapsed.slice(0, 25),
    payments: payments.slice(0, 25),
  });
});

// GET /api/platform/tickets — business tickets escalated to StarTrack support.
// Read-only for now: escalation just hands a StarTrack person visibility;
// working the ticket still happens from inside that business's own queue.
platformRouter.get("/tickets", async (req, res) => {
  const filter = { scope: "platform" };
  if (req.query.status) filter.status = String(req.query.status);

  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [tickets, total] = await Promise.all([
    Ticket.find(filter).sort({ escalatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Ticket.countDocuments(filter),
  ]);
  const businesses = await Business.find({ _id: { $in: tickets.map((t) => t.businessId) } }).select("name").lean();
  const bizById = new Map(businesses.map((b) => [String(b._id), b.name]));

  res.json({
    tickets: tickets.map((t) => ({
      id: t._id, ticketNo: t.ticketNo, subject: t.subject, description: t.description,
      category: t.category, priority: t.priority, status: t.status,
      businessName: bizById.get(String(t.businessId)) || "—",
      raisedBy: t.raisedBy, comments: t.comments, escalatedAt: t.escalatedAt, createdAt: t.createdAt,
    })),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

// GET /api/platform/staff — who at StarTrack has platform access
platformRouter.get("/staff", requireOverseer, async (_req, res) => {
  const staff = await User.find({ platformRole: { $in: ["overseer", "support"] } })
    .select("name email platformRole status createdAt").lean();
  res.json({ staff: staff.map((s) => ({ id: s._id, name: s.name, email: s.email, platformRole: s.platformRole, status: s.status })) });
});

// POST /api/platform/staff — grant or revoke platform access
platformRouter.post("/staff", requireOverseer, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = req.body?.platformRole;
  if (!["none", "support", "overseer"].includes(role)) {
    return res.status(400).json({ error: "invalid", message: "Role must be none, support or overseer." });
  }
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "not_found", message: "No StarTrack user with that email." });
  if (String(user._id) === String(req.platformUser._id) && role !== "overseer") {
    return res.status(400).json({ error: "invalid", message: "You can't remove your own overseer access." });
  }

  const beforeRole = user.platformRole || "none";
  user.platformRole = role;
  await user.save();
  logPlatform(req, "platform.staff", { type: "user", id: user._id, label: `${user.name} (${user.email})` }, { platformRole: beforeRole }, { platformRole: role });
  res.json({ user: { id: user._id, name: user.name, email: user.email, platformRole: user.platformRole } });
});

// ── Platform insight, people, activity and exports ──────────────────────────

/** StarTrack's own money: what paying accounts bring in each month, and what came in. */
async function subscriptionMoney(now = new Date()) {
  const accounts = await Account.find({ isSandbox: { $ne: true } }).select("plan subscription status").lean();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const out = { mrr: 0, collected30d: 0, collectedAll: 0, paid: 0, trialing: 0, lapsed: 0, free: 0, legacy: 0, suspended: 0 };
  for (const a of accounts) {
    if (a.status === "suspended") out.suspended++;
    const st = planStatus(a, now);
    if (st.legacy) out.legacy++;
    else if (st.lapsed) out.lapsed++;
    else if (st.trial) out.trialing++;
    else if (st.plan === "free") out.free++;
    else { out.paid++; out.mrr += PLANS[st.plan]?.price || 0; }
    for (const p of a.subscription?.payments || []) {
      out.collectedAll += p.amount || 0;
      if (p.at && new Date(p.at) >= since30) out.collected30d += p.amount || 0;
    }
  }
  out.mrr = money(out.mrr);
  out.collected30d = money(out.collected30d);
  out.collectedAll = money(out.collectedAll);
  return out;
}

// GET /api/platform/insights — what the overview needs beyond /overview:
// StarTrack's income, how many businesses are really trading, who is signing
// in, what is happening today across every business, and what needs a person.
platformRouter.get("/insights", async (_req, res) => {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since14 = new Date(now.getTime() - 14 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const [{ Customer }, { Invoice }, { Return }] = await Promise.all([
    import("#modules/customers/customer.model.js"),
    import("#modules/invoices/invoice.model.js"),
    import("#modules/returns/return.model.js"),
  ]);

  const [subs, allBiz, active7, active30, usersActive, usersSuspended, signedIn7, signedIn30, platformStaff, owners, roleCounts,
    salesToday, products, customers, invoices, returns30, ticketsOpen, ticketsEscalated] = await Promise.all([
    subscriptionMoney(now),
    Business.find({}).select("_id createdAt").lean(),
    Sale.distinct("businessId", { at: { $gte: since7 } }),
    Sale.distinct("businessId", { at: { $gte: since30 } }),
    User.countDocuments({ status: "active" }),
    User.countDocuments({ status: "suspended" }),
    User.countDocuments({ lastLoginAt: { $gte: since7 } }),
    User.countDocuments({ lastLoginAt: { $gte: since30 } }),
    User.countDocuments({ platformRole: { $in: ["overseer", "support"] } }),
    Membership.distinct("userId", { role: "owner", status: "active" }),
    Membership.aggregate([{ $match: { status: "active", role: { $ne: "owner" } } }, { $group: { _id: "$role", n: { $sum: 1 } } }]),
    Sale.aggregate([
      { $match: { status: "completed", at: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$total" }, n: { $sum: 1 }, biz: { $addToSet: "$businessId" } } },
    ]),
    Product.countDocuments({ status: "active" }),
    Customer.countDocuments({}),
    Invoice.countDocuments({ status: { $ne: "draft" } }),
    Return.countDocuments({ createdAt: { $gte: since30 } }),
    Ticket.countDocuments({ status: { $in: ["open", "in_progress"] } }),
    Ticket.countDocuments({ scope: "platform", status: { $in: ["open", "in_progress"] } }),
  ]);

  // Quiet: old enough to have got going, but no sale in 30 days. These are the ones likely to leave.
  const traded30 = new Set(active30.map(String));
  const quiet = allBiz.filter((b) => new Date(b.createdAt) < since14 && !traded30.has(String(b._id))).length;
  const roles = Object.fromEntries(roleCounts.map((r) => [r._id, r.n]));
  const t = salesToday[0];
  const plural = (n, one, many) => (n === 1 ? one : many);

  const alerts = [];
  if (subs.lapsed) alerts.push({ kind: "lapsed", tone: "danger", label: `${subs.lapsed} ${plural(subs.lapsed, "account has", "accounts have")} lapsed`, hint: "Read-only until they renew", to: "subscriptions" });
  if (ticketsEscalated) alerts.push({ kind: "tickets", tone: "brand", label: `${ticketsEscalated} escalated ${plural(ticketsEscalated, "ticket", "tickets")} open`, hint: "Waiting on StarTrack", to: "support" });
  if (quiet) alerts.push({ kind: "quiet", tone: "warning", label: `${quiet} ${plural(quiet, "business hasn't", "businesses haven't")} sold in 30 days`, hint: "Worth a check-in call", to: "businesses" });
  if (subs.suspended) alerts.push({ kind: "suspended", tone: "neutral", label: `${subs.suspended} suspended ${plural(subs.suspended, "account", "accounts")}`, hint: "Blocked from signing in", to: "accounts" });
  if (usersSuspended) alerts.push({ kind: "users", tone: "neutral", label: `${usersSuspended} suspended ${plural(usersSuspended, "person", "people")}`, hint: "Can't sign in", to: "users" });

  res.json({
    money: subs,
    businesses: { total: allBiz.length, active7d: active7.length, active30d: active30.length, quiet },
    users: {
      active: usersActive, suspended: usersSuspended, signedIn7d: signedIn7, signedIn30d: signedIn30,
      owners: owners.length, admins: roles.admin || 0, managers: roles.manager || 0, staff: roles.staff || 0, platformStaff,
    },
    today: { sales: t?.n || 0, volume: money(t?.total || 0), businesses: t?.biz?.length || 0 },
    usage: { products, customers, invoices, returns30d: returns30, ticketsOpen },
    alerts,
  });
});

// Till-only staff sign in with a PIN; their address is made up, so it is never shown.
const realEmail = (email) => (email && !email.endsWith(".till.local") ? email : "");

// GET /api/platform/users?q=&kind=owner|staff|platform&status=active|suspended&page= — every person with a login
platformRouter.get("/users", async (req, res) => {
  const filter = {};
  const term = escapeRegex(req.query.q);
  if (term) filter.$or = [{ name: { $regex: term, $options: "i" } }, { email: { $regex: term, $options: "i" } }, { phone: { $regex: term } }];
  if (["active", "suspended"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.kind === "platform") filter.platformRole = { $in: ["overseer", "support"] };
  if (req.query.kind === "owner" || req.query.kind === "staff") {
    filter._id = { $in: await Membership.distinct("userId", { role: req.query.kind === "owner" ? "owner" : { $ne: "owner" } }) };
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select("name email phone status platformRole lastLoginAt createdAt emailVerified").lean(),
    User.countDocuments(filter),
  ]);

  const mems = await Membership.find({ userId: { $in: users.map((u) => u._id) } }).select("userId role businessId accountId status").lean();
  const biz = await Business.find({
    $or: [{ _id: { $in: mems.map((m) => m.businessId).filter(Boolean) } }, { accountId: { $in: mems.map((m) => m.accountId) } }],
  }).select("name accountId").sort({ createdAt: 1 }).lean();
  const bizName = new Map(biz.map((b) => [String(b._id), b.name]));
  const accountName = new Map();
  for (const b of biz) if (!accountName.has(String(b.accountId))) accountName.set(String(b.accountId), b.name);

  res.json({
    users: users.map((u) => ({
      id: u._id, name: u.name, email: realEmail(u.email), phone: u.phone || "",
      status: u.status, platformRole: u.platformRole || "none", lastLoginAt: u.lastLoginAt || null,
      createdAt: u.createdAt, emailVerified: !!u.emailVerified,
      roles: mems.filter((m) => String(m.userId) === String(u._id)).map((m) => ({
        role: m.role,
        business: (m.businessId && bizName.get(String(m.businessId))) || accountName.get(String(m.accountId)) || "",
        accountId: m.accountId,
        active: m.status === "active",
      })),
    })),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

// POST /api/platform/users/:id/status — suspend or restore one person (not their whole account)
platformRouter.post("/users/:id/status", requireOverseer, async (req, res) => {
  const status = req.body?.status;
  if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "invalid", message: "Status must be active or suspended." });
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) return res.status(404).json({ error: "not_found", message: "Person not found." });
  if (String(user._id) === String(req.platformUser._id)) return res.status(400).json({ error: "invalid", message: "You can't suspend yourself." });
  const before = user.status;
  if (before !== status) {
    user.status = status;
    await user.save();
    logPlatform(req, "platform.user_status", { type: "user", id: user._id, label: `${user.name}${realEmail(user.email) ? ` (${user.email})` : ""}` },
      { status: before }, { status, reason: String(req.body?.reason || "").trim().slice(0, 300) });
  }
  res.json({ user: { id: user._id, status: user.status } });
});

// GET /api/platform/activity?kind=all|admin|events&limit= — one timeline: what StarTrack staff did,
// and what happened across the platform (sign-ups, payments, tickets raised to StarTrack).
platformRouter.get("/activity", async (req, res) => {
  const { PlatformLog } = await import("#modules/platform/platformLog.model.js");
  const kind = ["admin", "events"].includes(req.query.kind) ? req.query.kind : "all";
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
  const items = [];

  if (kind !== "events") {
    const logs = await PlatformLog.find({}).sort({ at: -1 }).limit(limit).lean();
    for (const l of logs) {
      items.push({ kind: "admin", action: l.action, at: l.at, actor: l.actorName, target: l.target?.label || "", targetType: l.target?.type || "", targetId: l.target?.id || null, before: l.before ?? null, after: l.after ?? null });
    }
  }
  if (kind !== "admin") {
    const [accounts, paying, tickets] = await Promise.all([
      Account.find({ isSandbox: { $ne: true } }).sort({ createdAt: -1 }).limit(limit).select("name plan createdAt").lean(),
      Account.find({ "subscription.payments.0": { $exists: true } }).select("name subscription.payments").lean(),
      Ticket.find({ scope: "platform" }).sort({ escalatedAt: -1 }).limit(limit).select("ticketNo subject escalatedAt createdAt priority businessId").lean(),
    ]);
    for (const a of accounts) items.push({ kind: "signup", at: a.createdAt, target: a.name, targetType: "account", targetId: a._id, detail: a.plan });
    for (const a of paying) {
      for (const p of a.subscription.payments || []) items.push({ kind: "payment", at: p.at, target: a.name, targetType: "account", targetId: a._id, amount: p.amount, detail: p.plan });
    }
    const biz = await Business.find({ _id: { $in: tickets.map((t) => t.businessId) } }).select("name").lean();
    const bizName = new Map(biz.map((b) => [String(b._id), b.name]));
    for (const t of tickets) {
      items.push({ kind: "ticket", at: t.escalatedAt || t.createdAt, target: bizName.get(String(t.businessId)) || "", detail: `${t.ticketNo}: ${t.subject}`, priority: t.priority });
    }
  }
  items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  res.json({ items: items.slice(0, limit) });
});

// GET /api/platform/export/:kind — accounts | businesses | users | payments, as an Excel file
const EXPORTS = ["accounts", "businesses", "users", "payments"];
platformRouter.get("/export/:kind", async (req, res) => {
  const kind = req.params.kind;
  if (!EXPORTS.includes(kind)) return res.status(404).json({ error: "not_found" });
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "StarTrack";
  const ws = wb.addWorksheet(kind[0].toUpperCase() + kind.slice(1), { views: [{ state: "frozen", ySplit: 1 }] });
  const accounts = await Account.find({ isSandbox: { $ne: true } }).sort({ createdAt: -1 }).lean();
  const acctById = new Map(accounts.map((a) => [String(a._id), a]));

  if (kind === "accounts") {
    const owners = await User.find({ _id: { $in: accounts.map((a) => a.ownerUserId) } }).select("name email phone").lean();
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));
    ws.columns = [
      { header: "Account", key: "name", width: 32 }, { header: "Owner", key: "owner", width: 24 }, { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 16 }, { header: "Plan", key: "plan", width: 16 }, { header: "Status", key: "status", width: 12 },
      { header: "Paid until", key: "until", width: 14 }, { header: "Joined", key: "joined", width: 14 },
    ];
    for (const a of accounts) {
      const o = ownerById.get(String(a.ownerUserId));
      const st = planStatus(a);
      ws.addRow({
        name: a.name, owner: o?.name || "", email: realEmail(o?.email), phone: o?.phone || "",
        plan: st.legacy ? "legacy" : st.lapsed ? `${a.subscription?.plan || st.plan} (lapsed)` : st.trial ? `${st.plan} (trial)` : st.plan,
        status: a.status || "active", until: st.periodEnd ? new Date(st.periodEnd) : null, joined: a.createdAt,
      });
    }
  } else if (kind === "businesses") {
    const [businesses, sold] = await Promise.all([
      Business.find({}).sort({ createdAt: -1 }).lean(),
      Sale.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$businessId", last: { $max: "$at" }, n: { $sum: 1 }, total: { $sum: "$total" } } }]),
    ]);
    const soldBy = new Map(sold.map((s) => [String(s._id), s]));
    ws.columns = [
      { header: "Business", key: "name", width: 32 }, { header: "Trade", key: "trade", width: 24 }, { header: "Account", key: "account", width: 28 },
      { header: "Sales", key: "n", width: 10 }, { header: "Total sold", key: "total", width: 16 }, { header: "Last sale", key: "last", width: 14 },
      { header: "Created", key: "created", width: 14 },
    ];
    for (const b of businesses) {
      const s = soldBy.get(String(b._id));
      ws.addRow({ name: b.name, trade: typeTemplate(b.typeKey).label, account: acctById.get(String(b.accountId))?.name || "", n: s?.n || 0, total: money(s?.total || 0), last: s?.last || null, created: b.createdAt });
    }
    ws.getColumn("total").numFmt = "#,##0.00";
  } else if (kind === "users") {
    const users = await User.find({}).sort({ createdAt: -1 }).select("name email phone status platformRole lastLoginAt createdAt").lean();
    ws.columns = [
      { header: "Name", key: "name", width: 26 }, { header: "Email", key: "email", width: 32 }, { header: "Phone", key: "phone", width: 16 },
      { header: "Status", key: "status", width: 12 }, { header: "StarTrack role", key: "prole", width: 14 },
      { header: "Last sign-in", key: "last", width: 16 }, { header: "Joined", key: "joined", width: 14 },
    ];
    for (const u of users) {
      ws.addRow({ name: u.name, email: realEmail(u.email) || "(till only)", phone: u.phone || "", status: u.status, prole: u.platformRole && u.platformRole !== "none" ? u.platformRole : "", last: u.lastLoginAt || null, joined: u.createdAt });
    }
  } else {
    ws.columns = [
      { header: "Account", key: "name", width: 32 }, { header: "Plan", key: "plan", width: 12 }, { header: "Amount", key: "amount", width: 14 },
      { header: "Paid on", key: "at", width: 14 }, { header: "Reference", key: "ref", width: 30 },
    ];
    const rows = [];
    for (const a of accounts) for (const p of a.subscription?.payments || []) rows.push({ name: a.name, plan: p.plan, amount: p.amount, at: p.at, ref: p.reference || "" });
    rows.sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0)).forEach((r) => ws.addRow(r));
    ws.getColumn("amount").numFmt = "#,##0.00";
  }

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E2A22" } };
  ws.eachRow((row, n) => { if (n > 1) row.eachCell((c) => { if (c.value instanceof Date) c.numFmt = "dd mmm yyyy"; }); });
  const buf = await wb.xlsx.writeBuffer();
  logPlatform(req, "platform.export", { type: "export", label: kind });
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="startrack-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    "Cache-Control": "no-store",
  });
  res.send(Buffer.from(buf));
});
