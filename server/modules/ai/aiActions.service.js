import crypto from "node:crypto";
import { Customer } from "#modules/customers/customer.model.js";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Return } from "#modules/returns/return.model.js";
import { Expense } from "#modules/expenses/expense.model.js";
import { User } from "#modules/auth/user.model.js";
import { Membership } from "#modules/auth/membership.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { hashPassword } from "#modules/auth/auth.service.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { nextSeq } from "#core/counters.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { withTransaction } from "#core/tx.js";
import { afterStockChange, raiseReturnPending } from "#modules/alerts/alerts.service.js";
import { badRequest, notFound } from "#core/httpError.js";
import { executeImport } from "#modules/imports/catalogTargets.js";
import { archiveProducts, archivableFilter } from "#modules/products/archive.service.js";
import { scopedToBranch } from "#core/branchScope.js";
import { escapeRegex } from "#core/regex.js";

/**
 * Seven actions the AI can propose, deliberately narrower than full feature
 * parity with their real screens:
 *   - create_customer, adjust_stock, create_staff, record_expense: match
 *     their real routes in full (customers.routes.js POST /,
 *     inventory.routes.js POST /adjust, staff.routes.js POST /,
 *     expenses.routes.js POST /).
 *   - create_product: core catalog fields only (name/category/price/cost/
 *     reorderLevel/openingStock/barcode) — made-to-order recipes, serial
 *     tracking and unit conversions stay a manual Products-page action.
 *   - record_sale: a SIMPLE sale — existing stock items only (no made-to-
 *     order, no serial capture), one payment method covering the full
 *     total. The real checkout (sales.routes.js) has meaningfully more
 *     nuance than that; this covers the common case, not every one.
 *   - process_return: the real proportional discount/VAT math, but always
 *     goes to "pending" for a human to approve/reject exactly like a
 *     return submitted from the till — this action just files it.
 *
 * Every one of these requires the SAME domain permission a human doing it
 * from the UI would need, checked again at approval time (see ai.routes.js)
 * — proposing something is not a permission bypass.
 */
