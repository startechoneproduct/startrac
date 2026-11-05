import { Product } from "#modules/products/product.model.js";
import { Course } from "#modules/businesses/academy/course.model.js";
import { SalonService } from "#modules/businesses/salon/salonService.model.js";
import { GymPlan } from "#modules/businesses/gym/gymPlan.model.js";
import { openStockInBulk } from "#modules/inventory/inventory.service.js";
import { scopedToBranch, ownerBranchForNew } from "#core/branchScope.js";
import { typeTemplate, hasCapability } from "#shared/businessTypes.js";
import { money } from "#core/money.js";
import {
  normKey, clean, parseMoney, parseCount, parseBool, parseCode, parseDate, normalizeUnit,
  parseWeeks, parseMinutes, parseDays, pick,
} from "#modules/imports/values.js";

/**
 * What a spreadsheet can be turned into, per trade.
 *
 * A "target" is one catalog the business keeps: products everywhere, plus the
 * trade's own list — courses for an academy, a service menu for a salon,
 * membership plans for a gym. Each target knows
 *   - which columns it looks for (and the many names people give them),
 *   - how to clean a row according to THIS trade's rules,
 *   - what counts as a duplicate, and
 *   - how to create the rows.
 *
 * Nothing here writes until executeImport() runs, and that only runs after a
 * person approves the preview.
 */

const MAX_NOTE_EXAMPLES = 3;

// ── Field definitions ────────────────────────────────────────────────
// `hints` are normalised header names (see normKey). `exclude` rejects a header
// that merely contains a hint ("Supplier name" is not the item's name).
const F = (key, label, hints, { required = false, exclude = null } = {}) => ({ key, label, hints, required, exclude: exclude ? new RegExp(exclude) : null });

const PRODUCT_FIELDS = [
  F("name", "Name", ["name", "productname", "product", "item", "itemname", "description", "itemdescription", "title", "menuitem", "dish", "goods", "particulars", "article", "itemdesc", "productdescription", "menu", "stockitem"], { required: true, exclude: "(supplier|vendor|customer|manufacturer|brand|categor|group|code|number|qty|quantity|price|cost|date|no$|num$|id$)" }),
  F("price", "Selling price", ["price", "sellingprice", "saleprice", "unitprice", "retailprice", "sp", "rate", "mrp", "sellprice", "pricengn", "salesprice", "itemprice", "priceeach", "retail", "selling"], { required: true, exclude: "(cost|buy|purchase|wholesale|supplier|total|discount|old)" }),
  F("category", "Category", ["category", "categories", "type", "group", "department", "class", "section", "productcategory", "itemgroup", "itemcategory", "family", "classification"], { exclude: "(price|cost)" }),
  F("cost", "Cost price", ["cost", "costprice", "buyingprice", "purchaseprice", "cp", "unitcost", "buyprice", "landedcost", "wholesaleprice", "purchasecost", "buying"], { exclude: "(sell|retail|total)" }),
  F("stock", "Opening stock", ["stock", "qty", "quantity", "openingstock", "instock", "stockonhand", "onhand", "balance", "qtyinstock", "currentstock", "available", "quantityonhand", "openingqty", "opening", "stocklevel", "inventory", "remaining", "qtyonhand", "portions", "portionsready", "portionsavailable", "inhand", "qtyavailable", "unitsinstock", "noofitems", "pieces", "numberinstock", "currentqty", "stockqty", "countinstock"], { exclude: "(reorder|min|max|sold|price|cost|value)" }),
  F("barcode", "Barcode", ["barcode", "upc", "ean", "gtin", "barcodeno", "scancode", "barcodenumber"]),
  F("sku", "SKU / code", ["sku", "itemcode", "productcode", "code", "ref", "reference", "partno", "partnumber", "itemno", "productno", "stockcode", "skucode"]),
  F("unit", "Unit", ["unit", "uom", "unitofmeasure", "measure", "packaging", "unittype", "soldin", "sellingunit"], { exclude: "(price|cost|stock|qty|quantity)" }),
  F("reorderLevel", "Reorder level", ["reorderlevel", "reorderpoint", "minstock", "minimumstock", "minqty", "lowstock", "lowstocklevel", "threshold", "reorderqty", "minlevel", "minimum", "safetystock", "alertlevel"]),
  F("expiry", "Expiry date", ["expiry", "expirydate", "expdate", "exp", "expires", "bestbefore", "expiration", "expirationdate", "useby", "expiredate"]),
];
// Only trades that serialise stock look for these.
const SERIAL_FIELDS = [
  F("tracksSerials", "Track serial numbers", ["trackserial", "serialtracking", "serialized", "serialised", "tracksserials", "hasserial"]),
  F("warrantyMonths", "Warranty (months)", ["warranty", "warrantymonths", "warrantyperiod", "guarantee"]),
];

