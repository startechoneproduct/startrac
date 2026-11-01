import { Router } from "express";
import { z } from "zod";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Supplier } from "#modules/suppliers/supplier.model.js";
import { ColdRoomBatch } from "#modules/businesses/coldroom/batch.model.js";
import { ColdRoomBreakdown } from "#modules/businesses/coldroom/breakdown.model.js";
import {
  poolsFromBatches, syncCartonEquivalentStock, openBatchesFifo, maybeCloseBatch,
  costPerKgOfBatch, costPerPieceOfBatch, shapeBatch, shapeBreakdown,
} from "#modules/businesses/coldroom/coldroom.service.js";
import { applyCreditChange } from "#modules/customers/customerLedger.model.js";
import { requirePerm, requireBranch } from "#core/middleware/tenant.js";

import { nextSeq } from "#core/counters.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { badRequest, conflict, notFound } from "#core/httpError.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";
import { hasCapability } from "#shared/businessTypes.js";

export const coldroomRouter = Router();

const readPerm = requirePerm("stock", "sales", "dashboard_ops");

// ── The stock picture: every product's sealed/loose/piece pools ────────

// GET /api/coldroom/stock — one row per stock product, whether or not it has
// ever had a batch — an empty row is exactly the prompt to record a purchase.
coldroomRouter.get("/stock", readPerm, requireBranch, async (req, res) => {
  const products = await Product.find({ businessId: req.ctx.businessId, status: "active", archetype: "stock" }).sort({ name: 1 });
  const batches = await ColdRoomBatch.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId, status: "open" }).sort({ purchaseDate: 1 });
  const byProduct = new Map();
  for (const b of batches) {
    const key = String(b.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(b);
  }
  res.json({
    products: products.map((p) => {
      const list = byProduct.get(String(p._id)) || [];
      const pools = poolsFromBatches(list);
      const oldest = list[0];
      return {
        productId: p._id,
        name: p.name,
        category: p.category,
        openBatches: list.length,
        oldestBatchDate: oldest?.purchaseDate || null,
        ...pools,
      };
    }),
  });
});

// GET /api/coldroom/summary — the page header's stat tiles.
coldroomRouter.get("/summary", readPerm, requireBranch, async (req, res) => {
  const batches = await ColdRoomBatch.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId, status: "open" });
  const pools = poolsFromBatches(batches);
  const productsInStock = new Set(batches.filter((b) => b.remainingCartons > 0 || b.remainingKg > 0 || b.remainingPieces > 0).map((b) => String(b.productId))).size;

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const breakdowns = await ColdRoomBreakdown.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId, at: { $gte: since } });
  const totalExpected = breakdowns.reduce((s, b) => s + b.expectedYieldKg, 0);
  const totalVariance = breakdowns.reduce((s, b) => s + b.varianceKg, 0);
  const avgShrinkagePercent = totalExpected > 0 ? money((totalVariance / totalExpected) * 100) : 0;

  let totalOutstanding = 0, debtorCount = 0;
  if (hasCapability(req.ctx.business.typeKey, "credit")) {
    const [agg] = await Customer.aggregate([
      { $match: { businessId: req.ctx.businessId, creditBalance: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$creditBalance" }, count: { $sum: 1 } } },
    ]);
    totalOutstanding = money(agg?.total || 0);
    debtorCount = agg?.count || 0;
  }

  res.json({
    stockValue: pools.stockValue,
    sealedCartons: pools.sealedCartons,
    looseKg: pools.looseKg,
    productsInStock,
    avgShrinkagePercent,
    breakdownCount: breakdowns.length,
    totalOutstanding,
    debtorCount,
  });
});

// ── Batches ──────────────────────────────────────────────────────────

// GET /api/coldroom/batches?productId=&status=
coldroomRouter.get("/batches", readPerm, requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (req.query.productId) filter.productId = req.query.productId;
  if (req.query.status === "open" || req.query.status === "closed") filter.status = req.query.status;
  const batches = await ColdRoomBatch.find(filter).sort({ purchaseDate: -1 }).limit(200);
  res.json({ batches: batches.map(shapeBatch) });
});

const purchaseSchema = z.object({
  productId: z.string(),
  supplierId: z.string().optional(),
  purchaseDate: z.string().optional(),
  cartonsReceived: z.number().positive("Enter how many cartons arrived"),
  packSizeKg: z.number().positive("Enter this lot's declared weight per carton"),
  unitCostPerCarton: z.number().min(0),
  actualWeighedKg: z.number().min(0).optional(),
  notes: z.string().default(""),
});

