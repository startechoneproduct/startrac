import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { requirePerm, canSeeCost, requireFeature, limitProblem, planRequired } from "#core/middleware/tenant.js";
import { planAllows } from "#shared/plans.js";
import { audit } from "#core/audit.js";
import { money, isValidAmount } from "#core/money.js";
import { typeTemplate } from "#shared/businessTypes.js";
import { imageUploadEnabled, uploadImage, deleteImage } from "#core/cloudinary.js";
import { scopedToBranch, ownerBranchForNew } from "#core/branchScope.js";
import { archiveProducts, archivableFilter } from "#modules/products/archive.service.js";
import { findPhotos, downloadPhoto, photoSources } from "#modules/products/photoSearch.js";
import { escapeRegex } from "#core/regex.js";

export const productsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

// A store cannot have two products with the same name, matched case- and
// whitespace-insensitively — "Egg Crate" and "egg crate " are the same
// product. Scoped per business; another business can have its own.
async function findNameTaken(ctx, name, excludeId) {
  const escaped = escapeRegex(name);
  const filter = { businessId: ctx.businessId, status: "active", name: { $regex: `^${escaped}$`, $options: "i" } };
  if (excludeId) filter._id = { $ne: excludeId };
  // Only clashes with what this store can see: another store may sell its own "Rice".
  return Product.findOne(scopedToBranch(ctx, filter));
}

// Some trades genuinely can't sell in every unit a supermarket can (a
// poultry farm has no "bottle"), and a "bird" only means something once
// it's a layer or a broiler. Declared per type as `allowedUnits` in
// businessTypes.js — most types have none and stay unrestricted.
function checkUnitAndCategory(template, unit, category) {
  if (template.allowedUnits?.length && !template.allowedUnits.includes(unit)) {
    return `Unit must be one of: ${template.allowedUnits.join(", ")}.`;
  }
  if (unit === "bird" && category !== "layer" && category !== "broiler") {
    return `A "bird" unit needs a category of "layer" or "broiler".`;
  }
  return null;
}

// SKUs are never typed by a user — generated here, retried on the rare
// collision, and falling back to a timestamp suffix if it still can't find
// a free one.
async function generateSku(businessId, prefix) {
  const p = prefix || "GEN";
  for (let i = 0; i < 5; i++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
    const candidate = `${p}-${suffix}`;
    if (!(await Product.findOne({ businessId, sku: candidate }).select("_id"))) return candidate;
  }
  return `${p}-${Date.now().toString(36).toUpperCase()}`;
}

function shape(p, stockByProduct, showCost) {
  const mto = p.archetype === "made_to_order";
  const hasBom = (p.bom || []).length > 0;
  const out = {
    id: p._id,
    name: p.name,
    sku: p.sku || "",
    barcode: p.barcode,
    category: p.category,
    archetype: p.archetype,
    price: p.price,
    reorderLevel: p.reorderLevel,
    unit: p.unit || "unit",
    purchaseUnit: p.purchaseUnit || "",
    unitsPerPurchase: p.unitsPerPurchase || 1,
    expiry: p.expiry || null,
    tracksSerials: !!p.tracksSerials,
    warrantyMonths: p.warrantyMonths || 0,
    status: p.status,
    imageUrl: p.imageUrl || "",
    branchId: p.branchId || null, // null = shared by every store
    // MTO items carry no stock of their own — their components do.
    stock: mto ? null : stockByProduct ? stockByProduct.get(String(p._id)) ?? 0 : undefined,
    // A recipe now belongs to either archetype: an MTO item's bom is expanded
    // live at checkout; a stock item's bom is what a Production Run consumes.
    bom: hasBom ? (p.bom || []).map((c) => ({ productId: c.productId, per: c.per, factor: c.factor, includeLeakage: c.includeLeakage !== false })) : undefined,
    ...(hasBom && !mto ? { producedUnitsPerStockUnit: p.producedUnitsPerStockUnit || 1 } : {}),
    createdAt: p.createdAt,
  };
  if (showCost) out.cost = p.cost;
  return out;
}

const bomSchema = z
  .array(
    z.object({
      productId: z.string(),
      per: z.enum(["sqm", "width", "height", "unit"]),
      factor: z.number().positive().max(1000).default(1),
      includeLeakage: z.boolean().default(true),
    })
  )
  .min(1, "A made-to-order item needs at least one component")
  .max(20);

