import { buildReceipt, receiptUrl, receiptMessage } from "#modules/sales/receipt.js";
import { waUrl } from "#core/share.js";
import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Sale } from "#modules/sales/sale.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Return } from "#modules/returns/return.model.js";
import { requirePerm, requireBranch, canSeeCost } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { conflict, notFound } from "#core/httpError.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";
import { runCheckout } from "#modules/sales/checkout.service.js";
import { Order } from "#modules/storefront/order.model.js";
import { escapeRegex } from "#core/regex.js";

export const salesRouter = Router();

function shapeSale(s, showCost) {
  return {
    id: s._id,
    saleNo: s.saleNo,
    at: s.at,
    staffName: s.staffName,
    customerId: s.customerId || null,
    customerName: s.customerName,
    channel: s.channel || "pos",
    orderNo: s.orderNo || null,
    deliveryFee: s.deliveryFee || 0,
    items: s.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineNet: i.lineNet,
      returnedQty: i.returnedQty,
      ...(i.width ? { width: i.width, height: i.height, custom: true } : {}),
      ...(i.prepStatus ? { prepStatus: i.prepStatus } : {}),
      ...(showCost ? { lineCost: i.lineCost } : {}),
    })),
    subtotal: s.subtotal,
    discount: s.discount,
    vat: s.vat,
    total: s.total,
    payments: s.payments,
    tendered: s.tendered || 0,
    change: s.change || 0,
    status: s.status,
    voidInfo: s.status === "voided" ? { byName: s.voidInfo?.byName, reason: s.voidInfo?.reason, at: s.voidInfo?.at } : undefined,
  };
}

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        qty: z.number().int().positive(),
        // Made-to-order lines carry the order's dimensions (meters) and may
        // carry a negotiated price per item.
        width: z.number().positive().max(100).optional(),
        height: z.number().positive().max(100).optional(),
        price: z.number().min(0).optional(),
        // Optional: specific in-stock units for a tracksSerials product.
        // Omit it and the sale still goes through — serial capture never
        // blocks a checkout, it just leaves the units unassigned.
        serialNos: z.array(z.string().min(1)).optional(),
      })
    )
    .min(1, "The cart is empty"),
  discount: z.number().min(0).default(0),
  payments: z
    .array(z.object({ method: z.enum(["cash", "pos", "transfer"]), amount: z.number().min(0) }))
    .min(1, "Choose a payment method")
    .max(3, "At most one entry per payment method"),
  
  tendered: z.number().min(0).optional(),
  customerId: z.string().optional(),
  customer: z.object({ name: z.string().min(1), phone: z.string().default("") }).optional(),
  clientSaleId: z.string().optional(), // offline-queue idempotency
});


salesRouter.post("/", requirePerm("sales"), requireBranch, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const { out, newLoyaltyCard } = await runCheckout(req.ctx, d);
  if (out.replayed) {
    return res.status(200).json({ sale: shapeSale(out.sale, canSeeCost(req.ctx)), replayed: true });
  }

  
  afterStockChange(req.ctx, req.ctx.branchId, out.deductedIds);

  // A customer here has a phone, never an email (CRM-lite — see
  // Customer model), so there's nothing to auto-email. The card is ready
  // the moment the cashier next opens this customer's profile, where they
  // can share it by WhatsApp (the phone we do have) or type in an email
  // on the spot — see loyaltyCard.routes.js's /email endpoint.
  if (newLoyaltyCard) {
    audit(req.ctx, "loyaltyCard.issue", { type: "loyaltyCard", id: newLoyaltyCard._id, label: out.customer?.name }, undefined, { issuedVia: "patronage" });
  }

  res.status(201).json({
    sale: shapeSale(out.sale, canSeeCost(req.ctx)),
    receipt: buildReceipt({
      business: req.ctx.business, plan: req.ctx.plan, sale: out.sale,
      customerPhone: out.customer?.whatsapp || out.customer?.phone || "", tendered: out.tendered, change: out.change,
    }),
    receiptUrl: receiptUrl(req, out.sale._id),
  });
});