// POST /api/coldroom/batches — receive a delivery. Carton size and cost are
// captured HERE, on the lot, never assumed from the product (see batch.model.js).
coldroomRouter.post("/batches", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const product = await Product.findOne({ _id: d.productId, businessId: req.ctx.businessId, status: "active" });
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });

  let supplier = null;
  if (d.supplierId) {
    supplier = await Supplier.findOne({ _id: d.supplierId, businessId: req.ctx.businessId });
    if (!supplier) return res.status(400).json({ error: "invalid", message: "That supplier doesn't exist." });
  }

  const batch = await ColdRoomBatch.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
    productId: product._id, productName: product.name,
    supplierId: supplier?._id, supplierName: supplier?.name || "",
    purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : new Date(),
    cartonsReceived: d.cartonsReceived, packSizeKg: d.packSizeKg, unitCostPerCarton: money(d.unitCostPerCarton),
    actualWeighedKg: d.actualWeighedKg,
    remainingCartons: d.cartonsReceived, remainingKg: 0, remainingPieces: 0,
    notes: d.notes,
  });

  // A delivery with a named cost rolls the product's own weighted-average
  // cost-per-carton forward, same principle as an ordinary stock-in.
  const inv = await Inventory.findOne({ branchId: req.ctx.branchId, productId: product._id });
  const priorStock = inv?.stock ?? 0;
  product.cost = priorStock + d.cartonsReceived > 0
    ? money(((priorStock * (product.cost || 0)) + (d.cartonsReceived * d.unitCostPerCarton)) / (priorStock + d.cartonsReceived))
    : money(d.unitCostPerCarton);
  await product.save();

  const stock = await syncCartonEquivalentStock(req.ctx, req.ctx.branchId, product, {
    refType: "coldroom_purchase", refId: batch._id,
    reason: `Purchase — ${d.cartonsReceived} carton(s)${supplier ? ` from ${supplier.name}` : ""}`,
    unitCost: d.unitCostPerCarton, supplierId: supplier?._id, supplierName: supplier?.name,
  });

  afterStockChange(req.ctx, req.ctx.branchId, [product._id]);
  audit(req.ctx, "coldroom.batch.purchase", { type: "batch", id: batch._id, label: product.name }, undefined, {
    cartons: d.cartonsReceived, packSizeKg: d.packSizeKg, unitCostPerCarton: d.unitCostPerCarton,
  });
  res.status(201).json({ batch: shapeBatch(batch), stock, cost: product.cost });
});

const breakdownInput = z.object({
  cartonsOpened: z.number().positive("Enter how many cartons were opened"),
  actualWeighedKg: z.number().min(0, "Enter what the scale said"),
  resultingPieceCount: z.number().int().positive().optional(),
  note: z.string().default(""),
});

// POST /api/coldroom/batches/:id/breakdown — open cartons, weigh what came
// out. The gap between expected and actual is logged as shrinkage automatically.
coldroomRouter.post("/batches/:id/breakdown", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = breakdownInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const batch = await ColdRoomBatch.findOne({ _id: req.params.id, businessId: req.ctx.businessId, branchId: req.ctx.branchId });
  if (!batch) return res.status(404).json({ error: "not_found", message: "Batch not found." });
  if (batch.status !== "open") return res.status(409).json({ error: "closed", message: "This batch is closed." });
  if (d.cartonsOpened > batch.remainingCartons + 0.0001) {
    return res.status(400).json({ error: "invalid", message: `Only ${batch.remainingCartons} sealed carton(s) left in this batch.` });
  }

  const expectedYieldKg = money(d.cartonsOpened * batch.packSizeKg);
  const varianceKg = money(expectedYieldKg - d.actualWeighedKg);
  const variancePercent = expectedYieldKg > 0 ? money((varianceKg / expectedYieldKg) * 100) : 0;

  batch.remainingCartons = money(batch.remainingCartons - d.cartonsOpened);
  // The weighed-out kg becomes exactly one downstream pool, never both — cut
  // into pieces XOR kept loose by weight. An operator who wants some of a
  // carton sold by kg and some by piece runs two smaller breakdowns instead;
  // crediting both pools from the same weighed kg would count the same fish
  // twice in every stock-value and sale figure downstream.
  if (d.resultingPieceCount) {
    batch.remainingPieces += d.resultingPieceCount;
    batch.avgPieceWeightKg = money(d.actualWeighedKg / d.resultingPieceCount);
  } else {
    batch.remainingKg = money(batch.remainingKg + d.actualWeighedKg);
  }
  maybeCloseBatch(batch);
  await batch.save();

  const breakdown = await ColdRoomBreakdown.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
    batchId: batch._id, productId: batch.productId, productName: batch.productName,
    cartonsOpened: d.cartonsOpened, expectedYieldKg, actualWeighedKg: d.actualWeighedKg,
    varianceKg, variancePercent, resultingPieceCount: d.resultingPieceCount,
    byName: req.ctx.actorName, note: d.note,
  });

  const product = await Product.findById(batch.productId);
  const stock = await syncCartonEquivalentStock(req.ctx, req.ctx.branchId, product, {
    refType: "coldroom_breakdown", refId: breakdown._id,
    reason: varianceKg > 0
      ? `Shrinkage on breakdown — ${varianceKg}kg of ${expectedYieldKg}kg expected (${variancePercent}%)`
      : `Opened ${d.cartonsOpened} carton(s)`,
    wasteReasonIfLoss: "shrinkage",
  });
  if (varianceKg > 0) {
    const costValue = money((varianceKg / batch.packSizeKg) * batch.unitCostPerCarton);
    if (costValue > 0) await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(), { profit: -costValue, wasteTotal: costValue });
  }

  afterStockChange(req.ctx, req.ctx.branchId, [batch.productId]);
  audit(req.ctx, "coldroom.breakdown", { type: "batch", id: batch._id, label: batch.productName }, undefined, {
    cartonsOpened: d.cartonsOpened, varianceKg, variancePercent,
  });
  res.status(201).json({ batch: shapeBatch(batch), breakdown: shapeBreakdown(breakdown), stock });
});