export const ACTION_PERM = {
  create_customer: "customers",
  create_product: "products_add",
  adjust_stock: "stock_adjust",
  record_sale: "sales",
  process_return: "returns",
  create_staff: "staff_mgmt",
  record_expense: "expenses",
  archive_products: "products_delete", // deleting from the catalog needs the same right as the Delete button
  import_catalog: "products_add", // creating catalog entries needs the same right as adding them by hand
};

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_customer",
      description: "Propose creating a new customer record.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer's full name" },
          phone: { type: "string", description: "Phone/WhatsApp number, optional" },
          notes: { type: "string", description: "Any note about this customer, optional" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_product",
      description: "Propose adding a new product to the catalog.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string", description: "Optional — a category already in this catalog if possible" },
          price: { type: "number", description: "Selling price" },
          cost: { type: "number", description: "Cost price, optional, defaults to 0" },
          reorderLevel: { type: "number", description: "Stock level that should trigger a reorder alert, optional" },
          openingStock: { type: "number", description: "Starting stock quantity, optional, defaults to 0" },
          barcode: { type: "string", description: "Optional" },
        },
        required: ["name", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "adjust_stock",
      description: "Propose correcting a product's stock count to a new number (recount, shrinkage, damage, etc.).",
      parameters: {
        type: "object",
        properties: {
          productName: { type: "string", description: "Must match an existing product's name" },
          newQty: { type: "number", description: "The corrected stock count" },
          reason: { type: "string", description: "Why the count is being corrected" },
        },
        required: ["productName", "newQty", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_sale",
      description: "Propose recording a simple sale of existing catalog items (not made-to-order, no serial numbers) paid in full by one method.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { productName: { type: "string" }, qty: { type: "number" } },
              required: ["productName", "qty"],
            },
          },
          customerName: { type: "string", description: "Optional — an existing customer's name to attach the sale to" },
          paymentMethod: { type: "string", enum: ["cash", "pos", "transfer"], description: "Defaults to cash" },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_return",
      description: "Propose filing a return against a past sale, by its receipt number. This only FILES the return for approval — it never approves itself, same as a return submitted from the till.",
      parameters: {
        type: "object",
        properties: {
          saleNo: { type: "string", description: "The receipt number, e.g. R-00123" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { productName: { type: "string" }, qty: { type: "number" } },
              required: ["productName", "qty"],
            },
          },
          reason: { type: "string" },
          refundMethod: { type: "string", enum: ["cash", "pos", "transfer"], description: "Defaults to cash" },
        },
        required: ["saleNo", "items", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_staff",
      description: "Propose creating a new staff account with a till PIN. Highest-risk action — grants real system access.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["admin", "manager", "staff"] },
          pin: { type: "string", description: "Exactly 4-digit till PIN" },
          branchName: { type: "string", description: "Required for manager/staff roles — must match an existing branch" },
          email: { type: "string", description: "Optional — for account-based login instead of till-only" },
        },
        required: ["name", "role", "pin"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_products",
      description: "Propose deleting products from the catalog (they are archived, so past sales and reports keep their figures). Use for 'delete/remove X', 'delete everything in category Y' or 'delete all products'. Nothing is removed until the owner approves.",
      parameters: {
        type: "object",
        properties: {
          productNames: { type: "array", items: { type: "string" }, description: "Exact names of existing products to delete" },
          category: { type: "string", description: "Delete every product in this category" },
          all: { type: "boolean", description: "true ONLY when the person clearly asked to delete ALL products" },
          reason: { type: "string", description: "Why, if they said" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_expense",
      description: "Propose logging a business expense (rent, fuel, salaries, etc.).",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Kind of expense, e.g. Rent, Fuel, Salaries" },
          amount: { type: "number", description: "Amount spent" },
          notes: { type: "string", description: "Optional detail" },
          paidBy: { type: "string", description: "Optional — who paid it" },
        },
        required: ["type", "amount"],
      },
    },
  },
];

// ── Resolve: turn the model's name-based arguments into concrete,
// validated, ID-based payloads — done once at proposal time so approval
// later is deterministic and never has to re-interpret free text. ──────

async function findProductByName(businessId, name) {
  const escaped = escapeRegex(name);
  return Product.findOne({ businessId, status: "active", name: { $regex: `^${escaped}$`, $options: "i" } });
}