// Components must be real, active stock products of this business.
async function validateBom(businessId, bom) {
  const ids = bom.map((c) => c.productId);
  const comps = await Product.find({ _id: { $in: ids }, businessId, status: "active", archetype: "stock" });
  if (comps.length !== new Set(ids.map(String)).size) {
    return { error: "Each component must be an existing stock product (no nesting made-to-order items)." };
  }
  return { comps };
}

// GET /api/products?q=&category=&status= — catalog with the active branch's stock.
// Staff-safe: cost is stripped for roles without the finance permission.
productsRouter.get("/", async (req, res) => {
  const filter = { businessId: req.ctx.businessId, status: req.query.status === "archived" ? "archived" : "active" };
  if (req.query.category && req.query.category !== "All") filter.category = req.query.category;
  if (req.query.q) filter.name = { $regex: escapeRegex(req.query.q).slice(0, 60), $options: "i" };

  const products = await Product.find(scopedToBranch(req.ctx, filter)).sort({ name: 1 }).limit(1000);
  let stockByProduct = null;
  if (req.ctx.branchId) {
    const inv = await Inventory.find({ branchId: req.ctx.branchId, productId: { $in: products.map((p) => p._id) } });
    stockByProduct = new Map(inv.map((i) => [String(i.productId), i.stock]));
  }
  const showCost = canSeeCost(req.ctx);
  res.json({ products: products.map((p) => shape(p, stockByProduct, showCost)) });
});

// GET /api/products/categories — distinct category list for filters
productsRouter.get("/categories", async (req, res) => {
  const cats = await Product.distinct("category", scopedToBranch(req.ctx, { businessId: req.ctx.businessId, status: "active" }));
  res.json({ categories: cats.sort((a, b) => a.localeCompare(b)) });
});

// GET /api/products/barcode/:code — scanner lookup on the POS
productsRouter.get("/barcode/:code", requireFeature("barcodes"), async (req, res) => {
  const p = await Product.findOne(scopedToBranch(req.ctx, { businessId: req.ctx.businessId, barcode: req.params.code, status: "active" }));
  if (!p) return res.status(404).json({ error: "not_found", message: "No product with that barcode." });
  let stock = 0;
  if (req.ctx.branchId) {
    const inv = await Inventory.findOne({ branchId: req.ctx.branchId, productId: p._id });
    stock = inv?.stock ?? 0;
  }
  res.json({ product: { ...shape(p, null, canSeeCost(req.ctx)), stock } });
});

const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  // Never typed by a user in the normal flow — left blank, the server
  // generates one. Accepted here only so CSV import / API callers can carry
  // one over from elsewhere.
  sku: z.string().default(""),
  barcode: z.string().trim().max(64).default(""),
  category: z.string().min(1).default("General"),
  archetype: z.enum(["stock", "made_to_order"]).default("stock"),
  bom: bomSchema.optional(),
  price: z.number().min(0, "Price can't be negative"),
  cost: z.number().min(0).default(0),
  reorderLevel: z.number().min(0).default(5),
  // Display unit ("kg", "litre", "bag"…) plus an optional purchase-unit
  // conversion for goods bought in one unit and consumed in another.
  unit: z.string().max(20).default("unit"),
  purchaseUnit: z.string().max(30).default(""),
  unitsPerPurchase: z.number().min(0.001).max(1000000).default(1),
  tracksSerials: z.boolean().default(false),
  // Warranty period in months, applied to each Serial at the moment it's
  // sold. Meaningless without tracksSerials, harmless otherwise.
  warrantyMonths: z.number().int().min(0).max(600).default(0),
  // Production-run yield: "12 bottles = 1 pack". Meaningless without a bom.
  producedUnitsPerStockUnit: z.number().int().min(1).max(100000).default(1),
  // Accepts "YYYY-MM-DD" from a date input; empty string clears it.
  expiry: z
    .string()
    .refine((s) => s === "" || !Number.isNaN(new Date(s).getTime()), "Invalid expiry date")
    .nullable()
    .optional(),
  openingStock: z.number().int().min(0).default(0), // convenience on create
  // With several stores a new product belongs to the active store unless this
  // is set. Single-store businesses ignore it.
  shareWithAllStores: z.boolean().default(false),
});