const COURSE_FIELDS = [
  F("name", "Course name", ["course", "coursename", "name", "program", "programme", "title", "subject", "coursetitle", "module"], { required: true, exclude: "(code|id$|number|tutor|instructor|fee|price)" }),
  F("fee", "Fee", ["fee", "fees", "price", "tuition", "cost", "amount", "coursefee", "tuitionfee", "charge", "rate"], { required: true }),
  F("category", "Track / category", ["category", "track", "department", "area", "field", "school", "faculty", "stream", "discipline"]),
  F("level", "Level", ["level", "difficulty", "stage", "grade"]),
  F("mode", "Mode", ["mode", "delivery", "format", "deliverymode", "medium", "classtype"]),
  F("durationWeeks", "Duration", ["duration", "durationweeks", "weeks", "length", "period", "courselength", "timeline", "term"]),
  F("description", "Description", ["description", "details", "about", "summary", "outline", "overview", "synopsis", "content", "curriculum", "topics"]),
];

const SERVICE_FIELDS = [
  F("name", "Service", ["service", "servicename", "name", "treatment", "style", "title", "item", "description"], { required: true, exclude: "(price|cost|fee|time|duration|category|code)" }),
  F("price", "Price", ["price", "cost", "fee", "rate", "amount", "charge", "pricengn"], { required: true }),
  F("durationMins", "Duration", ["duration", "durationmins", "minutes", "mins", "time", "length", "timetaken", "timerequired", "durationminutes"]),
  F("category", "Category", ["category", "type", "group", "department", "section"]),
];

const PLAN_FIELDS = [
  F("name", "Plan", ["plan", "planname", "membership", "membershiptype", "name", "package", "tier", "title", "subscription"], { required: true, exclude: "(price|fee|cost|duration|days)" }),
  F("price", "Price", ["price", "fee", "cost", "rate", "amount", "charge", "membershipfee"], { required: true }),
  F("durationDays", "Duration", ["duration", "durationdays", "days", "validity", "period", "length", "term", "validfor", "billingcycle", "cycle"]),
  F("description", "Description", ["description", "details", "includes", "benefits", "notes", "features"]),
];