export async function resolveAction(ctx, name, args) {
  switch (name) {
    case "create_customer": {
      if (!args.name?.trim()) throw badRequest("A customer needs a name.");
      return { name: args.name.trim(), phone: args.phone || "", notes: args.notes || "" };
    }

    case "create_product": {
      if (!args.name?.trim()) throw badRequest("A product needs a name.");
      const price = Number(args.price);
      if (!Number.isFinite(price) || price < 0) throw badRequest("Give a valid price.");
      return {
        name: args.name.trim(),
        category: args.category?.trim() || "General",
        price: money(price),
        cost: Number.isFinite(Number(args.cost)) ? money(Number(args.cost)) : 0,
        reorderLevel: Number.isFinite(Number(args.reorderLevel)) ? Number(args.reorderLevel) : 5,
        openingStock: Number.isFinite(Number(args.openingStock)) ? Math.max(0, Math.round(Number(args.openingStock))) : 0,
        barcode: args.barcode || "",
      };
    }

    case "adjust_stock": {
      if (!ctx.branchId) throw badRequest("Select a branch first.");
      const product = await findProductByName(ctx.businessId, args.productName || "");
      if (!product) throw notFound(`No product called "${args.productName}".`);
      const newQty = Number(args.newQty);
      if (!Number.isFinite(newQty) || newQty < 0) throw badRequest("Give a valid stock count.");
      if (!args.reason?.trim()) throw badRequest("Give a reason for the adjustment.");
      return { productId: String(product._id), productName: product.name, newQty: Math.round(newQty), reason: args.reason.trim() };
    }

    case "record_sale": {
      if (!ctx.branchId) throw badRequest("Select a branch first.");
      if (!args.items?.length) throw badRequest("A sale needs at least one item.");
      const items = [];
      for (const item of args.items) {
        const product = await findProductByName(ctx.businessId, item.productName || "");
        if (!product) throw notFound(`No product called "${item.productName}".`);
        const qty = Math.round(Number(item.qty));
        if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`Give a valid quantity for ${product.name}.`);
        items.push({ productId: String(product._id), productName: product.name, unitPrice: product.price, cost: product.cost || 0, qty });
      }
      let customerName = "";
      if (args.customerName?.trim()) {
        const customer = await Customer.findOne({ businessId: ctx.businessId, name: { $regex: `^${escapeRegex(args.customerName)}$`, $options: "i" } });
        if (!customer) throw notFound(`No customer called "${args.customerName}" — leave it out to sell as a walk-in, or propose creating them first.`);
        customerName = customer.name;
      }
      const method = ["cash", "pos", "transfer"].includes(args.paymentMethod) ? args.paymentMethod : "cash";
      return { items, customerName, paymentMethod: method };
    }

    case "archive_products": {
      const esc = escapeRegex;
      let found = [];
      if (args.all === true) {
        found = await Product.find(archivableFilter(ctx)).select("name");
      } else if (args.category?.trim()) {
        found = await Product.find(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", category: { $regex: `^${esc(args.category)}$`, $options: "i" } })).select("name");
        if (!found.length) throw notFound(`No products in a category called "${args.category}".`);
      } else if (Array.isArray(args.productNames) && args.productNames.length) {
        const missing = [];
        for (const n of args.productNames.slice(0, 200)) {
          const p = await Product.findOne(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active", name: { $regex: `^${esc(n)}$`, $options: "i" } })).select("name");
          if (p) found.push(p); else missing.push(n);
        }
        if (missing.length) throw notFound(`No product called ${missing.map((m) => `"${m}"`).join(", ")}.`);
      } else {
        throw badRequest("Say which products to delete: names, a category, or all of them.");
      }
      if (!found.length) throw badRequest("There are no products to delete.");
      const unique = [...new Map(found.map((p) => [String(p._id), p])).values()];
      return {
        productIds: unique.map((p) => String(p._id)),
        count: unique.length,
        names: unique.slice(0, 12).map((p) => p.name),
        scope: args.all === true ? "all" : args.category?.trim() ? "category" : "some",
        category: args.category?.trim() || "",
        reason: args.reason?.trim() || "",
      };
    }

    case "process_return": {
      if (!ctx.branchId) throw badRequest("Select a branch first.");
      const sale = await Sale.findOne({ businessId: ctx.businessId, saleNo: String(args.saleNo || "").trim() });
      if (!sale) throw notFound(`No sale with receipt number "${args.saleNo}".`);
      if (sale.status === "voided") throw badRequest("That sale was voided — nothing to return.");
      if (sale.service?.kind) throw badRequest("That's a service payment, not goods — it can't be returned.");
      const items = [];
      for (const item of args.items || []) {
        const line = sale.items.find((l) => l.name.toLowerCase() === String(item.productName || "").toLowerCase());
        if (!line) throw badRequest(`"${item.productName}" isn't on receipt ${sale.saleNo}.`);
        const qty = Math.round(Number(item.qty));
        if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`Give a valid quantity for ${line.name}.`);
        items.push({ productId: String(line.productId), name: line.name, qty });
      }
      if (!items.length) throw badRequest("A return needs at least one item.");
      if (!args.reason?.trim()) throw badRequest("Give a reason for the return.");
      const method = ["cash", "pos", "transfer"].includes(args.refundMethod) ? args.refundMethod : "cash";
      return { saleId: String(sale._id), saleNo: sale.saleNo, items, reason: args.reason.trim(), refundMethod: method };
    }

    case "create_staff": {
      if (!args.name?.trim()) throw badRequest("A staff member needs a name.");
      const role = ["admin", "manager", "staff"].includes(args.role) ? args.role : "staff";
      if (!/^\d{4}$/.test(String(args.pin || ""))) throw badRequest("Give a 4-digit PIN.");
      let branchId = null, branchName = "";
      if (args.branchName?.trim()) {
        const branch = await Branch.findOne({ businessId: ctx.businessId, name: { $regex: `^${escapeRegex(args.branchName)}$`, $options: "i" } });
        if (!branch) throw notFound(`No branch called "${args.branchName}".`);
        branchId = String(branch._id);
        branchName = branch.name;
      }
      if ((role === "manager" || role === "staff") && !branchId) {
        throw badRequest("Managers and staff must be assigned to a branch — name one.");
      }
      return { name: args.name.trim(), role, pin: String(args.pin), branchId, branchName, email: args.email?.trim() || "" };
    }

    case "record_expense": {
      if (!ctx.branchId) throw badRequest("Select a branch first.");
      if (!args.type?.trim()) throw badRequest("What kind of expense is this?");
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw badRequest("Give a valid amount.");
      return { type: args.type.trim(), amount: money(amount), notes: args.notes || "", paidBy: args.paidBy || "" };
    }

    default:
      throw badRequest(`Unknown action "${name}".`);
  }
}