// POST /api/products — requires the prices permission
productsRouter.post("/", requirePerm("products_add"), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  if (d.barcode && !planAllows(req.ctx.plan, "barcodes")) return res.status(403).json(planRequired("barcodes"));
  if (d.expiry && !planAllows(req.ctx.plan, "expiry")) return res.status(403).json(planRequired("expiry"));
  const room = limitProblem(req.ctx.plan, "products", await Product.countDocuments({ businessId: req.ctx.businessId, status: "active" }));
  if (room) return res.status(403).json(room);

  if (d.barcode) {
    const dupe = await Product.findOne(scopedToBranch(req.ctx, { businessId: req.ctx.businessId, barcode: d.barcode, status: "active" }));
    if (dupe) return res.status(409).json({ error: "barcode_taken", message: `Barcode already on "${dupe.name}".` });
  }

  const nameDupe = await findNameTaken(req.ctx, d.name);
  if (nameDupe) return res.status(409).json({ error: "name_taken", message: `"${nameDupe.name}" is already in your catalog.` });

  const template = typeTemplate(req.ctx.business.typeKey);
  const unitError = checkUnitAndCategory(template, d.unit, d.category);
  if (unitError) return res.status(400).json({ error: "invalid", message: unitError });

  const isMto = d.archetype === "made_to_order";
  if (isMto && !d.bom) {
    return res.status(400).json({ error: "invalid", message: "Add the components this item is made from." });
  }
  // A stock item's recipe (for Production Runs) is optional — most stock
  // products have none.
  if (d.bom?.length) {
    const check = await validateBom(req.ctx.businessId, d.bom);
    if (check.error) return res.status(400).json({ error: "invalid", message: check.error });
  }

  const sku = d.sku.trim() || (await generateSku(req.ctx.businessId, template.skuPrefix));

  const product = await Product.create({
    accountId: req.ctx.accountId,
    businessId: req.ctx.businessId,
    branchId: await ownerBranchForNew(req.ctx, { shared: d.shareWithAllStores }),
    name: d.name,
    sku,
    barcode: d.barcode,
    category: d.category,
    archetype: d.archetype,
    bom: d.bom?.length ? d.bom : [],
    producedUnitsPerStockUnit: d.producedUnitsPerStockUnit,
    price: money(d.price),
    cost: money(d.cost),
    reorderLevel: d.reorderLevel,
    unit: d.unit,
    purchaseUnit: d.purchaseUnit,
    unitsPerPurchase: d.unitsPerPurchase,
    expiry: d.expiry ? new Date(d.expiry) : undefined,
    tracksSerials: !isMto && d.tracksSerials,
    warrantyMonths: !isMto && d.tracksSerials ? d.warrantyMonths : 0,
  });

  // Opening stock lands as a proper IN movement so the ledger starts correct.
  if (!isMto && d.openingStock > 0 && req.ctx.branchId) {
    const { applyMovement } = await import("#modules/inventory/inventory.service.js");
    await applyMovement(req.ctx, {
      branchId: req.ctx.branchId,
      productId: product._id,
      productName: product.name,
      type: "IN",
      qty: d.openingStock,
      refType: "manual",
      reason: "Opening stock",
    });
  }

  audit(req.ctx, "product.create", { type: "product", id: product._id, label: product.name }, undefined, {
    price: product.price,
    cost: product.cost,
  });
  res.status(201).json({ product: { ...shape(product, null, canSeeCost(req.ctx)), ...(isMto ? {} : { stock: d.openingStock }) } });
});

const importRowSchema = z.object({
  name: z.string().min(1),
  category: z.string().default("General"),
  barcode: z.string().trim().max(64).default(""),
  price: z.number().min(0),
  cost: z.number().min(0).default(0),
  reorderLevel: z.number().min(0).default(5),
  openingStock: z.number().int().min(0).default(0),
  expiry: z.string().default(""),
});