// ── Column guessing ──────────────────────────────────────────────────
/** Matches headers to fields by how people usually name them. */
export function guessMapping(fields, headers) {
  const candidates = [];
  for (const f of fields) {
    for (const h of headers) {
      const k = normKey(h);
      if (!k || (f.exclude && f.exclude.test(k))) continue;
      let score = 0;
      if (f.hints.includes(k)) score = 100;
      else {
        for (const hint of f.hints) {
          if (hint.length < 4) continue;
          if (k.startsWith(hint) || k.endsWith(hint)) score = Math.max(score, 60);
          else if (k.includes(hint)) score = Math.max(score, 40);
        }
      }
      if (score) candidates.push({ field: f.key, header: h, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const mapping = {};
  const used = new Set();
  for (const c of candidates) {
    if (mapping[c.field] || used.has(c.header)) continue;
    mapping[c.field] = c.header;
    used.add(c.header);
  }
  return mapping;
}

// When no column is called "name", the item list is the text-heavy column.
export function guessNameColumn(rows, headers, taken) {
  let best = null;
  for (const h of headers) {
    if (taken.has(h)) continue;
    const vals = rows.slice(0, 60).map((r) => r[h]).filter((v) => typeof v === "string" && v.trim());
    if (vals.length < Math.max(2, rows.slice(0, 60).length * 0.6)) continue;
    const distinct = new Set(vals.map((v) => v.toLowerCase())).size / vals.length;
    const score = distinct * 100 + Math.min(vals.reduce((n, v) => n + v.length, 0) / vals.length, 40);
    if (distinct > 0.7 && (!best || score > best.score)) best = { h, score };
  }
  return best?.h || null;
}

// ── Helpers shared by the targets ────────────────────────────────────
const cell = (row, mapping, key) => (mapping[key] ? row[mapping[key]] : undefined);
const isEmpty = (v) => v === undefined || v === null || v === "";

function escapeSku(prefix) {
  return (prefix || "GEN").toUpperCase();
}

// SKUs are generated, never typed — unique within this batch and in the database.
async function freshSkus(businessId, prefix, count) {
  const out = [];
  const used = new Set();
  const p = escapeSku(prefix);
  while (out.length < count) {
    const batch = [];
    while (batch.length < count - out.length) {
      const c = `${p}-${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0")}`;
      if (!used.has(c)) { used.add(c); batch.push(c); }
    }
    const taken = new Set((await Product.find({ businessId, sku: { $in: batch } }).select("sku")).map((x) => x.sku));
    out.push(...batch.filter((c) => !taken.has(c)));
  }
  return out;
}

const uniqueList = (list) => [...new Set(list)];

// ── Targets ──────────────────────────────────────────────────────────
const TARGETS = {
  products: {
    key: "products",
    perm: "products_add",
    available: () => true,
    label: (tpl) => tpl.terminology?.products || "Products",
    singular: "item",
    fields: (ctx) => (hasCapability(ctx.business?.typeKey, "serials") ? [...PRODUCT_FIELDS, ...SERIAL_FIELDS] : PRODUCT_FIELDS),
    columns: [
      { key: "name", label: "Name", format: "text" },
      { key: "category", label: "Category", format: "text" },
      { key: "price", label: "Price", format: "money", align: "right" },
      { key: "stockText", label: "Stock", format: "text", align: "right" },
    ],
    sample: ["Name", "Category", "Selling Price", "Cost Price", "Opening Stock", "Barcode", "Unit", "Reorder Level", "Expiry Date"],
    sampleRows: [["Example item", "Groceries", 1500, 1100, 24, "", "unit", 5, ""]],

    // One spreadsheet row → a clean product, or a reason it can't be one.
    normalize(raw, mapping, env) {
      const { tpl, categoriesLower, ignoreStock, serials } = env;
      const notes = [];
      const name = clean(cell(raw, mapping, "name"), 120);
      if (!name) return { error: "No name" };

      const price = parseMoney(cell(raw, mapping, "price"));
      if (price === null || price < 0) return { name, error: isEmpty(cell(raw, mapping, "price")) ? "No selling price" : "The price isn't a number" };

      let cost = parseMoney(cell(raw, mapping, "cost"));
      if (cost === null || cost < 0) cost = 0;
      if (cost > price && price > 0) notes.push("Cost is higher than the selling price");

      let category = clean(cell(raw, mapping, "category"), 60);
      if (!category) category = "General";
      else {
        const known = categoriesLower.get(category.toLowerCase());
        if (known) category = known; // keep the trade's / catalog's own spelling
      }

      const unitRaw = cell(raw, mapping, "unit");
      let { unit, note } = normalizeUnit(unitRaw, tpl.allowedUnits || []);
      if (note) notes.push(note);
      // Poultry: a "bird" only exists as a layer or a broiler.
      if (unit === "bird" && !/^(layer|broiler)s?$/i.test(category)) {
        unit = (tpl.allowedUnits || []).includes("unit") ? "unit" : unit;
        notes.push(`“bird” needs a layer or broiler category — set to “${unit}”`);
      } else if (unit === "bird") category = category.toLowerCase().startsWith("layer") ? "layer" : "broiler";

      let stock = parseCount(cell(raw, mapping, "stock"));
      if (stock === null || stock < 0) stock = 0;
      if (!Number.isInteger(stock)) { stock = Math.round(stock); notes.push("Stock was rounded to a whole number"); }
      if (ignoreStock && stock > 0) { notes.push("Stock comes in through batches in this trade"); stock = 0; }

      let reorderLevel = parseCount(cell(raw, mapping, "reorderLevel"));
      reorderLevel = reorderLevel === null || reorderLevel < 0 ? 5 : Math.round(reorderLevel);

      const expiryRaw = cell(raw, mapping, "expiry");
      let expiry = null;
      if (!isEmpty(expiryRaw)) {
        expiry = parseDate(expiryRaw);
        if (!expiry) notes.push("The expiry date wasn't a date, so it was left blank");
      }

      const data = {
        name, category, price: money(price), cost: money(cost), stock, unit, reorderLevel,
        barcode: parseCode(cell(raw, mapping, "barcode")),
        sku: clean(cell(raw, mapping, "sku"), 40),
        expiry: expiry ? expiry.toISOString() : "",
      };
      if (serials) {
        const track = parseBool(cell(raw, mapping, "tracksSerials"));
        const warranty = parseCount(cell(raw, mapping, "warrantyMonths"));
        data.tracksSerials = !!track;
        data.warrantyMonths = track && warranty && warranty > 0 ? Math.min(Math.round(warranty), 600) : 0;
      }
      data.stockText = ignoreStock ? "—" : `${stock}${unit && unit !== "unit" ? ` ${unit}` : ""}`;
      return { data, notes };
    },

    keys: (d) => [`n:${normKey(d.name)}`, ...(d.barcode ? [`b:${d.barcode}`] : []), ...(d.sku ? [`s:${normKey(d.sku)}`] : [])],
    async existing(ctx) {
      const rows = await Product.find(scopedToBranch(ctx, { businessId: ctx.businessId, status: "active" })).select("name barcode sku").limit(50000);
      const map = new Map();
      for (const p of rows) {
        map.set(`n:${normKey(p.name)}`, p.name);
        if (p.barcode) map.set(`b:${p.barcode}`, p.name);
        if (p.sku) map.set(`s:${normKey(p.sku)}`, p.name);
      }
      return map;
    },
    async env(ctx) {
      const tpl = typeTemplate(ctx.business?.typeKey);
      const categoriesLower = new Map((tpl.defaultCategories || []).map((c) => [c.toLowerCase(), c]));
      const have = await Product.distinct("category", scopedToBranch(ctx, { businessId: ctx.businessId, status: "active" }));
      for (const c of have) if (c) categoriesLower.set(String(c).toLowerCase(), c);
      return {
        tpl, categoriesLower,
        // Cold-room stock is cartons and weights tracked in batches; a bare
        // number from a spreadsheet would put the ledger out of step.
        ignoreStock: hasCapability(ctx.business?.typeKey, "coldChain"),
        serials: hasCapability(ctx.business?.typeKey, "serials"),
      };
    },

    async create(ctx, rows, branchId) {
      const tpl = typeTemplate(ctx.business?.typeKey);
      const owner = await ownerBranchForNew(ctx);
      const skus = await freshSkus(ctx.businessId, tpl.skuPrefix, rows.length);
      const docs = rows.map((d, i) => {
        const wantsSku = d.sku && !skus.includes(d.sku);
        return {
          accountId: ctx.accountId, businessId: ctx.businessId, branchId: owner,
          name: d.name, sku: wantsSku ? d.sku : skus[i], barcode: d.barcode || "", category: d.category,
          price: d.price, cost: d.cost, reorderLevel: d.reorderLevel, unit: d.unit,
          expiry: d.expiry ? new Date(d.expiry) : undefined,
          tracksSerials: !!d.tracksSerials, warrantyMonths: d.warrantyMonths || 0,
        };
      });
      let created;
      try {
        created = await Product.insertMany(docs, { ordered: false });
      } catch (err) {
        // A clash we didn't foresee (e.g. a typed SKU): keep what landed.
        created = err.insertedDocs || [];
        if (!created.length && !err.writeErrors) throw err;
      }
      let stocked = 0;
      if (branchId) {
        const stockBy = new Map(rows.map((d) => [d.name, d.stock]));
        stocked = await openStockInBulk(ctx, {
          branchId,
          reason: "Spreadsheet import — opening stock",
          items: created.map((p) => ({ productId: p._id, productName: p.name, qty: stockBy.get(p.name) || 0 })),
        });
      }
      return { created: created.length, detail: stocked ? `${stocked} with opening stock` : "" };
    },
  },

  courses: {
    key: "courses",
    perm: "prices",
    available: (ctx) => hasCapability(ctx.business?.typeKey, "programs"),
    label: () => "Courses",
    singular: "course",
    fields: () => COURSE_FIELDS,
    columns: [
      { key: "name", label: "Course", format: "text" },
      { key: "category", label: "Track", format: "text" },
      { key: "fee", label: "Fee", format: "money", align: "right" },
      { key: "weeksText", label: "Duration", format: "text", align: "right" },
      { key: "level", label: "Level", format: "text" },
    ],
    sample: ["Course", "Track", "Fee", "Duration (weeks)", "Level", "Mode", "Description"],
    sampleRows: [["Fullstack Web Development", "Web", 150000, 16, "Beginner", "Hybrid", "HTML to deployment"]],

    normalize(raw, mapping) {
      const notes = [];
      const name = clean(cell(raw, mapping, "name"), 120);
      if (name.length < 2) return { error: "No course name" };
      const fee = parseMoney(cell(raw, mapping, "fee"));
      if (fee === null || fee < 0) return { name, error: isEmpty(cell(raw, mapping, "fee")) ? "No fee" : "The fee isn't a number" };

      const levelRaw = cell(raw, mapping, "level");
      const level = pick(levelRaw, { beginner: ["begin", "basic", "intro", "novice", "entry", "level1", "starter", "junior"], intermediate: ["inter", "mid", "level2", "medium"], advanced: ["advan", "expert", "pro", "senior", "level3", "master"] }) || "beginner";
      if (!isEmpty(levelRaw) && !pick(levelRaw, { x: ["begin", "basic", "intro", "novice", "entry", "level1", "starter", "junior", "inter", "mid", "level2", "medium", "advan", "expert", "pro", "senior", "level3", "master"] })) notes.push(`Level “${clean(levelRaw, 20)}” wasn't recognised — set to beginner`);
      const modeRaw = cell(raw, mapping, "mode");
      const mode = pick(modeRaw, { online: ["online", "virtual", "remote", "zoom", "elearn", "web"], physical: ["physical", "onsite", "inperson", "offline", "classroom", "campus", "onground"], hybrid: ["hybrid", "blend", "both", "mixed"] }) || "hybrid";

      let weeks = parseWeeks(cell(raw, mapping, "durationWeeks"));
      if (weeks === null) {
        weeks = 4;
        if (!isEmpty(cell(raw, mapping, "durationWeeks"))) notes.push("The duration wasn't clear — set to 4 weeks");
      }
      weeks = Math.min(weeks, 260);
      const category = clean(cell(raw, mapping, "category"), 60) || "General";
      const data = {
        name, category, fee: money(fee), level, mode, durationWeeks: weeks,
        description: clean(cell(raw, mapping, "description"), 1000),
      };
      data.weeksText = `${weeks} wk${weeks === 1 ? "" : "s"}`;
      return { data, notes };
    },
    keys: (d) => [`n:${normKey(d.name)}`],
    async existing(ctx) {
      const rows = await Course.find({ businessId: ctx.businessId }).select("name");
      return new Map(rows.map((c) => [`n:${normKey(c.name)}`, c.name]));
    },
    async env() { return {}; },
    async create(ctx, rows) {
      const docs = rows.map((d) => ({ accountId: ctx.accountId, businessId: ctx.businessId, name: d.name, category: d.category, level: d.level, mode: d.mode, durationWeeks: d.durationWeeks, fee: d.fee, description: d.description }));
      const created = await Course.insertMany(docs, { ordered: false });
      return { created: created.length, detail: "" };
    },
  },

  salon_services: {
    key: "salon_services",
    perm: "prices",
    available: (ctx) => hasCapability(ctx.business?.typeKey, "appointments"),
    label: () => "Services",
    singular: "service",
    fields: () => SERVICE_FIELDS,
    columns: [
      { key: "name", label: "Service", format: "text" },
      { key: "category", label: "Category", format: "text" },
      { key: "price", label: "Price", format: "money", align: "right" },
      { key: "minsText", label: "Takes", format: "text", align: "right" },
    ],
    sample: ["Service", "Category", "Price", "Duration (minutes)"],
    sampleRows: [["Haircut & beard trim", "Barbing", 3500, 45]],

    normalize(raw, mapping) {
      const notes = [];
      const name = clean(cell(raw, mapping, "name"), 120);
      if (!name) return { error: "No service name" };
      const price = parseMoney(cell(raw, mapping, "price"));
      if (price === null || price < 0) return { name, error: isEmpty(cell(raw, mapping, "price")) ? "No price" : "The price isn't a number" };
      let mins = parseMinutes(cell(raw, mapping, "durationMins"));
      if (mins === null) {
        mins = 30;
        notes.push("No duration given — set to 30 minutes");
      }
      // A booking needs at least 5 minutes and at most 12 hours.
      const clamped = Math.min(720, Math.max(5, mins));
      if (clamped !== mins) notes.push(`Duration adjusted to ${clamped} minutes (allowed: 5–720)`);
      const data = { name, category: clean(cell(raw, mapping, "category"), 60) || "General", price: money(price), durationMins: clamped };
      data.minsText = clamped >= 60 && clamped % 60 === 0 ? `${clamped / 60} hr` : `${clamped} min`;
      return { data, notes };
    },
    keys: (d) => [`n:${normKey(d.name)}`],
    async existing(ctx) {
      const rows = await SalonService.find({ businessId: ctx.businessId }).select("name");
      return new Map(rows.map((c) => [`n:${normKey(c.name)}`, c.name]));
    },
    async env() { return {}; },
    async create(ctx, rows) {
      const docs = rows.map((d) => ({ accountId: ctx.accountId, businessId: ctx.businessId, name: d.name, category: d.category, price: d.price, durationMins: d.durationMins }));
      const created = await SalonService.insertMany(docs, { ordered: false });
      return { created: created.length, detail: "" };
    },
  },

  gym_plans: {
    key: "gym_plans",
    perm: "prices",
    available: (ctx) => hasCapability(ctx.business?.typeKey, "memberships"),
    label: () => "Membership plans",
    singular: "plan",
    fields: () => PLAN_FIELDS,
    columns: [
      { key: "name", label: "Plan", format: "text" },
      { key: "price", label: "Price", format: "money", align: "right" },
      { key: "daysText", label: "Lasts", format: "text", align: "right" },
      { key: "description", label: "Includes", format: "text" },
    ],
    sample: ["Plan", "Price", "Duration (days)", "Description"],
    sampleRows: [["Monthly", 25000, 30, "Gym floor access"]],

    normalize(raw, mapping) {
      const notes = [];
      const name = clean(cell(raw, mapping, "name"), 120);
      if (!name) return { error: "No plan name" };
      const price = parseMoney(cell(raw, mapping, "price"));
      if (price === null || price < 0) return { name, error: isEmpty(cell(raw, mapping, "price")) ? "No price" : "The price isn't a number" };
      let days = parseDays(cell(raw, mapping, "durationDays"));
      if (days === null) {
        days = parseDays(name); // "Quarterly plan", "3 Months"
        if (days === null) { days = 30; notes.push("No length given — set to 30 days"); }
      }
      const data = { name, price: money(price), durationDays: Math.min(days, 3650), description: clean(cell(raw, mapping, "description"), 500) };
      data.daysText = `${data.durationDays} day${data.durationDays === 1 ? "" : "s"}`;
      return { data, notes };
    },
    keys: (d) => [`n:${normKey(d.name)}`],
    async existing(ctx) {
      const rows = await GymPlan.find({ businessId: ctx.businessId, active: true }).select("name");
      return new Map(rows.map((c) => [`n:${normKey(c.name)}`, c.name]));
    },
    async env() { return {}; },
    async create(ctx, rows) {
      const docs = rows.map((d) => ({ accountId: ctx.accountId, businessId: ctx.businessId, name: d.name, description: d.description, price: d.price, durationDays: d.durationDays }));
      const created = await GymPlan.insertMany(docs, { ordered: false });
      return { created: created.length, detail: "" };
    },
  },
};

export const TARGET_KEYS = Object.keys(TARGETS);
export const getTarget = (key) => TARGETS[key] || null;

/** The catalogs this person can fill from a spreadsheet, in this business. */
export function targetsFor(ctx) {
  const can = (p) => ctx.perms.includes("*") || ctx.perms.includes(p);
  const tpl = typeTemplate(ctx.business?.typeKey);
  return Object.values(TARGETS)
    .filter((t) => t.available(ctx) && can(t.perm))
    .map((t) => ({ spec: t, label: t.label(tpl), fields: t.fields(ctx) }));
}

/** The one a trade means by default when it says "my list". */
export function primaryTarget(ctx) {
  const t = typeTemplate(ctx.business?.typeKey);
  const caps = t.capabilities || [];
  return caps.includes("programs") ? "courses" : caps.includes("appointments") ? "salon_services" : caps.includes("memberships") ? "gym_plans" : "products";
}

// ── Building the preview ─────────────────────────────────────────────

/**
 * Cleans every row, then sorts them into: to create, already there, repeated
 * in the file, and can't use. `existing` is the catalog as it is right now.
 */
export async function splitRows(ctx, spec, rows, mapping, existing, env) {
  const create = [];
  const duplicates = [];
  const issues = [];
  const noteCounts = new Map();
  const seen = new Map(); // key -> first name in this file

  for (const raw of rows) {
    const rowNo = raw.__row;
    const res = spec.normalize(raw, mapping, env);
    if (res.error) {
      issues.push({ row: rowNo, name: res.name || "", reason: res.error });
      continue;
    }
    const keys = spec.keys(res.data);
    const hitExisting = keys.find((k) => existing.has(k));
    if (hitExisting) {
      duplicates.push({ row: rowNo, name: res.data.name, reason: `Already ${spec.key === "products" ? "in your catalog" : "on your list"} as “${existing.get(hitExisting)}”${hitExisting.startsWith("b:") ? " (same barcode)" : ""}` });
      continue;
    }
    const hitFile = keys.find((k) => seen.has(k));
    if (hitFile) {
      duplicates.push({ row: rowNo, name: res.data.name, reason: `Repeated in the file — “${seen.get(hitFile)}” (kept the first)${hitFile.startsWith("b:") ? ", same barcode" : ""}` });
      continue;
    }
    keys.forEach((k) => seen.set(k, res.data.name));
    create.push({ ...res.data, __row: rowNo });
    for (const n of res.notes || []) {
      const e = noteCounts.get(n) || { count: 0, examples: [] };
      e.count++;
      if (e.examples.length < MAX_NOTE_EXAMPLES) e.examples.push(res.data.name);
      noteCounts.set(n, e);
    }
  }
  const notes = [...noteCounts.entries()].map(([text, e]) => ({ text, count: e.count, examples: e.examples }));
  return { create, duplicates, issues, notes };
}

/**
 * Runs an approved import. The duplicate check is repeated against the data as
 * it is NOW — the preview may be hours old, and a product added meanwhile must
 * not be created twice.
 */
export async function executeImport(ctx, action) {
  const p = action.payload;
  const spec = TARGETS[p.target];
  if (!spec || !spec.available(ctx)) throw new Error("That kind of import isn't available for this business.");
  const existing = await spec.existing(ctx);
  const seen = new Set();
  const fresh = [];
  let skipped = 0;
  for (const row of p.rows) {
    const keys = spec.keys(row);
    if (keys.some((k) => existing.has(k) || seen.has(k))) { skipped++; continue; }
    keys.forEach((k) => seen.add(k));
    fresh.push(row);
  }
  if (!fresh.length) return { type: "import", id: action._id, label: "Nothing new to add — everything was already there", count: 0, skipped };
  const out = await spec.create(ctx, fresh, action.branchId);
  const noun = out.created === 1 ? spec.singular : `${spec.singular}s`;
  return {
    type: "import",
    id: action._id,
    label: `Added ${out.created} ${noun}${out.detail ? ` (${out.detail})` : ""}${skipped ? ` · ${skipped} skipped as already there` : ""}`,
    count: out.created,
    skipped,
  };
}

export { uniqueList };