// ── Execute: the actual write, run only from the approve route, never
// from the chat call that proposed it. ──────────────────────────────────

export async function executeAction(ctx, action) {
  const p = action.payload;
  switch (action.type) {
    case "import_catalog":
      return executeImport(ctx, action);

    case "archive_products": {
      const n = await archiveProducts(ctx, p.productIds, { via: "ai" });
      return { type: "product", label: n ? `Deleted ${n} product${n === 1 ? "" : "s"}` : "Nothing to delete, they were already gone", count: n };
    }

    case "create_customer": {
      if (p.phone) {
        const dupe = await Customer.findOne({ businessId: ctx.businessId, phone: p.phone });
        if (dupe) throw badRequest(`${dupe.name} already has that phone number.`);
      }
      const customer = await Customer.create({
        accountId: ctx.accountId, businessId: ctx.businessId,
        name: p.name, phone: p.phone, whatsapp: p.phone, notes: p.notes,
      });
      return { type: "customer", id: customer._id, label: customer.name };
    }

    case "create_product": {
      const escaped = escapeRegex(p.name);
      const dupe = await Product.findOne({ businessId: ctx.businessId, status: "active", name: { $regex: `^${escaped}$`, $options: "i" } });
      if (dupe) throw badRequest(`"${dupe.name}" is already in your catalog.`);
      const product = await Product.create({
        accountId: ctx.accountId, businessId: ctx.businessId,
        name: p.name, category: p.category, price: p.price, cost: p.cost, reorderLevel: p.reorderLevel, barcode: p.barcode,
      });
      if (p.openingStock > 0 && action.branchId) {
        await applyMovement(ctx, {
          branchId: action.branchId, productId: product._id, productName: product.name,
          type: "IN", qty: p.openingStock, refType: "manual", reason: "Opening stock (AI-proposed)",
        });
      }
      return { type: "product", id: product._id, label: product.name };
    }

    case "adjust_stock": {
      const branchId = action.branchId;
      const product = await Product.findOne({ _id: p.productId, businessId: ctx.businessId });
      if (!product) throw notFound("That product no longer exists.");
      const inv = await Inventory.findOne({ branchId, productId: p.productId });
      const current = inv?.stock ?? 0;
      const delta = p.newQty - current;
      if (delta !== 0) {
        await applyMovement(ctx, {
          branchId, productId: product._id, productName: product.name,
          type: "ADJUST", qty: delta, refType: "manual", reason: p.reason,
        });
        afterStockChange(ctx, branchId, [product._id]);
      }
      return { type: "product", id: product._id, label: product.name };
    }

    case "record_sale": {
      const branchId = action.branchId;
      const out = await withTransaction(async (session) => {
        const products = await Product.find({ _id: { $in: p.items.map((i) => i.productId) }, businessId: ctx.businessId }).session(session);
        const byId = new Map(products.map((prod) => [String(prod._id), prod]));

        let customer = null;
        if (p.customerName) {
          customer = await Customer.findOne({ businessId: ctx.businessId, name: p.customerName }).session(session);
        }

        const lines = p.items.map((i) => {
          const prod = byId.get(i.productId);
          if (!prod) throw notFound(`"${i.productName}" no longer exists.`);
          return {
            productId: prod._id, name: prod.name, qty: i.qty,
            unitPrice: prod.price, lineCost: money(prod.cost * i.qty), lineNet: money(prod.price * i.qty), returnedQty: 0,
          };
        });
        const subtotal = money(lines.reduce((s, l) => s + l.lineNet, 0));
        const total = subtotal;

        for (const line of lines) {
          await applyMovement(ctx, {
            branchId, productId: line.productId, productName: line.name,
            type: "OUT", qty: -line.qty, refType: "sale", reason: "Sale (AI-proposed)", session,
          });
        }

        const seq = await nextSeq(`sale:${branchId}`, session);
        const [sale] = await Sale.create([{
          accountId: ctx.accountId, businessId: ctx.businessId, branchId,
          saleNo: `R-${String(seq).padStart(5, "0")}`,
          staffId: ctx.userId, staffName: ctx.actorName,
          customerId: customer?._id, customerName: customer?.name || "",
          items: lines, subtotal, discount: 0, vat: 0, total,
          payments: [{ method: p.paymentMethod, amount: total }],
        }], { session });

        if (customer) {
          customer.totalSpend = money(customer.totalSpend + total);
          customer.visits += 1;
          customer.lastSeen = new Date();
          customer.lastBranchId = branchId;
          await customer.save({ session });
        }

        const totalCost = money(lines.reduce((s, l) => s + l.lineCost, 0));
        await bumpDailyMetric(ctx, branchId, localDay(), {
          revenue: total, cost: totalCost, profit: total - totalCost, txns: 1,
          payments: { [p.paymentMethod]: total },
        }, session);

        return { sale, deductedIds: lines.map((l) => l.productId) };
      });

      afterStockChange(ctx, branchId, out.deductedIds);
      return { type: "sale", id: out.sale._id, label: out.sale.saleNo };
    }

    case "process_return": {
      const sale = await Sale.findOne({ _id: p.saleId, businessId: ctx.businessId });
      if (!sale) throw notFound("That sale no longer exists.");
      const paidFactor = sale.subtotal > 0 ? (sale.subtotal - sale.discount) / sale.subtotal : 1;
      const vatFactor = sale.subtotal - sale.discount > 0 ? sale.vat / (sale.subtotal - sale.discount) : 0;

      const items = [];
      let refundAmount = 0;
      for (const item of p.items) {
        const line = sale.items.find((l) => String(l.productId) === item.productId);
        if (!line) throw badRequest(`"${item.name}" isn't on that receipt.`);
        const pendingOrReturned = await Return.aggregate([
          { $match: { saleId: sale._id, status: { $in: ["pending", "approved"] } } },
          { $unwind: "$items" },
          { $match: { "items.productId": line.productId } },
          { $group: { _id: null, qty: { $sum: "$items.qty" } } },
        ]);
        const already = pendingOrReturned[0]?.qty || 0;
        const returnable = line.qty - already;
        if (item.qty > returnable) throw badRequest(`Only ${returnable} × ${line.name} can still be returned.`);
        const isCustom = !!line.components?.length;
        const unitNet = money((line.lineNet / line.qty) * paidFactor);
        const unitCost = isCustom ? 0 : line.qty > 0 ? money(line.lineCost / line.qty) : 0;
        items.push({ productId: line.productId, name: line.name, qty: item.qty, unitPrice: unitNet, unitCost, restock: !isCustom });
        refundAmount += unitNet * item.qty;
      }
      refundAmount = money(refundAmount * (1 + vatFactor));

      const ret = await Return.create({
        accountId: ctx.accountId, businessId: ctx.businessId, branchId: sale.branchId,
        saleId: sale._id, saleNo: sale.saleNo, items,
        refund: { method: p.refundMethod, amount: refundAmount },
        reason: p.reason, requestedBy: ctx.userId, requestedByName: ctx.actorName,
      });
      raiseReturnPending(ctx, ret);
      return { type: "return", id: ret._id, label: ret.saleNo };
    }

    case "create_staff": {
      let email = (p.email || "").toLowerCase().trim();
      if (email) {
        if (await User.findOne({ email })) throw badRequest("That email is already registered.");
      } else {
        email = `staff-${crypto.randomBytes(6).toString("hex")}@${ctx.businessId}.till.local`;
      }
      if (p.role === "admin" && !ctx.perms.includes("*")) {
        throw badRequest("Only the owner can add admins.");
      }
      const user = await User.create({
        name: p.name, email, passwordHash: await hashPassword(crypto.randomBytes(12).toString("hex")),
      });
      const membership = await Membership.create({
        userId: user._id, accountId: ctx.accountId, businessId: ctx.businessId,
        branchId: p.branchId || null, role: p.role, pinHash: await hashPassword(p.pin),
      });
      return { type: "staff", id: membership._id, label: p.name };
    }

    case "record_expense": {
      const branchId = action.branchId;
      const expense = await Expense.create({
        accountId: ctx.accountId, businessId: ctx.businessId, branchId,
        type: p.type, amount: p.amount, notes: p.notes, paidBy: p.paidBy,
        actorId: ctx.userId, actorName: ctx.actorName,
      });
      await bumpDailyMetric(ctx, branchId, localDay(), { expenses: expense.amount });
      return { type: "expense", id: expense._id, label: expense.type };
    }

    default:
      throw badRequest(`Unknown action "${action.type}".`);
  }
}