// POST /api/products/import — bulk import (CSV parsed client-side into rows).
// All-or-nothing per row: bad rows are reported and skipped, good rows land.
// Duplicate names (case-insensitive) and barcodes already in the catalog are skipped.
productsRouter.post("/import", requirePerm("products_add"), requireFeature("csvImport"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "invalid", message: "No rows to import." });
  const importRoom = limitProblem(req.ctx.plan, "products", await Product.countDocuments({ businessId: req.ctx.businessId, status: "active" }), rows.length);
  if (importRoom) return res.status(403).json(importRoom);
  if (rows.length > 2000) return res.status(400).json({ error: "too_many", message: "Import at most 2,000 products at a time." });

  const existing = await Product.find({ businessId: req.ctx.businessId, status: "active" }).select("name barcode");
  const namesTaken = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const barcodesTaken = new Set(existing.filter((p) => p.barcode).map((p) => p.barcode));
  const template = typeTemplate(req.ctx.business.typeKey);

  const { applyMovement } = await import("#modules/inventory/inventory.service.js");
  const results = { created: 0, skipped: [] };

  for (let i = 0; i < rows.length; i++) {
    const parsed = importRowSchema.safeParse(rows[i]);
    if (!parsed.success) {
      results.skipped.push({ row: i + 1, name: rows[i]?.name || "(no name)", reason: parsed.error.issues[0].message });
      continue;
    }
    const d = parsed.data;
    const nameKey = d.name.trim().toLowerCase();
    if (namesTaken.has(nameKey)) {
      results.skipped.push({ row: i + 1, name: d.name, reason: "Already in catalog (same name)" });
      continue;
    }
    if (d.barcode && barcodesTaken.has(d.barcode)) {
      results.skipped.push({ row: i + 1, name: d.name, reason: "Barcode already in use" });
      continue;
    }
    const expiryDate = d.expiry && !Number.isNaN(new Date(d.expiry).getTime()) ? new Date(d.expiry) : undefined;
    const sku = await generateSku(req.ctx.businessId, template.skuPrefix);

    const product = await Product.create({
      accountId: req.ctx.accountId,
      businessId: req.ctx.businessId,
      name: d.name.trim(),
      sku,
      barcode: d.barcode.trim(),
      category: d.category.trim() || "General",
      price: money(d.price),
      cost: money(d.cost),
      reorderLevel: d.reorderLevel,
      expiry: expiryDate,
    });
    namesTaken.add(nameKey);
    if (d.barcode) barcodesTaken.add(d.barcode);

    if (d.openingStock > 0 && req.ctx.branchId) {
      await applyMovement(req.ctx, {
        branchId: req.ctx.branchId,
        productId: product._id,
        productName: product.name,
        type: "IN",
        qty: d.openingStock,
        refType: "manual",
        reason: "CSV import — opening stock",
      });
    }
    results.created++;
  }

  audit(req.ctx, "product.import", { type: "product", label: `${results.created} imported` }, undefined, {
    created: results.created,
    skipped: results.skipped.length,
  });
  res.status(201).json(results);
});

