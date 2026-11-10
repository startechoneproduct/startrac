import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Sale } from "#modules/sales/sale.model.js";
import { Return } from "#modules/returns/return.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { changeStoreCredit } from "#modules/customers/storeCredit.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { conflict, notFound, HttpError } from "#core/httpError.js";
import { nextSeq } from "#core/counters.js";
import { escapeRegex } from "#core/regex.js";
import { afterStockChange, raiseReturnPending, resolveReturnPending } from "#modules/alerts/alerts.service.js";

export const returnsRouter = Router();

const REASON_TYPES = ["defective", "wrong_item", "damaged", "not_wanted", "expired", "other"];
const OUTCOMES = ["refund", "store_credit", "exchange"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function shape(r) {
  return {
    id: r._id,
    returnNo: r.returnNo || "",
    saleId: r.saleId,
    saleNo: r.saleNo,
    customerId: r.customerId || null,
    customerName: r.customerName || "",
    items: r.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, unitPrice: i.unitPrice, condition: i.condition || "good", restock: i.restock !== false })),
    refund: r.refund,
    outcome: r.outcome || (r.refund?.method === "store_credit" ? "store_credit" : "refund"),
    reasonType: r.reasonType || "other",
    reason: r.reason,
    status: r.status,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  };
}

// GET /api/returns/sales?saleNo=&customerId=&date=&timeFrom=&timeTo=&productId=
// Finding the sale a customer is bringing back, by whatever they remember:
// the receipt number, who they are, the day (and roughly the time) they came,
// or what they bought. Open to everyone who may record a return, for every
// sale in the branch (unlike sales history, where staff see only their own),
// and it shows only what a return needs: no costs.
returnsRouter.get("/sales", requirePerm("returns"), requireBranch, async (req, res) => {
  const { saleNo, customerId, date, timeFrom, timeTo, productId } = req.query;
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId, channel: { $nin: ["invoice", "import"] } };
  let criteria = 0;
  if (saleNo && String(saleNo).trim()) { filter.saleNo = { $regex: `${escapeRegex(saleNo)}$`, $options: "i" }; criteria++; }
  if (customerId && mongoose.isValidObjectId(customerId)) { filter.customerId = new mongoose.Types.ObjectId(String(customerId)); criteria++; }
  if (productId && mongoose.isValidObjectId(productId)) { filter["items.productId"] = new mongoose.Types.ObjectId(String(productId)); criteria++; }
  if (DAY.test(date || "")) {
    const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
    const start = new Date(`${date}T${TIME.test(timeFrom || "") ? timeFrom : "00:00"}:00`);
    const end = TIME.test(timeTo || "") ? new Date(`${date}T${timeTo}:59.999`) : new Date(new Date(`${date}T00:00:00`).getTime() + 86_400_000);
    if (end <= start) return res.status(400).json({ error: "invalid", message: "The end time is before the start time." });
    filter.at = { $gte: start, $lt: end };
    criteria++;
  }
  if (!criteria) return res.status(400).json({ error: "invalid", message: "Search by receipt number, customer, date or product." });

  const sales = await Sale.find(filter).sort({ at: -1 }).limit(30);
  res.json({
    sales: sales.map((s) => ({
      id: s._id, saleNo: s.saleNo, at: s.at, staffName: s.staffName, status: s.status,
      customerId: s.customerId || null, customerName: s.customerName || "",
      subtotal: s.subtotal, discount: s.discount, vat: s.vat, total: s.total,
      items: s.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, unitPrice: i.unitPrice, lineNet: i.lineNet, returnedQty: i.returnedQty || 0, ...(i.components?.length ? { custom: true } : {}) })),
    })),
  });
});

const submitSchema = z.object({
  saleId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    qty: z.number().int().positive(),
    condition: z.enum(["good", "damaged"]).default("good"),
  })).min(1, "Pick what's being returned"),
  reasonType: z.enum(REASON_TYPES).default("other"),
  reason: z.string().trim().max(500).default(""),
  outcome: z.enum(OUTCOMES).default("refund"),
  refundMethod: z.enum(["cash", "pos", "transfer"]).default("cash"),
  // For store credit or an exchange on a sale that had no customer: who the credit belongs to.
  customerId: z.string().optional(),
});

