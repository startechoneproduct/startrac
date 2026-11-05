import mongoose from "mongoose";
import { Product } from "#modules/products/product.model.js";
import { Serial } from "#modules/businesses/electronics/serial.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { nextSeq } from "#core/counters.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { withTransaction } from "#core/tx.js";
import { badRequest } from "#core/httpError.js";
import { hasCapability } from "#shared/businessTypes.js";
import { evaluateAndIssuePatronageCard } from "#modules/loyalty/loyaltyCard.service.js";
import { scopedToBranch, ownerBranchForNew } from "#core/branchScope.js";
import { customerRoom } from "#modules/customers/customerLimit.js";
import { changeStoreCredit } from "#modules/customers/storeCredit.js";

/**
 * The one place a sale is made: prices, totals, stock, customer tallies, loyalty
 * and daily metrics, all in one transaction. The till (sales.routes.js) and the
 * online store (storefront/orders.service.js) both come through here, so a sale
 * is a sale however it arrived.
 *
 * `ctx` is the tenant context. The till passes the signed-in staff member's;
 * the online store passes a synthetic one (see storefront/storeContext.js).
 *
 * opts (all optional, all used only by online orders):
 *   channel, orderId, orderNo  tag the sale with where it came from
 *   quotedPrices               Map<productId, price> the customer was shown
 *   deliveryFee                flat delivery charge added to the total
 *   vat                        VAT the customer was quoted (instead of recomputing it)
 *   customerAnyBranch          find the customer in any store (online customers belong to the business)
 *   onCreated(session, sale)   runs inside the transaction, after the sale exists
 */
