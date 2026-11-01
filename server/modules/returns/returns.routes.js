import { Router } from "express";
import { z } from "zod";
import { Sale } from "#modules/sales/sale.model.js";
import { Return } from "#modules/returns/return.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { conflict, notFound } from "#core/httpError.js";
import { afterStockChange, raiseReturnPending, resolveReturnPending } from "#modules/alerts/alerts.service.js";

export const returnsRouter = Router();

function shape(r) {
  return {
    id: r._id,
    saleId: r.saleId,
    saleNo: r.saleNo,
    items: r.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, unitPrice: i.unitPrice })),
    refund: r.refund,
    reason: r.reason,
    status: r.status,
    requestedByName: r.requestedByName,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  };
}

const submitSchema = z.object({
  saleId: z.string(),
  items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1, "Pick what's being returned"),
  reason: z.string().min(3, "Give a reason for the return"),
  refundMethod: z.enum(["cash", "pos", "transfer"]).default("cash"),
});

// POST /api/returns — staff submit; refund is priced from the ORIGINAL sale
// (net of its proportional share of any header discount).
returnsRouter.post("/", requirePerm("returns"), requireBranch, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const sale = await Sale.findOne({ _id: d.saleId, businessId: req.ctx.businessId });
  if (!sale) return res.status(404).json({ error: "not_found", message: "Sale not found. Check the receipt number." });
  if (sale.status === "voided") return res.status(409).json({ error: "voided", message: "That sale was voided — nothing to return." });
  if (sale.service?.kind) {
    return res.status(409).json({ error: "service_payment", message: "That's a service payment, not goods — reverse it from the screen it belongs to." });
  }
  if (sale.channel === "invoice") {
    return res.status(409).json({ error: "invoice_sale", message: "That sale is an invoice. To cancel it, void the invoice from Invoices." });
  }
  if (sale.channel === "import") {
    return res.status(409).json({ error: "imported_sale", message: "That sale came from an uploaded history file, so there's no stock to put back. Undo the upload from Import history if it was a mistake." });
  }

  // The share of every net naira the customer actually paid (discount spread).
  const paidFactor = sale.subtotal > 0 ? (sale.subtotal - sale.discount) / sale.subtotal : 1;

  const items = [];
  let refundAmount = 0;
  for (const item of d.items) {
    const line = sale.items.find((l) => String(l.productId) === item.productId);
    if (!line) return res.status(400).json({ error: "invalid", message: "That product isn't on this receipt." });

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
        message: `Only ${returnable} × ${line.name} can still be returned on this receipt.`,
      });
    }

    const isCustom = !!line.components?.length;
    const unitNet = money((line.lineNet / line.qty) * paidFactor);
    // Custom-made items: money comes back, cost doesn't (the fabric is cut)
    // and nothing restocks.
    const unitCost = isCustom ? 0 : line.qty > 0 ? money(line.lineCost / line.qty) : 0;
    items.push({ productId: line.productId, name: line.name, qty: item.qty, unitPrice: unitNet, unitCost, restock: !isCustom });
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
    items,
    refund: { method: d.refundMethod, amount: refundAmount },
    reason: d.reason,
    requestedBy: req.ctx.userId,
    requestedByName: req.ctx.actorName,
  });

  // A return sitting unapproved is money and stock in limbo — tell someone.
  raiseReturnPending(req.ctx, ret);

  res.status(201).json({ return: shape(ret) });
});

// GET /api/returns?status=pending
returnsRouter.get("/", requirePerm("returns", "approve_returns"), requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (req.query.status) filter.status = req.query.status;
  // Staff without approval rights see only their own submissions.
  if (!req.ctx.perms.includes("*") && !req.ctx.perms.includes("approve_returns")) {
    filter.requestedBy = req.ctx.userId;
  }
  const returns = await Return.find(filter).sort({ createdAt: -1 }).limit(100);
  res.json({ returns: returns.map(shape) });
});

// POST /api/returns/:id/approve — restores stock, corrects money. One
// transaction: the stock coming back, the sale's returnedQty, the refund and
// the customer's spend are a single decision and commit as one.
returnsRouter.post("/:id/approve", requirePerm("approve_returns"), async (req, res) => {
  const ret = await withTransaction(async (session) => {
    const ret = await Return.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!ret) throw notFound("Return not found.");
    if (ret.status !== "pending") throw conflict("This return was already decided.", "decided");

    const sale = await Sale.findById(ret.saleId).session(session);

    for (const item of ret.items) {
      if (item.restock !== false) {
        await applyMovement(req.ctx, {
          branchId: ret.branchId,
          productId: item.productId,
          productName: item.name,
          type: "RETURN",
          qty: item.qty,
          refType: "return",
          refId: ret._id,
          reason: ret.reason,
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

    // Money correction: revenue and profit fall by the refund; the restocked
    // goods return their cost to inventory (cost falls too).
    const costBack = money(ret.items.reduce((s, i) => s + i.unitCost * i.qty, 0));
    await bumpDailyMetric(
      req.ctx,
      ret.branchId,
      localDay(),
      {
        revenue: -ret.refund.amount,
        cost: -costBack,
        profit: -(ret.refund.amount - costBack),
        refundTotal: ret.refund.amount,
        payments: { [ret.refund.method]: -ret.refund.amount },
      },
      session
    );

    if (sale?.customerId) {
      const customer = await Customer.findById(sale.customerId).session(session);
      if (customer) {
        customer.totalSpend = money(Math.max(0, customer.totalSpend - ret.refund.amount));
        await customer.save({ session });
      }
    }

    return ret;
  });

  // Decided, so it no longer needs a decision; and stock came back, which
  // may answer a low-stock alert on its own.
  resolveReturnPending(req.ctx.businessId, ret._id);
  afterStockChange(req.ctx, ret.branchId, ret.items.filter((i) => i.restock !== false).map((i) => i.productId));

  audit(req.ctx, "return.approve", { type: "return", id: ret._id, label: ret.saleNo }, undefined, {
    amount: ret.refund.amount,
    items: ret.items.map((i) => ({ name: i.name, qty: i.qty })),
  });
  res.json({ return: shape(ret) });
});

// POST /api/returns/:id/reject
returnsRouter.post("/:id/reject", requirePerm("approve_returns"), async (req, res) => {
  const ret = await Return.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!ret) return res.status(404).json({ error: "not_found", message: "Return not found." });
  if (ret.status !== "pending") return res.status(409).json({ error: "decided", message: "This return was already decided." });

  ret.status = "rejected";
  ret.decidedBy = req.ctx.userId;
  ret.decidedByName = req.ctx.actorName;
  ret.decidedAt = new Date();
  ret.decisionNote = String(req.body?.note || "");
  await ret.save();

  resolveReturnPending(req.ctx.businessId, ret._id);
  audit(req.ctx, "return.reject", { type: "return", id: ret._id, label: ret.saleNo }, undefined, { note: ret.decisionNote });
  res.json({ return: shape(ret) });
});