// POST /api/returns — staff submit; refund is priced from the ORIGINAL sale
// (net of its proportional share of any header discount).
returnsRouter.post("/", requirePerm("returns"), requireBranch, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;
  if (d.reasonType === "other" && d.reason.length < 3) {
    return res.status(400).json({ error: "invalid", message: "Say why the item is coming back." });
  }

  if (!mongoose.isValidObjectId(d.saleId)) return res.status(404).json({ error: "not_found", message: "Sale not found. Check the receipt number." });
  const sale = await Sale.findOne({ _id: d.saleId, businessId: req.ctx.businessId });
  if (!sale) return res.status(404).json({ error: "not_found", message: "Sale not found. Check the receipt number." });
  if (sale.status === "voided") return res.status(409).json({ error: "voided", message: "That sale was voided — nothing to return." });
  if (sale.undoRequest?.status === "pending") return res.status(409).json({ error: "undo_pending", message: "Someone asked to undo this sale. A manager has to decide that first." });
  if (sale.service?.kind) {
    return res.status(409).json({ error: "service_payment", message: "That's a service payment, not goods — reverse it from the screen it belongs to." });
  }
  if (sale.channel === "invoice") {
    return res.status(409).json({ error: "invoice_sale", message: "That sale is an invoice. To cancel it, void the invoice from Invoices." });
  }
  if (sale.channel === "import") {
    return res.status(409).json({ error: "imported_sale", message: "That sale came from an uploaded history file, so there's no stock to put back. Undo the upload from Import history if it was a mistake." });
  }

  // Store credit and exchanges belong to someone: the sale's customer, or one picked now.
  let customer = null;
  if (d.outcome !== "refund") {
    const id = sale.customerId || (d.customerId && mongoose.isValidObjectId(d.customerId) ? d.customerId : null);
    customer = id ? await Customer.findOne({ _id: id, businessId: req.ctx.businessId }) : null;
    if (!customer) return res.status(400).json({ error: "needs_customer", message: "Store credit has to go to a customer. Choose who it's for." });
  }

  // The share of every net naira the customer actually paid (discount spread).
  const paidFactor = sale.subtotal > 0 ? (sale.subtotal - sale.discount) / sale.subtotal : 1;

  const items = [];
  let refundAmount = 0;
  const seen = new Set();
  for (const item of d.items) {
    if (seen.has(item.productId)) return res.status(400).json({ error: "invalid", message: "Each item can only be listed once." });
    seen.add(item.productId);
    const line = sale.items.find((l) => String(l.productId) === item.productId);
    if (!line) return res.status(400).json({ error: "invalid", message: "That product isn't on this receipt." });

    // Counts what is already back or waiting for a decision, so the same item can't be returned twice.
    const pendingOrReturned = await Return.aggregate([
      { $match: { saleId: sale._id, status: { $in: ["pending", "approved"] } } },
      { $unwind: "$items" },
      { $match: { "items.productId": line.productId } },
      { $group: { _id: null, qty: { $sum: "$items.qty" } } },
    ]);
    const already = pendingOrReturned[0]?.qty || 0;
    const returnable = line.qty - already;
    if (item.qty > returnable) {
      return res.status(409).json({
        error: "too_many",
        message: returnable > 0
          ? `Only ${returnable} × ${line.name} can still be returned on this receipt.`
          : `${line.name} has already been returned in full (or is waiting for approval).`,
      });
    }

    const isCustom = !!line.components?.length;
    const unitNet = money((line.lineNet / line.qty) * paidFactor);
    // Custom-made items: money comes back, cost doesn't (the fabric is cut)
    // and nothing restocks. Damaged items come back but never go on the shelf.
    const unitCost = isCustom ? 0 : line.qty > 0 ? money(line.lineCost / line.qty) : 0;
    items.push({ productId: line.productId, name: line.name, qty: item.qty, unitPrice: unitNet, unitCost, condition: item.condition, restock: !isCustom && item.condition === "good" });
    refundAmount += unitNet * item.qty;
  }

  // VAT on the refunded portion comes back too.
  const vatFactor = sale.subtotal - sale.discount > 0 ? sale.vat / (sale.subtotal - sale.discount) : 0;
  refundAmount = money(refundAmount * (1 + vatFactor));

  const ret = await Return.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: sale.branchId,
    saleId: sale._id,
    saleNo: sale.saleNo,
    returnNo: `RTN-${String(await nextSeq(`rtn:${req.ctx.businessId}`)).padStart(4, "0")}`,
    customerId: customer?._id || sale.customerId || null,
    customerName: customer?.name || sale.customerName || "",
    items,
    refund: { method: d.outcome === "refund" ? d.refundMethod : "store_credit", amount: refundAmount },
    outcome: d.outcome,
    reasonType: d.reasonType,
    reason: d.reason,
    requestedBy: req.ctx.userId,
    requestedByName: req.ctx.actorName,
  });

  // A return sitting unapproved is money and stock in limbo — tell someone.
  raiseReturnPending(req.ctx, ret);

  res.status(201).json({ return: shape(ret) });
});