export function describeAction(type, payload) {
  switch (type) {
    case "create_customer": return `Create customer "${payload.name}"${payload.phone ? ` (${payload.phone})` : ""}`;
    case "create_product": return `Add product "${payload.name}" at ${payload.price} (opening stock: ${payload.openingStock})`;
    case "adjust_stock": return `Set "${payload.productName}" stock to ${payload.newQty} — ${payload.reason}`;
    case "record_sale": return `Record a sale: ${payload.items.map((i) => `${i.productName} ×${i.qty}`).join(", ")}${payload.customerName ? ` for ${payload.customerName}` : ""}`;
    case "process_return": return `File a return on ${payload.saleNo}: ${payload.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}`;
    case "create_staff": return `Create staff account "${payload.name}" (${payload.role}${payload.branchName ? `, ${payload.branchName}` : ""})`;
    case "record_expense": return `Log a ${payload.type} expense of ${payload.amount}${payload.paidBy ? ` (paid by ${payload.paidBy})` : ""}`;
    case "archive_products":
      return payload.scope === "all" ? `Delete ALL ${payload.count} products from the catalog`
        : payload.scope === "category" ? `Delete the ${payload.count} product${payload.count === 1 ? "" : "s"} in “${payload.category}”`
        : `Delete ${payload.count === 1 ? `product "${payload.names?.[0]}"` : `${payload.count} products: ${payload.names.slice(0, 4).join(", ")}${payload.count > 4 ? ", …" : ""}`}`;
    case "import_catalog": return `Add ${payload.rows?.length ?? 0} ${String(payload.label || "items").toLowerCase()} from “${payload.fileName}”`;
    default: return type;
  }
}