// PATCH /api/products/:id — price changes are audited with before/after
productsRouter.patch("/:id", requirePerm("products_edit"), async (req, res) => {
  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const product = await Product.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });

  if (d.barcode && d.barcode !== product.barcode && !planAllows(req.ctx.plan, "barcodes")) return res.status(403).json(planRequired("barcodes"));
  if (d.expiry && !planAllows(req.ctx.plan, "expiry")) return res.status(403).json(planRequired("expiry"));

  if (d.barcode && d.barcode !== product.barcode) {
    const dupe = await Product.findOne({ businessId: req.ctx.businessId, barcode: d.barcode, status: "active", _id: { $ne: product._id } });
    if (dupe) return res.status(409).json({ error: "barcode_taken", message: `Barcode already on "${dupe.name}".` });
  }

  if (d.name !== undefined && d.name.trim().toLowerCase() !== product.name.trim().toLowerCase()) {
    const nameDupe = await findNameTaken(req.ctx, d.name, product._id);
    if (nameDupe) return res.status(409).json({ error: "name_taken", message: `"${nameDupe.name}" is already in your catalog.` });
  }

  if (d.unit !== undefined || d.category !== undefined) {
    const template = typeTemplate(req.ctx.business.typeKey);
    const unitError = checkUnitAndCategory(
      template,
      d.unit !== undefined ? d.unit : product.unit,
      d.category !== undefined ? d.category : product.category
    );
    if (unitError) return res.status(400).json({ error: "invalid", message: unitError });
  }

  // A recipe can be edited on either archetype: MTO (checkout expansion) or
  // stock (Production Runs, see server/modules/production/).
  if (d.bom !== undefined) {
    const check = await validateBom(req.ctx.businessId, d.bom);
    if (check.error) return res.status(400).json({ error: "invalid", message: check.error });
    product.bom = d.bom;
  }
  if (d.producedUnitsPerStockUnit !== undefined) product.producedUnitsPerStockUnit = d.producedUnitsPerStockUnit;

  const before = { name: product.name, price: product.price, cost: product.cost };
  const expiryBefore = product.expiry ? new Date(product.expiry).getTime() : null;
  const reorderBefore = product.reorderLevel;
  if (d.name !== undefined) product.name = d.name;
  if (d.barcode !== undefined) product.barcode = d.barcode;
  if (d.category !== undefined) product.category = d.category;
  if (d.price !== undefined && isValidAmount(d.price)) product.price = money(d.price);
  if (d.cost !== undefined && isValidAmount(d.cost)) product.cost = money(d.cost);
  if (d.reorderLevel !== undefined) product.reorderLevel = d.reorderLevel;
  if (d.unit !== undefined) product.unit = d.unit;
  if (d.purchaseUnit !== undefined) product.purchaseUnit = d.purchaseUnit;
  if (d.unitsPerPurchase !== undefined) product.unitsPerPurchase = d.unitsPerPurchase;
  if (d.expiry !== undefined) product.expiry = d.expiry ? new Date(d.expiry) : undefined;
  if (d.tracksSerials !== undefined) product.tracksSerials = d.tracksSerials;
  if (d.warrantyMonths !== undefined) product.warrantyMonths = d.warrantyMonths;
  await product.save();

  // A new expiry date (or none) makes the old warnings wrong — clear them and
  // let the next sweep raise the right ones. This is the legacy app's
  // `_autoDismissExpiryAlerts`, triggered by the edit that caused it.
  const expiryAfter = product.expiry ? new Date(product.expiry).getTime() : null;
  if (expiryBefore !== expiryAfter) {
    const { resolveByPrefix, keys } = await import("#modules/alerts/notify.js");
    const { Inventory } = await import("#modules/inventory/inventory.model.js");
    const levels = await Inventory.find({ businessId: req.ctx.businessId, productId: product._id }).select("branchId");
    for (const l of levels) await resolveByPrefix(req.ctx.businessId, keys.expiryPrefix(l.branchId, product._id));
  }
  // A changed reorder level changes what counts as "low" right now.
  if (reorderBefore !== product.reorderLevel && req.ctx.branchId) {
    const { afterStockChange } = await import("#modules/alerts/alerts.service.js");
    afterStockChange(req.ctx, req.ctx.branchId, [product._id]);
  }

  if (before.price !== product.price || before.cost !== product.cost) {
    audit(req.ctx, "product.price_change", { type: "product", id: product._id, label: product.name }, before, {
      name: product.name,
      price: product.price,
      cost: product.cost,
    });
  }
  res.json({ product: shape(product, null, canSeeCost(req.ctx)) });
});

// POST /api/products/archive-all — remove every product this store can see from
// the catalog at once. Archives (sales history keeps pointing at them), and
// needs { confirm: true } so a stray request can't empty a catalog.
productsRouter.post("/archive-all", requirePerm("products_delete"), async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: "confirm_required", message: "Confirm that you want to delete every product." });
  const ids = (await Product.find(archivableFilter(req.ctx)).select("_id")).map((p) => p._id);
  const count = await archiveProducts(req.ctx, ids, { via: "bulk" });
  res.json({ ok: true, count });
});