const lossSchema = z.object({
  cartons: z.number().min(0).default(0),
  kg: z.number().min(0).default(0),
  pieces: z.number().int().min(0).default(0),
  note: z.string().default(""),
});

// POST /api/coldroom/batches/:id/cold-chain-loss — a single batch caught by
// a power/generator failure. Distinct from /breakdown's routine shrinkage:
// this is the sudden, whole-batch-capable loss the trade lives in fear of.
coldroomRouter.post("/batches/:id/cold-chain-loss", requirePerm("stock"), requireBranch, async (req, res) => {
  const parsed = lossSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;
  if (d.cartons <= 0 && d.kg <= 0 && d.pieces <= 0) {
    return res.status(400).json({ error: "invalid", message: "Enter how much was lost." });
  }

  const batch = await ColdRoomBatch.findOne({ _id: req.params.id, businessId: req.ctx.businessId, branchId: req.ctx.branchId });
  if (!batch) return res.status(404).json({ error: "not_found", message: "Batch not found." });
  if (d.cartons > batch.remainingCartons + 0.0001 || d.kg > batch.remainingKg + 0.0001 || d.pieces > batch.remainingPieces) {
    return res.status(400).json({ error: "invalid", message: "That's more than this batch has left." });
  }

  const costPerKg = costPerKgOfBatch(batch);
  const costPerPiece = costPerPieceOfBatch(batch);
  const valueLost = money(d.cartons * batch.unitCostPerCarton + d.kg * costPerKg + d.pieces * costPerPiece);

  batch.remainingCartons = money(batch.remainingCartons - d.cartons);
  batch.remainingKg = money(batch.remainingKg - d.kg);
  batch.remainingPieces -= d.pieces;
  maybeCloseBatch(batch);
  await batch.save();

  const product = await Product.findById(batch.productId);
  const stock = await syncCartonEquivalentStock(req.ctx, req.ctx.branchId, product, {
    refType: "coldroom_cold_chain_loss", refId: batch._id,
    reason: d.note || "Cold-chain failure", wasteReasonIfLoss: "cold_chain_failure",
  });
  if (valueLost > 0) await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(), { profit: -valueLost, wasteTotal: valueLost });

  afterStockChange(req.ctx, req.ctx.branchId, [batch.productId]);
  audit(req.ctx, "coldroom.cold_chain_loss", { type: "batch", id: batch._id, label: batch.productName }, undefined, { ...d, valueLost });
  res.status(201).json({ batch: shapeBatch(batch), stock, valueLost });
});