function buildSalesFilter(req) {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  const canSeeAll = req.ctx.perms.includes("*") || req.ctx.perms.includes("dashboard_ops");
  if (req.query.mine === "1" || !canSeeAll) {
    // Staff see their own sales only.
    filter.staffId = req.ctx.userId;
  }
  if (req.query.staffId && mongoose.isValidObjectId(req.query.staffId)) {
    filter.staffId = new mongoose.Types.ObjectId(String(req.query.staffId));
  }
  if (req.query.status === "completed" || req.query.status === "voided") filter.status = req.query.status;
  if (req.query.saleNo) {
    filter.saleNo = { $regex: `${escapeRegex(req.query.saleNo)}$`, $options: "i" };
  }
  if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) {
    filter.customerId = new mongoose.Types.ObjectId(String(req.query.customerId));
  }
  if (req.query.productId && mongoose.isValidObjectId(req.query.productId)) {
    filter["items.productId"] = new mongoose.Types.ObjectId(String(req.query.productId));
  }
  if (req.query.method) filter["payments.method"] = String(req.query.method);
  // One upload's records. An upload belongs to the whole business, so it is shown whichever
  // branch is selected (it was saved against the branch the uploader was in).
  if (req.query.batchId && mongoose.isValidObjectId(req.query.batchId)) {
    filter.importBatchId = new mongoose.Types.ObjectId(String(req.query.batchId));
    delete filter.branchId;
  }
  if (req.query.channel === "online") filter.channel = "online";
  else if (req.query.channel === "import") filter.channel = "import";
  else if (req.query.channel === "invoice") filter.channel = "invoice";
  else if (req.query.channel === "pos") filter.channel = { $nin: ["online", "import", "invoice"] };
  const min = Number(req.query.minTotal);
  const max = Number(req.query.maxTotal);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    filter.total = {};
    if (Number.isFinite(min)) filter.total.$gte = min;
    if (Number.isFinite(max)) filter.total.$lte = max;
  }
  if (req.query.date) {
    const day = new Date(`${req.query.date}T00:00:00`);
    filter.at = { $gte: day, $lt: new Date(day.getTime() + 24 * 3600 * 1000) };
  } else if (req.query.from || req.query.to) {
    filter.at = {};
    if (req.query.from) filter.at.$gte = new Date(`${req.query.from}T00:00:00`);
    if (req.query.to) filter.at.$lt = new Date(new Date(`${req.query.to}T00:00:00`).getTime() + 24 * 3600 * 1000);
  }
  return filter;
}

// GET /api/sales — branch sales history, paged.
// Filters: date | from&to | staffId | customerId | productId | method |
//          minTotal&maxTotal | status | saleNo | mine=1
salesRouter.get("/", requirePerm("sales", "dashboard_ops"), requireBranch, async (req, res) => {
  const filter = buildSalesFilter(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);

  // Totals come from an aggregation over the WHOLE filter, not the page —
  // a summary bar that only added up the first 50 rows would quietly
  // understate every busy day.
  const [sales, [agg]] = await Promise.all([
    Sale.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit),
    Sale.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$total", 0] } },
          discount: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$discount", 0] } },
          vat: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$vat", 0] } },
        },
      },
    ]),
  ]);

  const count = agg?.count || 0;
  const revenue = money(agg?.revenue || 0);

  
  const dateOnly = !filter.staffId && !filter.saleNo && !filter.customerId &&
    !filter["items.productId"] && !filter["payments.method"] && !filter.total && !filter.status;

  let refunds = null;
  if (dateOnly) {
    const returnFilter = {
      businessId: req.ctx.businessId,
      branchId: req.ctx.branchId,
      status: "approved",
      ...(filter.at ? { decidedAt: filter.at } : {}),
    };
    const [r] = await Return.aggregate([
      { $match: returnFilter },
      { $group: { _id: null, amount: { $sum: "$refund.amount" }, n: { $sum: 1 } } },
    ]);
    refunds = { amount: money(r?.amount || 0), count: r?.n || 0 };
  }

  res.json({
    sales: sales.map((s) => shapeSale(s, canSeeCost(req.ctx))),
    page,
    pages: Math.max(1, Math.ceil(count / limit)),
    totals: {
      count,
      completed: agg?.completed || 0,
      voided: count - (agg?.completed || 0),
      revenue,
      discount: money(agg?.discount || 0),
      vat: money(agg?.vat || 0),
      refunds: refunds?.amount ?? null,
      refundCount: refunds?.count ?? null,
      // What the business actually kept — the figure the dashboard shows.
      net: refunds ? money(revenue - refunds.amount) : null,
    },
  });
});

// GET /api/sales/:id — one sale (receipt reprint, return submission)
salesRouter.get("/:id", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const sale = await Sale.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!sale) return res.status(404).json({ error: "not_found", message: "Sale not found." });
  res.json({ sale: shapeSale(sale, canSeeCost(req.ctx)) });
});

// GET /api/sales/:id/receipt — the receipt again (reprint, or send it to the customer on WhatsApp)
salesRouter.get("/:id/receipt", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const sale = await Sale.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!sale) return res.status(404).json({ error: "not_found", message: "Sale not found." });
  const customer = sale.customerId ? await Customer.findOne({ _id: sale.customerId, businessId: req.ctx.businessId }).select("phone whatsapp") : null;
  const phone = String(req.query.phone || "").trim().slice(0, 30) || customer?.whatsapp || customer?.phone || "";
  const receipt = buildReceipt({ business: req.ctx.business, plan: req.ctx.plan, sale, customerPhone: phone });
  const url = receiptUrl(req, sale._id);
  res.json({ receipt, url, whatsappUrl: waUrl(phone, receiptMessage(receipt, url)) });
});