// GET /api/returns?status=&outcome=&q=&from=&to= — the returns, plus totals for the same filter
returnsRouter.get("/", requirePerm("returns", "approve_returns"), requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (["pending", "approved", "rejected"].includes(req.query.status)) filter.status = req.query.status;
  if (OUTCOMES.includes(req.query.outcome)) filter.outcome = req.query.outcome;
  if (DAY.test(req.query.from || "") || DAY.test(req.query.to || "")) {
    filter.createdAt = {};
    if (DAY.test(req.query.from || "")) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00`);
    if (DAY.test(req.query.to || "")) filter.createdAt.$lt = new Date(new Date(`${req.query.to}T00:00:00`).getTime() + 86_400_000);
  }
  const term = escapeRegex(req.query.q);
  if (term) {
    const rx = new RegExp(term, "i");
    filter.$or = [{ returnNo: rx }, { saleNo: rx }, { customerName: rx }, { "items.name": rx }, { reason: rx }];
  }
  // Staff without approval rights see only their own submissions.
  if (!req.ctx.perms.includes("*") && !req.ctx.perms.includes("approve_returns")) {
    filter.requestedBy = req.ctx.userId;
  }
  const returns = await Return.find(filter).sort({ createdAt: -1 }).limit(300);
  const approved = returns.filter((r) => r.status === "approved");
  const sum = (rows) => money(rows.reduce((s, r) => s + r.refund.amount, 0));
  res.json({
    returns: returns.map(shape),
    totals: {
      pending: returns.filter((r) => r.status === "pending").length,
      refunded: sum(approved.filter((r) => r.refund.method !== "store_credit")),
      credited: sum(approved.filter((r) => r.refund.method === "store_credit")),
      damagedUnits: approved.reduce((s, r) => s + r.items.filter((i) => i.condition === "damaged").reduce((n, i) => n + i.qty, 0), 0),
      restockedUnits: approved.reduce((s, r) => s + r.items.filter((i) => i.restock !== false).reduce((n, i) => n + i.qty, 0), 0),
    },
  });
});

// POST /api/returns/:id/approve — restores stock, corrects money. One
// transaction: the stock coming back, the sale's returnedQty, the refund (or
// credit) and the customer's spend are a single decision and commit as one.
returnsRouter.post("/:id/approve", requirePerm("approve_returns"), async (req, res) => {
  const ret = await withTransaction(async (session) => {
    const ret = await Return.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!ret) throw notFound("Return not found.");
    if (ret.status !== "pending") throw conflict("This return was already decided.", "decided");
    // Two people, always: whoever recorded a return can't also approve it
    // (the owner excepted — in a one-person shop there is nobody else).
    if (String(ret.requestedBy) === String(req.ctx.userId) && !req.ctx.perms.includes("*")) {
      throw new HttpError(403, "own_return", "You recorded this return, so someone else has to approve it.");
    }

    const sale = await Sale.findById(ret.saleId).session(session);

    for (const item of ret.items) {
      // Only good items go back on the shelf; damaged ones are recorded on the return and written off below.
      if (item.restock !== false) {
        await applyMovement(req.ctx, {
          branchId: ret.branchId,
          productId: item.productId,
          productName: item.name,
          type: "RETURN",
          qty: item.qty,
          refType: "return",
          refId: ret._id,
          reason: [ret.returnNo, ret.reason].filter(Boolean).join(" · "),
          session,
        });
      }
      if (sale) {
        const line = sale.items.find((l) => String(l.productId) === String(item.productId));
        if (line) line.returnedQty += item.qty;
      }
    }
    if (sale) await sale.save({ session });

    ret.status = "approved";
    ret.decidedBy = req.ctx.userId;
    ret.decidedByName = req.ctx.actorName;
    ret.decidedAt = new Date();
    ret.decisionNote = String(req.body?.note || "");
    await ret.save({ session });

    // Money correction: revenue and profit fall by the refund; the goods'
    // cost comes out of cost of goods sold. A damaged item's cost is then
    // written off as waste — it isn't sold and isn't on the shelf either.
    const costBack = money(ret.items.reduce((s, i) => s + i.unitCost * i.qty, 0));
    const damagedCost = money(ret.items.filter((i) => i.condition === "damaged").reduce((s, i) => s + i.unitCost * i.qty, 0));
    const toCredit = ret.refund.method === "store_credit";
    await bumpDailyMetric(
      req.ctx,
      ret.branchId,
      localDay(),
      {
        revenue: -ret.refund.amount,
        cost: -costBack,
        profit: -(ret.refund.amount - costBack) - damagedCost,
        refundTotal: ret.refund.amount,
        wasteTotal: damagedCost,
        // Store credit doesn't leave the till; a refund does.
        payments: toCredit ? {} : { [ret.refund.method]: -ret.refund.amount },
      },
      session
    );

    if (ret.customerId) {
      const customer = await Customer.findById(ret.customerId).session(session);
      if (customer) {
        customer.totalSpend = money(Math.max(0, customer.totalSpend - ret.refund.amount));
        await customer.save({ session });
      }
      if (toCredit) await changeStoreCredit(req.ctx, ret.customerId, ret.refund.amount, { refType: "return", refId: ret._id, refNo: ret.returnNo, session });
    }

    return ret;
  });

  // Decided, so it no longer needs a decision; and stock came back, which
  // may answer a low-stock alert on its own.
  resolveReturnPending(req.ctx.businessId, ret._id);
  afterStockChange(req.ctx, ret.branchId, ret.items.filter((i) => i.restock !== false).map((i) => i.productId));

  audit(req.ctx, "return.approve", { type: "return", id: ret._id, label: ret.returnNo || ret.saleNo }, undefined, {
    amount: ret.refund.amount,
    outcome: ret.outcome,
    items: ret.items.map((i) => ({ name: i.name, qty: i.qty, condition: i.condition })),
  });
  res.json({ return: shape(ret) });
});

// POST /api/returns/:id/reject
returnsRouter.post("/:id/reject", requirePerm("approve_returns"), async (req, res) => {
  const ret = await Return.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!ret) return res.status(404).json({ error: "not_found", message: "Return not found." });
  if (ret.status !== "pending") return res.status(409).json({ error: "decided", message: "This return was already decided." });
  if (String(ret.requestedBy) === String(req.ctx.userId) && !req.ctx.perms.includes("*")) {
    return res.status(403).json({ error: "own_return", message: "You recorded this return, so someone else has to decide on it." });
  }

  ret.status = "rejected";
  ret.decidedBy = req.ctx.userId;
  ret.decidedByName = req.ctx.actorName;
  ret.decidedAt = new Date();
  ret.decisionNote = String(req.body?.note || "");
  await ret.save();

  resolveReturnPending(req.ctx.businessId, ret._id);
  audit(req.ctx, "return.reject", { type: "return", id: ret._id, label: ret.returnNo || ret.saleNo }, undefined, { note: ret.decisionNote });
  res.json({ return: shape(ret) });
});
