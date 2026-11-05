import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { StockReceipt } from "#modules/inventory/stockReceipt.model.js";
import { Product } from "#modules/products/product.model.js";
import { Inventory } from "#modules/inventory/inventory.model.js";
import { FileDoc, DOC_MIME, DOC_MAX_BYTES } from "#modules/files/fileDoc.model.js";
import { requirePerm, requireBranch, requireFeature, canSeeCost } from "#core/middleware/tenant.js";
import { scopedToBranch } from "#core/branchScope.js";
import { parseUpload, UploadError, MAX_FILE_BYTES } from "#modules/imports/parseSheet.js";
import { guessColumns, cleanMapping, bestTable } from "#modules/imports/columns.js";
import { normKey, parseCount, parseMoney } from "#modules/imports/values.js";
import { escapeRegex } from "#core/regex.js";

/**
 * Deliveries received (goods received notes): look them up, attach the
 * supplier's paperwork, and fill a delivery from a spreadsheet. Receiving
 * itself is POST /api/inventory/stock-in — a spreadsheet never receives stock
 * on its own here; it only fills the form, which then goes through that same
 * door, so every check applies to typed and uploaded deliveries alike.
 */
export const stockReceiptsRouter = Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILES = 3;
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: DOC_MAX_BYTES }, fileFilter: (_r, f, cb) => cb(null, DOC_MIME.test(f.mimetype)) });
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });
const canRead = requirePerm("stock_in", "inventory_view");

function shape(r, showCost) {
  return {
    id: r._id, receiptNo: r.receiptNo, supplierName: r.supplierName, supplierId: r.supplierId, receivedOn: r.receivedOn,
    reference: r.reference, note: r.note, source: r.source, actorName: r.actorName, createdAt: r.createdAt,
    totalQty: r.totalQty, lineCount: r.lines.length,
    ...(showCost ? { totalCost: r.totalCost, costedLines: r.costedLines } : {}),
    lines: r.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, stockAfter: l.stockAfter, ...(showCost ? { unitCost: l.unitCost, lineCost: l.lineCost } : {}) })),
    attachments: (r.attachments || []).map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
  };
}

// GET /api/stock-receipts?from=&to=&supplierId=&q= — deliveries, newest first
stockReceiptsRouter.get("/", canRead, requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  const { from, to, supplierId, q } = req.query;
  if (DAY.test(from || "") || DAY.test(to || "")) {
    filter.receivedOn = {};
    if (DAY.test(from || "")) filter.receivedOn.$gte = from;
    if (DAY.test(to || "")) filter.receivedOn.$lte = to;
  }
  if (supplierId && mongoose.isValidObjectId(supplierId)) filter.supplierId = supplierId;
  const term = escapeRegex(q);
  if (term) {
    const rx = new RegExp(term, "i");
    filter.$or = [{ receiptNo: rx }, { reference: rx }, { supplierName: rx }, { note: rx }, { "lines.name": rx }];
  }
  const rows = await StockReceipt.find(filter).sort({ receivedOn: -1, createdAt: -1 }).limit(300);
  const showCost = canSeeCost(req.ctx);
  res.json({ receipts: rows.map((r) => shape(r, showCost)) });
});

// GET /api/stock-receipts/template.xlsx — a delivery sheet listing this store's products, quantity column blank
stockReceiptsRouter.get("/template.xlsx", requirePerm("stock_in"), requireFeature("csvImport"), requireBranch, async (req, res) => {
  const products = await Product.find(scopedToBranch(req.ctx, { businessId: req.ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } }))
    .select("name sku barcode cost").sort({ name: 1 }).lean();
  const inv = await Inventory.find({ branchId: req.ctx.branchId }).select("productId stock").lean();
  const stockOf = new Map(inv.map((i) => [String(i.productId), i.stock]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "StarTrack";
  const ws = wb.addWorksheet("Delivery", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Product", key: "name", width: 34 },
    { header: "SKU", key: "sku", width: 14 },
    { header: "Barcode", key: "barcode", width: 18 },
    { header: "In stock now", key: "stock", width: 14 },
    { header: "Quantity received", key: "qty", width: 18 },
    { header: "Unit cost", key: "cost", width: 14 },
  ];
  for (const p of products) ws.addRow({ name: p.name, sku: p.sku || "", barcode: p.barcode || "", stock: stockOf.get(String(p._id)) ?? 0, qty: null, cost: null });
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((c, i) => {
    const fill = i === 5 || i === 6 ? "FF0F9F6E" : "FF3538F0";
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.alignment = { vertical: "middle" };
  });
  const help = wb.addWorksheet("How to fill it");
  help.getColumn(1).width = 100;
  [
    "Fill in \"Quantity received\" for each product in this delivery. Leave it empty for products that did not come.",
    "\"Unit cost\" is optional: what this delivery cost you per unit. It updates the product's average cost.",
    "Do not change the Product, SKU or Barcode columns: they are how each row is matched to your catalog.",
    "Upload the file on the Stock In page. You will see every line before anything is received.",
    "Quantities are ADDED to what is already in stock. Nothing is overwritten.",
  ].forEach((t) => help.addRow([t]));

  const buf = await wb.xlsx.writeBuffer();
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="delivery-template.xlsx"',
    "Cache-Control": "no-store",
  });
  res.send(Buffer.from(buf));
});

const SPEC = {
  name: ["product", "name", "product name", "item", "item name", "description"],
  sku: ["sku", "code", "item code", "product code"],
  barcode: ["barcode", "upc", "ean"],
  quantity: ["quantity received", "qty received", "received", "quantity", "qty", "units", "delivered"],
  cost: ["unit cost", "cost", "cost price", "buying price", "purchase price", "price"],
};