salesRouter.post("/:id/void", requirePerm("void_sales"), async (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 3) return res.status(400).json({ error: "invalid", message: "Give a reason for voiding this sale." });

  const sale = await withTransaction(async (session) => {
    const sale = await Sale.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!sale) throw notFound("Sale not found.");
    if (sale.status === "voided") throw conflict("This sale is already voided.", "already_voided");
    if (sale.service?.kind) {
      throw conflict("This is a service payment — reverse it from the Academy, Appointments or Projects screen it belongs to.", "service_payment");
    }
    if (sale.channel === "invoice") {
      throw conflict("This sale is an invoice. Void it from Invoices, which also clears what the customer owes.", "invoice_sale");
    }
    // History from an uploaded file never moved stock, so voiding it (which puts stock back) would invent some.
    if (sale.channel === "import") {
      throw conflict("This sale came from an uploaded history file. To take it out, undo that upload from Import history.", "imported_sale");
    }
    if (sale.items.some((i) => i.returnedQty > 0)) {
      throw conflict("This sale has returns — void isn't possible.", "has_returns");
    }

    for (const line of sale.items) {
      if (line.components?.length) {
        // Made-to-order: the components come back, not the custom item.
        for (const c of line.components) {
          await applyMovement(req.ctx, {
            branchId: sale.branchId, productId: c.productId, productName: c.name,
            type: "VOID_RESTOCK", qty: c.qty, refType: "sale", refId: sale._id,
            reason: `Void ${sale.saleNo} (${line.name})`, session,
          });
        }
      } else {
        await applyMovement(req.ctx, {
          branchId: sale.branchId,
          productId: line.productId,
          productName: line.name,
          type: "VOID_RESTOCK",
          qty: line.qty,
          refType: "sale",
          refId: sale._id,
          reason: `Void ${sale.saleNo}`,
          session,
        });
      }
    }

    sale.status = "voided";
    sale.voidInfo = { by: req.ctx.userId, byName: req.ctx.actorName, reason, at: new Date() };
    await sale.save({ session });

    // A voided web sale means the order did not happen after all.
    if (sale.channel === "online" && sale.orderId) {
      await Order.updateOne(
        { _id: sale.orderId, status: { $nin: ["cancelled", "rejected"] } },
        { $set: { status: "cancelled", reason: `Sale ${sale.saleNo} was voided: ${reason}` }, $push: { history: { status: "cancelled", by: req.ctx.actorName, note: `Sale voided: ${reason}` } } },
        { session }
      );
    }

    if (sale.customerId) {
      const customer = await Customer.findById(sale.customerId).session(session);
      if (customer) {
        customer.totalSpend = money(Math.max(0, customer.totalSpend - sale.total));
        customer.visits = Math.max(0, customer.visits - 1);
        await customer.save({ session });
        // A credit sale that gets voided never happened — the customer
        // shouldn't be left owing money for it.
        const creditPaid = sale.payments.find((p) => p.method === "credit");
        if (creditPaid) {
          const { applyCreditChange } = await import("#modules/customers/customerLedger.model.js");
          await applyCreditChange(req.ctx, {
            customer, type: "adjustment", amount: -creditPaid.amount,
            refType: "void", refId: sale._id, note: `Void ${sale.saleNo}`, session,
          });
        }
      }
    }

    const totalCost = money(sale.items.reduce((s, l) => s + l.lineCost, 0));
    const payments = {};
    for (const p of sale.payments) payments[p.method] = (payments[p.method] || 0) - p.amount;
    await bumpDailyMetric(
      req.ctx,
      sale.branchId,
      localDay(sale.at),
      {
        revenue: -sale.total,
        cost: -totalCost,
        profit: -(sale.total - sale.vat - totalCost),
        txns: -1,
        discountTotal: -sale.discount,
        vatTotal: -sale.vat,
        payments,
      },
      session
    );

    return sale;
  });

  // Stock came back — anything that was flagged low may now be fine.
  afterStockChange(req.ctx, sale.branchId, sale.items.flatMap((l) =>
    l.components?.length ? l.components.map((c) => c.productId) : [l.productId]
  ));

  audit(req.ctx, "sale.void", { type: "sale", id: sale._id, label: sale.saleNo }, { total: sale.total }, { reason });
  res.json({ sale: shapeSale(sale, canSeeCost(req.ctx)) });
});