// POST /api/coldroom/cold-chain-loss — the whole room, at once: every open
// batch on this branch, zeroed out in one call. What a real generator
// failure actually does — it doesn't pick and choose which carton to spoil.
coldroomRouter.post("/cold-chain-loss", requirePerm("stock"), requireBranch, async (req, res) => {
  const note = String(req.body?.note || "").trim() || "Cold-chain failure — whole room";
  const batches = await ColdRoomBatch.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId, status: "open" });

  let totalValueLost = 0;
  const affectedProducts = new Map();
  for (const batch of batches) {
    const costPerKg = costPerKgOfBatch(batch);
    const costPerPiece = costPerPieceOfBatch(batch);
    const valueLost = money(batch.remainingCartons * batch.unitCostPerCarton + batch.remainingKg * costPerKg + batch.remainingPieces * costPerPiece);
    if (valueLost <= 0 && batch.remainingCartons <= 0 && batch.remainingKg <= 0 && batch.remainingPieces <= 0) continue;

    batch.remainingCartons = 0; batch.remainingKg = 0; batch.remainingPieces = 0;
    batch.status = "closed";
    await batch.save();
    totalValueLost = money(totalValueLost + valueLost);
    affectedProducts.set(String(batch.productId), batch.productName);
  }

  let productsClosed = 0;
  for (const [productId] of affectedProducts) {
    const product = await Product.findById(productId);
    if (!product) continue;
    await syncCartonEquivalentStock(req.ctx, req.ctx.branchId, product, {
      refType: "coldroom_cold_chain_loss", reason: note, wasteReasonIfLoss: "cold_chain_failure",
    });
    productsClosed++;
  }
  if (totalValueLost > 0) await bumpDailyMetric(req.ctx, req.ctx.branchId, localDay(), { profit: -totalValueLost, wasteTotal: totalValueLost });
  if (affectedProducts.size) afterStockChange(req.ctx, req.ctx.branchId, [...affectedProducts.keys()]);

  audit(req.ctx, "coldroom.cold_chain_loss.branch", { type: "branch", id: req.ctx.branchId, label: "Whole cold room" }, undefined, {
    productsAffected: productsClosed, valueLost: totalValueLost, note,
  });
  res.status(201).json({ productsAffected: productsClosed, valueLost: totalValueLost });
});

// ── Retail sale: carton, fraction-of-carton, kg, or piece ───────────────

const saleInput = z
  .object({
    productId: z.string(),
    saleType: z.enum(["carton", "kg", "piece"]),
    // "Fraction of a carton" is just saleType "carton" with qty < 1 (0.5, 0.25…).
    qty: z.number().positive(),
    unitPrice: z.number().min(0),
    paymentMethod: z.enum(["cash", "pos", "transfer", "credit"]).default("cash"),
    customerId: z.string().optional(),
    customer: z.object({ name: z.string().min(1), phone: z.string().default("") }).optional(),
    discount: z.number().min(0).default(0),
  })
  // Pieces are counted, not weighed — "2.5 pieces" isn't a real sale.
  .refine((d) => d.saleType !== "piece" || Number.isInteger(d.qty), {
    message: "Pieces must be a whole number.",
    path: ["qty"],
  });