export async function runCheckout(ctx, d, opts = {}) {
  const settings = ctx.business.settings;
  let newLoyaltyCard = null; // set inside the transaction below, emailed after commit

  const out = await withTransaction(async (session) => {
    // Idempotent replay: the offline queue can safely retry.
    if (d.clientSaleId) {
      const existing = await Sale.findOne({
        businessId: ctx.businessId,
        clientSaleId: d.clientSaleId,
      }).session(session);
      if (existing) return { replayed: true, sale: existing };
    }

    // A store can only ring up what it sells (its own items + shared ones).
    const products = await Product.find(scopedToBranch(ctx, {
      _id: { $in: [...new Set(d.items.map((i) => i.productId))] },
      businessId: ctx.businessId,
      status: "active",
    })).session(session);
    const byId = new Map(products.map((p) => [String(p._id), p]));
    for (const item of d.items) {
      if (!byId.has(item.productId)) throw badRequest("One of the products no longer exists.");
    }

    // Split: stock lines merge by product; made-to-order lines stay separate
    // (each carries its own dimensions and price).
    const qtyByProduct = new Map();
    const mtoItems = [];
    const serialsByProduct = new Map();
    for (const item of d.items) {
      const p = byId.get(item.productId);
      if (p.archetype === "made_to_order") mtoItems.push(item);
      else qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + item.qty);
      if (item.serialNos?.length) {
        const arr = serialsByProduct.get(item.productId) || [];
        serialsByProduct.set(item.productId, [...arr, ...item.serialNos]);
      }
    }

    // Server-side pricing and totals — stock lines.
    const lines = [...qtyByProduct.entries()].map(([productId, qty]) => {
      const p = byId.get(productId);
      const unit = opts.quotedPrices?.get(productId) ?? p.price;
      return {
        productId: p._id,
        name: p.name,
        qty,
        unitPrice: unit,
        lineCost: money(p.cost * qty),
        lineNet: money(unit * qty),
        returnedQty: 0,
        components: [],
      };
    });

    // Made-to-order lines: quantity of each component comes from the
    // business's own recipe (per m² / per m width / per m height / per item).
    if (mtoItems.length) {
      const compIds = new Set();
      for (const item of mtoItems) {
        for (const c of byId.get(item.productId).bom || []) compIds.add(String(c.productId));
      }
      const compProducts = await Product.find({ _id: { $in: [...compIds] }, businessId: ctx.businessId }).session(session);
      const compById = new Map(compProducts.map((p) => [String(p._id), p]));
      const round3 = (n) => Math.round(n * 1000) / 1000;

      for (const item of mtoItems) {
        const p = byId.get(item.productId);
        if (!p.bom?.length) {
          throw badRequest(`${p.name} has no components configured — set them up on the product first.`);
        }
        // Dimensions only matter to a recipe that actually scales by area or
        // a side (blinds, priced per m²). A plain "unit" recipe — a bowl of
        // jollof made from rice/chicken/tomato — needs none: default both to
        // 1 so the pricing formula below collapses to the item's own price.
        const needsDims = p.bom.some((c) => c.per !== "unit");
        if (needsDims && (!item.width || !item.height)) throw badRequest(`${p.name} needs width and height.`);
        const w = needsDims ? item.width : 1;
        const h = needsDims ? item.height : 1;
        const components = [];
        let lineCost = 0;
        for (const c of p.bom) {
          const comp = compById.get(String(c.productId));
          if (!comp) throw badRequest(`A component of ${p.name} no longer exists.`);
          const base =
            c.per === "sqm" ? w * h :
            c.per === "width" ? w :
            c.per === "height" ? h : 1;
          const qtyNeeded = round3(base * (c.factor || 1) * item.qty);
          if (qtyNeeded > 0) {
            components.push({ productId: comp._id, name: comp.name, qty: qtyNeeded });
            lineCost += (comp.cost || 0) * qtyNeeded;
          }
        }
        const unitPrice = item.price !== undefined ? money(item.price) : money(p.price * w * h);
        lines.push({
          productId: p._id,
          name: needsDims ? `${p.name} — ${w}m × ${h}m` : p.name,
          qty: item.qty,
          unitPrice,
          lineCost: money(lineCost),
          lineNet: money(unitPrice * item.qty),
          returnedQty: 0,
          ...(needsDims ? { width: w, height: h } : {}),
          components,
        });
      }
    }

    // Serial-tracked stock: validate any units the cashier picked BEFORE
    // anything moves — same "cheap failures first" ordering as the customer
    // resolution below. Optional: a line with no serialNos just sells normally.
    const serialUpdates = [];
    if (serialsByProduct.size) {
      for (const line of lines) {
        if (line.components.length) continue; // made-to-order lines don't carry serials
        const given = serialsByProduct.get(String(line.productId));
        if (!given?.length) continue;
        if (given.length !== line.qty) {
          throw badRequest(`${line.name}: chose ${given.length} serial number(s) for a quantity of ${line.qty}.`);
        }
        const found = await Serial.find({
          businessId: ctx.businessId, productId: line.productId, serialNo: { $in: given }, status: "in_stock",
        }).session(session);
        if (found.length !== given.length) {
          const foundNos = new Set(found.map((s) => s.serialNo));
          const missing = given.find((s) => !foundNos.has(s));
          throw badRequest(`${missing} isn't an available serial number for ${line.name}.`);
        }
        serialUpdates.push(...found);
      }
    }

    const subtotal = money(lines.reduce((s, l) => s + l.lineNet, 0));
    const discount = money(Math.min(d.discount, subtotal));
    const vat = opts.vat !== undefined ? money(opts.vat) : settings.vatEnabled ? money(((subtotal - discount) * settings.vatRate) / 100) : 0;
    // A flat delivery charge (online orders). Not taxed, not a discount base.
    const deliveryFee = money(opts.deliveryFee || 0);
    const total = money(subtotal - discount + vat + deliveryFee);

    // Split tender: one entry per method, and they must add up to the total.
    const methodsSeen = new Set();
    for (const p of d.payments) {
      if (methodsSeen.has(p.method)) throw badRequest(`${p.method} appears twice — combine it into one amount.`);
      methodsSeen.add(p.method);
    }
    const paid = money(d.payments.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(paid - total) > 0.01) {
      throw badRequest(`Payments (${paid}) don't add up to the total (${total}).`, "payment_mismatch");
    }

    // Change is only ever cash, and only against the cash portion.
    const cashDue = d.payments.find((p) => p.method === "cash")?.amount || 0;
    const tendered = d.tendered ? money(d.tendered) : 0;
    if (tendered && tendered < cashDue - 0.01) {
      throw badRequest(`Cash tendered (${tendered}) is less than the cash due (${cashDue}).`, "short_tender");
    }
    const change = tendered ? money(tendered - cashDue) : 0;

    const storeCreditPaid = money(d.payments.find((p) => p.method === "store_credit")?.amount || 0);

    // Resolve the customer before moving stock (cheap to fail early).
    let customer = null;
    let unsavedCustomerName = ""; // a name we couldn't add to the book (plan limit)
    if (d.customerId) {
      customer = await Customer.findOne(opts.customerAnyBranch ? { _id: d.customerId, businessId: ctx.businessId } : scopedToBranch(ctx, { _id: d.customerId, businessId: ctx.businessId })).session(session);
      if (!customer) throw badRequest("That customer doesn't exist.");
    } else if (d.customer?.name) {
      const known = d.customer.phone && (await Customer.findOne(scopedToBranch(ctx, { businessId: ctx.businessId, phone: d.customer.phone })).session(session));
      // A plan's customer limit never stops a sale: past it, the name still goes
      // on the receipt, it just isn't added to the customer book.
      const full = !known && (await customerRoom(ctx.businessId, ctx.plan, session)).remaining <= 0;
      if (full) unsavedCustomerName = d.customer.name;
      customer =
        known ||
        (full
          ? null
          : (
              await Customer.create(
                [{
                  accountId: ctx.accountId,
                  businessId: ctx.businessId,
                  branchId: await ownerBranchForNew(ctx),
                  name: d.customer.name,
                  phone: d.customer.phone,
                  whatsapp: d.customer.phone,
                }],
                { session }
              )
            )[0]);
    }

    if (storeCreditPaid > 0) {
      if (!customer?._id) throw badRequest("Store credit belongs to a customer. Attach the customer to this sale first.", "needs_customer");
      if ((customer.storeCredit || 0) + 0.001 < storeCreditPaid) {
        throw badRequest(`${customer.name} has ${money(customer.storeCredit || 0)} in store credit, less than ${storeCreditPaid}.`, "insufficient_credit");
      }
    }

    // Mint the sale id up front so every movement points at it from birth.
    const saleId = new mongoose.Types.ObjectId();

    // Flatten every deduction: stock lines move themselves; made-to-order
    // lines move their components instead (the blind itself has no stock).
    const deductions = [];
    for (const line of lines) {
      if (line.components.length) {
        for (const c of line.components) {
          deductions.push({ productId: c.productId, name: c.name, qty: c.qty, reason: `Used for ${line.name}` });
        }
      } else {
        deductions.push({ productId: line.productId, name: line.name, qty: line.qty, reason: "Sale" });
      }
    }

    // Inside a transaction an abort undoes every movement for us. Without
    // one (standalone MongoDB) we walk the applied movements back by hand.
    const moved = [];
    try {
      for (const ded of deductions) {
        await applyMovement(ctx, {
          branchId: ctx.branchId,
          productId: ded.productId,
          productName: ded.name,
          type: "OUT",
          qty: -ded.qty,
          refType: "sale",
          refId: saleId,
          reason: ded.reason,
          session,
        });
        moved.push(ded);
      }
    } catch (err) {
      if (!session) {
        for (const ded of moved.reverse()) {
          await applyMovement(ctx, {
            branchId: ctx.branchId, productId: ded.productId, productName: ded.name,
            type: "IN", qty: ded.qty, refType: "sale", reason: "Checkout rollback",
          }).catch((e) => console.error("checkout rollback failed:", ded.name, e.message));
        }
      }
      throw err;
    }

    const seq = await nextSeq(`sale:${ctx.branchId}`, session);
    const saleNo = `R-${String(seq).padStart(5, "0")}`;

    // A restaurant sale routes each line to the kitchen queue; every other
    // business type's items never get a prep status at all.
    const itemsOut = hasCapability(ctx.business.typeKey, "kitchenQueue")
      ? lines.map((l) => ({ ...l, prepStatus: "pending" }))
      : lines;

    const [sale] = await Sale.create(
      [{
        _id: saleId,
        accountId: ctx.accountId,
        businessId: ctx.businessId,
        branchId: ctx.branchId,
        saleNo,
        staffId: ctx.userId,
        staffName: ctx.actorName,
        customerId: customer?._id,
        customerName: customer?.name || unsavedCustomerName,
        ...(opts.channel ? { channel: opts.channel, orderId: opts.orderId, orderNo: opts.orderNo } : {}),
        deliveryFee,
        items: itemsOut,
        subtotal,
        discount,
        vat,
        total,
        payments: d.payments.map((p) => ({ method: p.method, amount: money(p.amount) })),
        tendered,
        change,
        clientSaleId: d.clientSaleId,
      }],
      { session }
    );

    // Paid (partly) with store credit: take it off the customer's credit in the
    // same transaction, so the sale and the credit used commit together.
    if (storeCreditPaid > 0) {
      await changeStoreCredit(ctx, customer._id, -storeCreditPaid, { refType: "sale", refId: sale._id, refNo: saleNo, session });
    }

    // Lets the caller commit its own change (e.g. mark an online order
    // confirmed) in the SAME transaction as the sale — both happen or neither.
    if (opts.onCreated) await opts.onCreated(session, sale);

    if (customer) {
      customer.totalSpend = money(customer.totalSpend + total);
      customer.visits += 1;
      customer.lastSeen = new Date();
      customer.lastBranchId = ctx.branchId;
      // Loyalty tokens (water): only sachet/bag lines earn them, per the
      // trade's own rule — bottles and everything else are sold, just not
      // counted toward a free pack.
      if (hasCapability(ctx.business.typeKey, "loyalty")) {
        const sachetBagQty = lines
          .filter((l) => /sachet|bag/i.test(l.name))
          .reduce((s, l) => s + l.qty, 0);
        if (sachetBagQty > 0) customer.sachetBagQty = (customer.sachetBagQty || 0) + sachetBagQty;
      }
      await customer.save({ session });

      // Loyalty QR cards (any business — see settings.loyaltyRule). DB
      // reads/writes only here, safe inside the transaction; the email
      // goes out after commit, below. "Missing modules list" means
      // everything is on, same convention as hasModule() client-side —
      // but loyaltyRule.mode defaults to "off", so nothing actually
      // fires until an owner explicitly configures a rule in Settings.
      const modules = ctx.business.settings?.modules;
      if (!modules || modules.includes("loyaltyCard")) {
        newLoyaltyCard = await evaluateAndIssuePatronageCard(ctx, customer, ctx.business, session);
      }
    }

    for (const serial of serialUpdates) {
      serial.status = "sold";
      serial.saleId = saleId;
      serial.customerId = customer?._id || null;
      serial.customerName = customer?.name || "";
      serial.soldAt = new Date();
      const warrantyMonths = byId.get(String(serial.productId))?.warrantyMonths || 0;
      if (warrantyMonths > 0) {
        const expires = new Date(serial.soldAt);
        expires.setMonth(expires.getMonth() + warrantyMonths);
        serial.warrantyExpiresAt = expires;
      }
      await serial.save({ session });
    }

    const totalCost = money(lines.reduce((s, l) => s + l.lineCost, 0));
    const payments = {};
    for (const p of d.payments) payments[p.method] = (payments[p.method] || 0) + p.amount;
    await bumpDailyMetric(
      ctx,
      ctx.branchId,
      localDay(),
      {
        revenue: total,
        cost: totalCost,
        profit: total - vat - totalCost,
        txns: 1,
        discountTotal: discount,
        vatTotal: vat,
        payments,
      },
      session
    );

    return {
      sale, customer, lines, subtotal, discount, vat, deliveryFee, total, saleNo, tendered, change,
      deductedIds: deductions.map((d) => d.productId),
    };
  });

  return { out, newLoyaltyCard };
}