// POST /api/products/photos/suggest — look photos up by product NAME. Body:
// { ids?: string[], skip?: string[] } — ids omitted = the newest products that
// have no photo yet; skip = ones already looked at (a product with no match
// would otherwise come back every time). A small batch per call keeps each
// request well inside serverless time limits; the page asks again for more.
// Read-only: nothing is attached until /photos/apply, after a person has
// looked at what was found.
const PHOTO_BATCH = 12;
const APPLY_BATCH = 8;
const objectIds = (v) => (Array.isArray(v) ? v.filter((i) => typeof i === "string" && /^[a-f\d]{24}$/i.test(i)).slice(0, 500) : null);
productsRouter.post("/photos/suggest", requirePerm("products_edit"), requireFeature("productPhotos"), async (req, res) => {
  const ids = objectIds(req.body?.ids);
  const skip = objectIds(req.body?.skip) || [];
  const filter = { businessId: req.ctx.businessId, status: "active", $or: [{ imageUrl: "" }, { imageUrl: null }] };
  filter._id = ids ? { $in: ids, $nin: skip } : { $nin: skip };
  const total = await Product.countDocuments(scopedToBranch(req.ctx, filter));
  const products = await Product.find(scopedToBranch(req.ctx, filter)).sort({ createdAt: -1, _id: -1 }).limit(PHOTO_BATCH).select("name category");

  const results = new Array(products.length);
  let next = 0;
  const worker = async () => {
    while (next < products.length) {
      const i = next++;
      const p = products[i];
      const { candidates } = await findPhotos(p.name, p.category);
      results[i] = { id: String(p._id), name: p.name, category: p.category || "", candidates };
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  res.json({ items: results, remaining: Math.max(0, total - products.length), sources: photoSources(), canStore: imageUploadEnabled() });
});

// POST /api/products/photos/apply — save the photos a person chose.
// Body: { items: [{ id, url, credit? }] }. Each URL must be from a known photo
// host; the file is fetched here, and re-hosted on Cloudinary when it's set up.
productsRouter.post("/photos/apply", requirePerm("products_edit"), requireFeature("productPhotos"), async (req, res) => {
  const parsed = z.object({
    items: z.array(z.object({ id: z.string().regex(/^[a-f\d]{24}$/i), url: z.string().url().max(600), credit: z.string().max(160).optional() })).min(1).max(APPLY_BATCH),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "Choose at least one photo." });

  let saved = 0;
  const failed = [];
  let next = 0;
  const items = parsed.data.items;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      const product = await Product.findOne(scopedToBranch(req.ctx, { _id: it.id, businessId: req.ctx.businessId }));
      if (!product) { failed.push({ id: it.id, reason: "Product not found." }); continue; }
      const buf = await downloadPhoto(it.url);
      if (!buf) { failed.push({ id: it.id, name: product.name, reason: "That photo couldn't be downloaded." }); continue; }
      let url = it.url;
      let publicId = "";
      if (imageUploadEnabled()) {
        const up = await uploadImage(buf, `startrack/${req.ctx.businessId}/products`);
        if (up.ok) { url = up.url; publicId = up.publicId; }
      }
      const oldPublicId = product.imagePublicId;
      product.imageUrl = url;
      product.imagePublicId = publicId;
      product.imageCredit = (it.credit || "").slice(0, 160);
      await product.save();
      if (oldPublicId) deleteImage(oldPublicId);
      saved++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (saved) audit(req.ctx, "product.photos", { type: "product", label: `${saved} photo${saved === 1 ? "" : "s"} added from search` });
  res.json({ saved, failed });
});

// POST /api/products/:id/image — upload/replace this product's photo.
// Multipart, field name "image". A replaced photo's old Cloudinary asset is
// cleaned up best-effort; nothing here blocks on that cleanup succeeding.
productsRouter.post("/:id/image", requirePerm("products_edit"), requireFeature("productPhotos"), upload.single("image"), async (req, res) => {
  if (!imageUploadEnabled()) return res.status(400).json({ error: "not_configured", message: "Photo upload isn't set up on this server yet." });
  if (!req.file) return res.status(400).json({ error: "invalid", message: "Choose an image (JPEG, PNG, WEBP or GIF, up to 5MB)." });

  const product = await Product.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });

  const result = await uploadImage(req.file.buffer, `startrack/${req.ctx.businessId}/products`);
  if (!result.ok) {
    const message = result.reason === "not_configured"
      ? "Photo upload isn't set up on this server yet."
      : `Cloudinary rejected the upload: ${result.reason || "unknown error"}`;
    return res.status(502).json({ error: "upload_failed", message });
  }

  const oldPublicId = product.imagePublicId;
  product.imageUrl = result.url;
  product.imagePublicId = result.publicId;
  await product.save();
  if (oldPublicId) deleteImage(oldPublicId);

  audit(req.ctx, "product.image", { type: "product", id: product._id, label: product.name });
  res.json({ product: shape(product, null, canSeeCost(req.ctx)) });
});

// DELETE /api/products/:id/image — remove the photo, fall back to the category icon
productsRouter.delete("/:id/image", requirePerm("products_edit"), async (req, res) => {
  const product = await Product.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });
  const oldPublicId = product.imagePublicId;
  product.imageUrl = "";
  product.imagePublicId = "";
  await product.save();
  if (oldPublicId) deleteImage(oldPublicId);
  res.json({ product: shape(product, null, canSeeCost(req.ctx)) });
});

// DELETE /api/products/:id — archive, never hard-delete (sales history points here)
productsRouter.delete("/:id", requirePerm("products_delete"), async (req, res) => {
  const product = await Product.findOne(scopedToBranch(req.ctx, { _id: req.params.id, businessId: req.ctx.businessId }));
  if (!product) return res.status(404).json({ error: "not_found", message: "Product not found." });
  await archiveProducts(req.ctx, [product._id], { via: "single" });
  res.json({ ok: true });
});