coldroomRouter.post("/sales", requirePerm("sales"), requireBranch, async (req, res) => {
  const parsed = saleInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  if (d.paymentMethod === "credit") {
    if (!hasCapability(req.ctx.business.typeKey, "credit")) {
      return res.status(400).json({ error: "invalid", message: "Credit sales aren't available for this business." });
    }
    if (!d.customerId && !d.customer?.name) {
      return res.status(400).json({ error: "invalid", message: "A credit sale needs a customer to owe the balance." });
    }
  }

  const out = await withTransaction(async (session) => {
    const product = await Product.findOne({ _id: d.productId, businessId: req.ctx.businessId, status: "active" }).session(session);
    if (!product) throw notFound("Product not found.");

    const batches = await openBatchesFifo(req.ctx.businessId, req.ctx.branchId, product._id, session);

    // FIFO-consume the one pool this sale type draws from, oldest lot first.
    let remainingNeeded = d.qty;
    const consumed = [];
    for (const batch of batches) {
      if (remainingNeeded <= 0.0001) break;
      const available = d.saleType === "carton" ? batch.remainingCartons : d.saleType === "kg" ? batch.remainingKg : batch.remainingPieces;
      if (available <= 0) continue;
      const take = Math.min(available, remainingNeeded);
      consumed.push({ batch, take });
      remainingNeeded = money(remainingNeeded - take);
    }
    if (remainingNeeded > 0.0001) {
      const have = money(d.qty - remainingNeeded);
      if (d.saleType !== "carton") {
        const unitWord = d.saleType === "kg" ? "kg" : have === 1 ? "piece" : "pieces";
        throw conflict(
          `Only ${have} loose ${unitWord} of ${product.name} on hand — open a carton first.`,
          "insufficient_loose_stock"
        );
      }
      throw conflict(`Only ${have} sealed carton(s) of ${product.name} on hand.`, "insufficient_stock");
    }

    let lineCost = 0;
    for (const { batch, take } of consumed) {
      if (d.saleType === "carton") {
        batch.remainingCartons = money(batch.remainingCartons - take);
        lineCost += take * batch.unitCostPerCarton;
      } else if (d.saleType === "kg") {
        batch.remainingKg = money(batch.remainingKg - take);
        lineCost += take * costPerKgOfBatch(batch);
      } else {
        batch.remainingPieces -= take;
        lineCost += take * costPerPieceOfBatch(batch);
      }
      maybeCloseBatch(batch);
      await batch.save({ session });
    }
    lineCost = money(lineCost);

    const unitLabel = d.saleType;
    const qtyLabel = d.qty % 1 === 0 ? String(d.qty) : d.qty.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const lineName = `${product.name} — ${qtyLabel} ${unitLabel}${d.qty === 1 ? "" : "s"}`;

    const lineNet = money(d.unitPrice * d.qty);
    const discount = money(Math.min(d.discount, lineNet));
    const settings = req.ctx.business.settings;
    const vat = settings.vatEnabled ? money(((lineNet - discount) * settings.vatRate) / 100) : 0;
    const total = money(lineNet - discount + vat);

    let customer = null;
    if (d.customerId) {
      customer = await Customer.findOne({ _id: d.customerId, businessId: req.ctx.businessId }).session(session);
      if (!customer) throw badRequest("That customer doesn't exist.");
    } else if (d.customer?.name) {
      customer =
        (d.customer.phone && (await Customer.findOne({ businessId: req.ctx.businessId, phone: d.customer.phone }).session(session))) ||
        (
          await Customer.create(
            [{ accountId: req.ctx.accountId, businessId: req.ctx.businessId, name: d.customer.name, phone: d.customer.phone, whatsapp: d.customer.phone }],
            { session }
          )
        )[0];
    }

    // Mirror the sale onto the generic ledger, exactly like a normal
    // checkout would — Products/Dashboard/low-stock alerts never need to
    // know a sale here was measured in kg instead of a plain unit count.
    await syncCartonEquivalentStock(req.ctx, req.ctx.branchId, product, { refType: "sale", reason: lineName, session });

    const seq = await nextSeq(`sale:${req.ctx.branchId}`, session);
    const saleNo = `R-${String(seq).padStart(5, "0")}`;
    const [sale] = await Sale.create(
      [{
        accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
        saleNo, staffId: req.ctx.userId, staffName: req.ctx.actorName,
        customerId: customer?._id, customerName: customer?.name || "",
        items: [{ productId: product._id, name: lineName, qty: d.qty, unitPrice: d.unitPrice, lineCost, lineNet, returnedQty: 0 }],
        subtotal: lineNet, discount, vat, total,
        payments: [{ method: d.paymentMethod, amount: total }],
      }],
      { session }
    );

    if (customer) {
      customer.totalSpend = money(customer.totalSpend + total);
      customer.visits += 1;
      customer.lastSeen = new Date();
      customer.lastBranchId = req.ctx.branchId;
      await customer.save({ session });
      if (d.paymentMethod === "credit") {
        await applyCreditChange(req.ctx, {
          customer, type: "sale", amount: total, refType: "coldroom_sale", refId: sale._id, note: `Sale ${saleNo}`, session,
        });
      }
    }

    // Revenue is recognised now regardless of how it was paid; the till's
    // payment split only ever reflects money that actually moved today —
    // a credit sale contributes neither now (it's collected later, see
    // customers.routes.js's /ledger/payments).
    await bumpDailyMetric(
      req.ctx, req.ctx.branchId, localDay(),
      {
        revenue: total, cost: lineCost, profit: money(total - vat - lineCost), txns: 1,
        discountTotal: discount, vatTotal: vat,
        payments: d.paymentMethod === "credit" ? {} : { [d.paymentMethod]: total },
      },
      session
    );

    return { sale, saleNo, product, total, lineNet, discount, vat, lineCost, lineName };
  });

  afterStockChange(req.ctx, req.ctx.branchId, [out.product._id]);
  audit(req.ctx, "coldroom.sale", { type: "sale", id: out.sale._id, label: out.saleNo }, undefined, {
    product: out.product.name, saleType: d.saleType, qty: d.qty, total: out.total, paymentMethod: d.paymentMethod,
  });
  res.status(201).json({
    saleNo: out.saleNo,
    sale: { id: out.sale._id, saleNo: out.saleNo, name: out.lineName, total: out.total },
  });
});
