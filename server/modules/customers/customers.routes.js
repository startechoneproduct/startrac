import { Router } from "express";
import { z } from "zod";
import { Customer } from "#modules/customers/customer.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { CustomerLedgerEntry, applyCreditChange } from "#modules/customers/customerLedger.model.js";
import { requirePerm, requireBranch, limitProblem } from "#core/middleware/tenant.js";
import { customerRoom } from "#modules/customers/customerLimit.js";
import { hasCapability } from "#shared/businessTypes.js";
import { money } from "#core/money.js";
import { scopedToBranch, ownerBranchForNew } from "#core/branchScope.js";
import { audit } from "#core/audit.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { escapeRegex } from "#core/regex.js";

export const customersRouter = Router();

function shape(c) {
  return {
    id: c._id,
    name: c.name,
    phone: c.phone,
    whatsapp: c.whatsapp,
    notes: c.notes,
    totalSpend: c.totalSpend,
    visits: c.visits,
    firstSeen: c.firstSeen,
    lastSeen: c.lastSeen,
    creditBalance: c.creditBalance || 0,
    storeCredit: c.storeCredit || 0,
    source: c.source || "pos",
    email: c.email || "",
    address: c.address || "",
  };
}

// GET /api/customers?q= — pass debtorsOnly=1 to see only who owes money.
customersRouter.get("/", requirePerm("customers", "sales"), async (req, res) => {
  const filter = { businessId: req.ctx.businessId };
  if (req.query.q) {
    const q = escapeRegex(req.query.q).slice(0, 60);
    filter.$or = [{ name: { $regex: q, $options: "i" } }, { phone: { $regex: q } }, { email: { $regex: q, $options: "i" } }];
  }
  if (req.query.debtorsOnly === "1") filter.creditBalance = { $gt: 0 };
  if (req.query.source === "website") filter.source = "website";
  const customers = await Customer.find(scopedToBranch(req.ctx, filter)).sort(req.query.debtorsOnly === "1" ? { creditBalance: -1 } : { lastSeen: -1 }).limit(200);
  // The "credit" capability's headline number — how much is out there right
  // now, across every debtor, not just the page on screen.
  let totalOutstanding = 0;
  if (hasCapability(req.ctx.business.typeKey, "credit")) {
    const [agg] = await Customer.aggregate([
      { $match: scopedToBranch(req.ctx, { businessId: req.ctx.businessId, creditBalance: { $gt: 0 } }) },
      { $group: { _id: null, total: { $sum: "$creditBalance" } } },
    ]);
    totalOutstanding = money(agg?.total || 0);
  }
  const room = await customerRoom(req.ctx.businessId, req.ctx.plan);
  res.json({ customers: customers.map(shape), totalOutstanding, usage: { count: room.count, cap: room.cap } });
});

const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().default(""),
  whatsapp: z.string().default(""),
  notes: z.string().default(""),
  // With several stores a new customer belongs to the active store unless shared.
  shareWithAllStores: z.boolean().default(false),
});

// POST /api/customers
customersRouter.post("/", requirePerm("customers", "sales"), async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const room = await customerRoom(req.ctx.businessId, req.ctx.plan);
  const full = limitProblem(req.ctx.plan, "customers", room.count);
  if (full) return res.status(403).json(full);

  if (d.phone) {
    const dupe = await Customer.findOne(scopedToBranch(req.ctx, { businessId: req.ctx.businessId, phone: d.phone }));
    if (dupe) return res.status(409).json({ error: "phone_taken", message: `${dupe.name} already has that phone number.` });
  }

  const customer = await Customer.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: await ownerBranchForNew(req.ctx, { shared: d.shareWithAllStores }),
    ...d,
    whatsapp: d.whatsapp || d.phone,
  });
  res.status(201).json({ customer: shape(customer) });
});

// PATCH /api/customers/:id
customersRouter.patch("/:id", requirePerm("customers"), async (req, res) => {
  const parsed = customerSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });

  const customer = await Customer.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!customer) return res.status(404).json({ error: "not_found", message: "Customer not found." });
  Object.assign(customer, parsed.data);
  await customer.save();
  res.json({ customer: shape(customer) });
});

// GET /api/customers/:id — profile + purchase history
customersRouter.get("/:id", requirePerm("customers"), async (req, res) => {
  const customer = await Customer.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!customer) return res.status(404).json({ error: "not_found", message: "Customer not found." });
  const sales = await Sale.find({ businessId: req.ctx.businessId, customerId: customer._id })
    .sort({ at: -1 })
    .limit(25)
    .select("saleNo at total status items.name items.qty");
  res.json({
    customer: shape(customer),
    sales: sales.map((s) => ({
      id: s._id,
      saleNo: s.saleNo,
      at: s.at,
      total: s.total,
      status: s.status,
      summary: s.items.map((i) => `${i.name} ×${i.qty}`).join(", "),
    })),
  });
});

// GET /api/customers/:id/ledger — the "credit" capability's statement:
// every sale that added to the balance and every repayment that reduced it.
customersRouter.get("/:id/ledger", requirePerm("customers"), async (req, res) => {
  const customer = await Customer.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!customer) return res.status(404).json({ error: "not_found", message: "Customer not found." });
  const entries = await CustomerLedgerEntry.find({ businessId: req.ctx.businessId, customerId: customer._id })
    .sort({ at: -1 })
    .limit(100);
  res.json({
    creditBalance: customer.creditBalance || 0,
    entries: entries.map((e) => ({
      id: e._id, type: e.type, amount: e.amount, balanceAfter: e.balanceAfter,
      method: e.method, refType: e.refType, note: e.note, byName: e.byName, at: e.at,
    })),
  });
});

const creditPaymentSchema = z.object({
  amount: z.number().positive("Enter an amount"),
  method: z.enum(["cash", "pos", "transfer"]).default("cash"),
  note: z.string().default(""),
});

// POST /api/customers/:id/ledger/payments — a debtor pays down what they owe.
// The money physically arrived today (unlike the sale that created the debt,
// which was recognised as revenue when it happened), so this only ever moves
// the till's payment split — never revenue/profit a second time.
customersRouter.post("/:id/ledger/payments", requirePerm("customers", "sales"), requireBranch, async (req, res) => {
  if (!hasCapability(req.ctx.business.typeKey, "credit")) {
    return res.status(400).json({ error: "not_supported", message: "This business doesn't track customer credit." });
  }
  const parsed = creditPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const customer = await Customer.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!customer) return res.status(404).json({ error: "not_found", message: "Customer not found." });

  const balance = await applyCreditChange(req.ctx, {
    customer, type: "payment", amount: -money(d.amount), method: d.method, refType: "manual", note: d.note,
  });
  await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(), { payments: { [d.method]: d.amount } });
  audit(req.ctx, "customer.credit_payment", { type: "customer", id: customer._id, label: customer.name }, undefined, {
    amount: d.amount, method: d.method, balanceAfter: balance,
  });
  res.status(201).json({ creditBalance: balance });
});