// POST /api/stock-receipts/parse (multipart "file") — read a delivery spreadsheet into form lines.
// Receives nothing: it says which rows matched which product, and what is wrong with the rest.
stockReceiptsRouter.post("/parse", requirePerm("stock_in"), requireFeature("csvImport"), requireBranch, sheetUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "invalid", message: "Choose a spreadsheet (Excel or CSV) to upload." });
  let parsed;
  try {
    parsed = await parseUpload(req.file.buffer, req.file.originalname, { maxRows: 2000 });
  } catch (err) {
    if (err instanceof UploadError) return res.status(400).json({ error: "bad_file", message: err.message });
    throw err;
  }
  const table = bestTable(parsed.tables, SPEC);
  const mapping = { ...guessColumns(table.headers, SPEC), ...cleanMapping(req.body.mapping, table.headers, SPEC) };
  if (!mapping.quantity || !(mapping.name || mapping.sku || mapping.barcode)) {
    return res.status(422).json({ error: "no_columns", message: "The sheet needs a quantity column and one that names each product (name, SKU or barcode). The template has both." });
  }

  const catalog = await Product.find(scopedToBranch(req.ctx, { businessId: req.ctx.businessId, status: "active", archetype: { $ne: "made_to_order" } })).select("name sku barcode");
  const by = { sku: new Map(), barcode: new Map(), name: new Map() };
  for (const p of catalog) {
    if (p.sku) by.sku.set(normKey(p.sku), p);
    if (p.barcode) by.barcode.set(normKey(p.barcode), p);
    by.name.set(normKey(p.name), p);
  }
  const cell = (row, f) => (mapping[f] ? row[mapping[f]] : "");
  const lines = [];
  const problems = [];
  const index = new Map();
  let skipped = 0;
  for (const row of table.rows) {
    const rawQty = String(cell(row, "quantity") ?? "").trim();
    if (!rawQty) { skipped++; continue; } // a product that didn't come in this delivery
    const label = String(cell(row, "name") || cell(row, "sku") || cell(row, "barcode") || "").trim() || `row ${row.__row}`;
    const qty = parseCount(rawQty);
    if (qty === null || !Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) { problems.push({ row: row.__row, reason: `${label}: "${rawQty}" isn't a whole number above zero` }); continue; }
    const product = by.sku.get(normKey(cell(row, "sku"))) || by.barcode.get(normKey(cell(row, "barcode"))) || by.name.get(normKey(cell(row, "name")));
    if (!product) { problems.push({ row: row.__row, reason: `${label} isn't in your catalog. Add it as a product first.` }); continue; }
    const costRaw = String(cell(row, "cost") ?? "").trim();
    const cost = costRaw ? parseMoney(costRaw) : null;
    if (costRaw && (cost === null || cost < 0)) { problems.push({ row: row.__row, reason: `${product.name}: "${costRaw}" isn't a valid cost` }); continue; }
    const key = String(product._id);
    if (index.has(key)) {
      // Listed twice: add the quantities together, and say so.
      const l = lines[index.get(key)];
      l.qty += qty;
      problems.push({ row: row.__row, reason: `${product.name} appears more than once. The quantities were added together (${l.qty}).`, warning: true });
      continue;
    }
    index.set(key, lines.length);
    lines.push({ productId: product._id, name: product.name, qty, unitCost: cost });
  }
  res.json({
    fileName: req.file.originalname, sheet: table.name,
    lines, problems: problems.slice(0, 50), skipped,
    totals: { rows: table.rows.length, matched: lines.length, errors: problems.filter((p) => !p.warning).length },
  });
});

// GET /api/stock-receipts/:id
stockReceiptsRouter.get("/:id", canRead, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "not_found", message: "Delivery not found." });
  const r = await StockReceipt.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!r) return res.status(404).json({ error: "not_found", message: "Delivery not found." });
  res.json({ receipt: shape(r, canSeeCost(req.ctx)) });
});

// POST /api/stock-receipts/:id/attachments (multipart "file") — the supplier's invoice or delivery note
stockReceiptsRouter.post("/:id/attachments", requirePerm("stock_in"), (req, res, next) => {
  docUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: "invalid", message: err.code === "LIMIT_FILE_SIZE" ? "That file is over 3 MB." : "That file couldn't be read." });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "invalid", message: "Attach a photo (JPG, PNG, WEBP) or a PDF." });
  const r = await StockReceipt.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!r) return res.status(404).json({ error: "not_found", message: "Delivery not found." });
  if ((r.attachments || []).length >= MAX_FILES) return res.status(400).json({ error: "invalid", message: `A delivery can have up to ${MAX_FILES} files.` });
  const file = await FileDoc.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, ownerType: "stock_receipt", ownerId: r._id,
    name: String(req.file.originalname || "file").slice(0, 120), mime: req.file.mimetype, size: req.file.size, data: req.file.buffer,
  });
  r.attachments.push({ id: file._id, name: file.name, mime: file.mime, size: file.size });
  await r.save();
  res.status(201).json({ receipt: shape(r, canSeeCost(req.ctx)) });
});

// GET /api/stock-receipts/:id/attachments/:fileId
stockReceiptsRouter.get("/:id/attachments/:fileId", canRead, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.fileId) || !mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "not_found", message: "File not found." });
  const file = await FileDoc.findOne({ _id: req.params.fileId, ownerType: "stock_receipt", ownerId: req.params.id, businessId: req.ctx.businessId });
  if (!file) return res.status(404).json({ error: "not_found", message: "File not found." });
  res.set({
    "Content-Type": file.mime, "Content-Length": file.size,
    "Content-Disposition": `inline; filename="${file.name.replace(/[^\w.\- ]/g, "_")}"`,
    "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
  });
  res.send(file.data);
});
