import { Router } from "express";
import { z } from "zod";
import { Room, RoomType, HOUSEKEEPING } from "#modules/businesses/hotel/room.model.js";
import { Stay } from "#modules/businesses/hotel/stay.model.js";
import { Product } from "#modules/products/product.model.js";
import { Sale } from "#modules/sales/sale.model.js";
import { Customer } from "#modules/customers/customer.model.js";
import { requirePerm, requireBranch, canSeeCost } from "#core/middleware/tenant.js";
import { applyMovement } from "#modules/inventory/inventory.service.js";
import { nextSeq } from "#core/counters.js";
import { bumpDailyMetric, localDay } from "#modules/metrics/metrics.service.js";
import { money } from "#core/money.js";
import { audit } from "#core/audit.js";
import { withTransaction } from "#core/tx.js";
import { badRequest, conflict, notFound } from "#core/httpError.js";
import { afterStockChange } from "#modules/alerts/alerts.service.js";
import { escapeRegex } from "#core/regex.js";
import {
  availabilityGrid, isRoomFree, validateRange, nightsIn, addDays,
  folioTotals, shapeStay,
} from "#modules/businesses/hotel/hotel.service.js";

export const hotelRouter = Router();

const today = () => new Date().toISOString().slice(0, 10);

// ── Rooms & room types ───────────────────────────────────────────────

hotelRouter.get("/rooms", requirePerm("sales", "dashboard_ops"), requireBranch, async (req, res) => {
  const [rooms, types] = await Promise.all([
    Room.find({ businessId: req.ctx.businessId, branchId: req.ctx.branchId }).sort({ number: 1 }).lean(),
    RoomType.find({ businessId: req.ctx.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
  ]);
  const byId = new Map(types.map((t) => [String(t._id), t]));
  res.json({
    rooms: rooms.map((r) => ({
      id: r._id, number: r.number, floor: r.floor, housekeeping: r.housekeeping, note: r.note,
      roomTypeId: r.roomTypeId,
      typeName: byId.get(String(r.roomTypeId))?.name || "",
      rate: byId.get(String(r.roomTypeId))?.rate ?? 0,
    })),
    roomTypes: types.map((t) => ({ id: t._id, name: t.name, rate: t.rate, capacity: t.capacity, amenities: t.amenities })),
  });
});

const typeSchema = z.object({
  name: z.string().min(1, "Name the room type"),
  rate: z.number().min(0),
  capacity: z.number().int().min(1).default(2),
  amenities: z.array(z.string()).default([]),
});

hotelRouter.post("/room-types", requirePerm("prices"), async (req, res) => {
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const exists = await RoomType.findOne({ businessId: req.ctx.businessId, name: parsed.data.name.trim() });
  if (exists) return res.status(409).json({ error: "taken", message: "That room type already exists." });
  const t = await RoomType.create({ accountId: req.ctx.accountId, businessId: req.ctx.businessId, ...parsed.data });
  res.status(201).json({ roomType: { id: t._id, name: t.name, rate: t.rate, capacity: t.capacity } });
});

const roomSchema = z.object({
  number: z.string().min(1, "Give the room a number"),
  roomTypeId: z.string(),
  floor: z.string().default(""),
  note: z.string().default(""),
});

hotelRouter.post("/rooms", requirePerm("prices"), requireBranch, async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const type = await RoomType.findOne({ _id: parsed.data.roomTypeId, businessId: req.ctx.businessId });
  if (!type) return res.status(400).json({ error: "invalid", message: "That room type doesn't exist." });
  const dupe = await Room.findOne({ businessId: req.ctx.businessId, branchId: req.ctx.branchId, number: parsed.data.number.trim() });
  if (dupe) return res.status(409).json({ error: "taken", message: `Room ${parsed.data.number} already exists.` });

  const room = await Room.create({
    accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
    ...parsed.data, number: parsed.data.number.trim(),
  });
  res.status(201).json({ room: { id: room._id, number: room.number, typeName: type.name, rate: type.rate } });
});

// PATCH /api/hotel/rooms/:id — housekeeping is the common edit
hotelRouter.patch("/rooms/:id", requirePerm("sales"), async (req, res) => {
  const room = await Room.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!room) return res.status(404).json({ error: "not_found", message: "Room not found." });
  const hk = req.body?.housekeeping;
  if (hk !== undefined) {
    if (!HOUSEKEEPING.includes(hk)) return res.status(400).json({ error: "invalid", message: "Unknown housekeeping state." });
    // An occupied room can't be taken out of service under the guest.
    if (hk === "out_of_service") {
      const occupied = await Stay.findOne({ businessId: req.ctx.businessId, roomId: room._id, status: "checked_in" });
      if (occupied) return res.status(409).json({ error: "occupied", message: `Room ${room.number} has a guest in it.` });
    }
    room.housekeeping = hk;
  }
  if (req.body?.note !== undefined) room.note = String(req.body.note);
  await room.save();
  res.json({ room: { id: room._id, number: room.number, housekeeping: room.housekeeping, note: room.note } });
});

// ── The heat map ─────────────────────────────────────────────────────

// GET /api/hotel/availability?from=&nights=
hotelRouter.get("/availability", requirePerm("sales", "dashboard_ops"), requireBranch, async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : today();
  const nights = Math.min(Math.max(Number(req.query.nights) || 14, 1), 60);
  const to = addDays(from, nights);
  const grid = await availabilityGrid(req.ctx.businessId, req.ctx.branchId, from, to);
  res.json({ from, to, ...grid });
});

// ── Stays ────────────────────────────────────────────────────────────

const bookSchema = z.object({
  roomId: z.string(),
  guestName: z.string().min(2, "Enter the guest's name"),
  guestPhone: z.string().default(""),
  guests: z.number().int().min(1).default(1),
  checkIn: z.string(),
  checkOut: z.string(),
  rate: z.number().min(0).optional(), // negotiated rate overrides the type's
  notes: z.string().default(""),
  checkInNow: z.boolean().default(false),
});

// POST /api/hotel/stays — book a room for a range
hotelRouter.post("/stays", requirePerm("sales"), requireBranch, async (req, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const stay = await withTransaction(async (session) => {
    const nights = validateRange(d.checkIn, d.checkOut);
    const room = await Room.findOne({ _id: d.roomId, businessId: req.ctx.businessId, branchId: req.ctx.branchId }).session(session);
    if (!room) throw badRequest("That room doesn't exist.");
    if (room.housekeeping === "out_of_service") throw conflict(`Room ${room.number} is out of service.`, "out_of_service");

    const { free, clash } = await isRoomFree(req.ctx.businessId, room._id, d.checkIn, d.checkOut);
    if (!free) {
      throw conflict(
        `Room ${room.number} is taken by ${clash.guestName} (${clash.checkIn} → ${clash.checkOut}).`,
        "room_taken"
      );
    }

    const type = await RoomType.findById(room.roomTypeId).session(session);
    const nightlyRate = d.rate !== undefined ? money(d.rate) : (type?.rate ?? 0);

    let customer = null;
    if (d.guestPhone) {
      customer =
        (await Customer.findOne({ businessId: req.ctx.businessId, phone: d.guestPhone }).session(session)) ||
        (await Customer.create([{
          accountId: req.ctx.accountId, businessId: req.ctx.businessId,
          name: d.guestName, phone: d.guestPhone, whatsapp: d.guestPhone,
        }], { session }))[0];
    }

    const seq = await nextSeq(`folio:${req.ctx.branchId}`, session);
    const [stay] = await Stay.create([{
      accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: req.ctx.branchId,
      folioNo: `F-${String(seq).padStart(5, "0")}`,
      roomId: room._id, roomNumber: room.number, roomTypeName: type?.name || "",
      guestName: d.guestName.trim(), guestPhone: d.guestPhone, customerId: customer?._id,
      guests: d.guests, checkIn: d.checkIn, checkOut: d.checkOut, nights, nightlyRate,
      status: d.checkInNow ? "checked_in" : "booked",
      checkedInAt: d.checkInNow ? new Date() : undefined,
      notes: d.notes,
      staffName: req.ctx.actorName,
      // Room nights are posted up front so the folio always shows what the
      // stay is worth, even before anything else is charged to it.
      charges: nightsIn(d.checkIn, d.checkOut).map((night) => ({
        at: new Date(), source: "room", name: `${room.number} · ${type?.name || "Room"} · ${night}`,
        qty: 1, unitPrice: nightlyRate, lineCost: 0, lineNet: nightlyRate,
        byName: req.ctx.actorName,
      })),
    }], { session });

    if (d.checkInNow) {
      room.housekeeping = "clean";
      await room.save({ session });
    }
    return stay;
  });

  audit(req.ctx, "hotel.book", { type: "stay", id: stay._id, label: stay.folioNo }, undefined, {
    room: stay.roomNumber, guest: stay.guestName, nights: stay.nights,
  });
  res.status(201).json({ stay: shapeStay(stay, req.ctx.business, canSeeCost(req.ctx)) });
});

// GET /api/hotel/stays?status=&q=
hotelRouter.get("/stays", requirePerm("sales", "dashboard_ops"), requireBranch, async (req, res) => {
  const filter = { businessId: req.ctx.businessId, branchId: req.ctx.branchId };
  if (req.query.status === "in_house") filter.status = "checked_in";
  else if (req.query.status === "open") filter.status = { $in: ["booked", "checked_in"] };
  else if (req.query.status) filter.status = String(req.query.status);
  if (req.query.arrivals === "1") { filter.status = "booked"; filter.checkIn = today(); }
  if (req.query.departures === "1") { filter.status = "checked_in"; filter.checkOut = today(); }
  if (req.query.q) {
    const rx = escapeRegex(req.query.q);
    filter.$or = [
      { folioNo: { $regex: rx, $options: "i" } },
      { guestName: { $regex: rx, $options: "i" } },
      { roomNumber: { $regex: rx, $options: "i" } },
    ];
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [stays, count] = await Promise.all([
    Stay.find(filter).sort({ checkIn: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Stay.countDocuments(filter),
  ]);

  const showCost = canSeeCost(req.ctx);
  res.json({
    stays: stays.map((s) => shapeStay(s, req.ctx.business, showCost)),
    page, pages: Math.max(1, Math.ceil(count / limit)), total: count,
  });
});

hotelRouter.get("/stays/:id", requirePerm("sales", "dashboard_ops"), async (req, res) => {
  const stay = await Stay.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!stay) return res.status(404).json({ error: "not_found", message: "Folio not found." });
  res.json({ stay: shapeStay(stay, req.ctx.business, canSeeCost(req.ctx)) });
});

// POST /api/hotel/stays/:id/check-in
hotelRouter.post("/stays/:id/check-in", requirePerm("sales"), async (req, res) => {
  const stay = await withTransaction(async (session) => {
    const stay = await Stay.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!stay) throw notFound("Folio not found.");
    if (stay.status === "checked_in") throw conflict("This guest is already checked in.", "already_in");
    if (stay.status !== "booked") throw conflict(`This stay is ${stay.status.replace("_", " ")}.`, "bad_status");
    stay.status = "checked_in";
    stay.checkedInAt = new Date();
    await stay.save({ session });
    await Room.updateOne({ _id: stay.roomId }, { $set: { housekeeping: "clean" } }, { session });
    return stay;
  });
  audit(req.ctx, "hotel.check_in", { type: "stay", id: stay._id, label: stay.folioNo }, undefined, { room: stay.roomNumber });
  res.json({ stay: shapeStay(stay, req.ctx.business, canSeeCost(req.ctx)) });
});

const chargeSchema = z.object({
  source: z.enum(["kitchen", "bar", "laundry", "extras", "room"]).default("extras"),
  productId: z.string().optional(),
  name: z.string().optional(),
  qty: z.number().positive().default(1),
  price: z.number().min(0).optional(),
});

/**
 * POST /api/hotel/stays/:id/charge — the kitchen sends breakfast to room 201.
 *
 * This is the folio doing its job: an outlet posts a charge instead of taking
 * cash. Stock still moves (the drink left the fridge), but no money does and
 * no sale exists until check-out.
 */
hotelRouter.post("/stays/:id/charge", requirePerm("sales"), async (req, res) => {
  const parsed = chargeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  const out = await withTransaction(async (session) => {
    const stay = await Stay.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!stay) throw notFound("Folio not found.");
    if (stay.status !== "checked_in") throw conflict("Charges can only be posted to a guest in house.", "not_in_house");

    let charge;
    if (d.productId) {
      const p = await Product.findOne({ _id: d.productId, businessId: req.ctx.businessId, status: "active" }).session(session);
      if (!p) throw badRequest("That item no longer exists.");
      const unitPrice = d.price !== undefined ? money(d.price) : p.price;
      // The item physically left the hotel's stock even though nobody paid.
      await applyMovement(req.ctx, {
        branchId: stay.branchId, productId: p._id, productName: p.name,
        type: "OUT", qty: -d.qty, refType: "stay", refId: stay._id,
        reason: `Folio ${stay.folioNo} · room ${stay.roomNumber}`, session,
      });
      charge = {
        at: new Date(), source: d.source, productId: p._id, name: p.name, qty: d.qty,
        unitPrice, lineCost: money((p.cost || 0) * d.qty), lineNet: money(unitPrice * d.qty),
        byName: req.ctx.actorName, stockMoved: true,
      };
    } else {
      if (!d.name?.trim()) throw badRequest("Describe the charge.");
      if (d.price === undefined) throw badRequest("Give the charge a price.");
      charge = {
        at: new Date(), source: d.source, name: d.name.trim(), qty: d.qty,
        unitPrice: money(d.price), lineCost: 0, lineNet: money(money(d.price) * d.qty),
        byName: req.ctx.actorName, stockMoved: false,
      };
    }

    stay.charges.push(charge);
    await stay.save({ session });
    return { stay, charge };
  });

  if (out.charge.productId) afterStockChange(req.ctx, out.stay.branchId, [out.charge.productId]);
  res.status(201).json({ stay: shapeStay(out.stay, req.ctx.business, canSeeCost(req.ctx)) });
});

// POST /api/hotel/stays/:id/payment — part-payment during the stay
hotelRouter.post("/stays/:id/payment", requirePerm("sales"), async (req, res) => {
  const method = req.body?.method;
  const amount = Number(req.body?.amount);
  if (!["cash", "pos", "transfer"].includes(method)) return res.status(400).json({ error: "invalid", message: "Choose a payment method." });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "invalid", message: "Enter an amount." });

  const stay = await Stay.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!stay) return res.status(404).json({ error: "not_found", message: "Folio not found." });
  if (stay.status === "checked_out") return res.status(409).json({ error: "closed", message: "This folio is already settled." });

  stay.payments.push({ method, amount: money(amount), at: new Date(), note: String(req.body?.note || "") });
  await stay.save();
  res.json({ stay: shapeStay(stay, req.ctx.business, canSeeCost(req.ctx)) });
});

/**
 * POST /api/hotel/stays/:id/check-out — settle the whole folio at once.
 *
 * Everything the guest accrued across every outlet becomes ONE sale, on the
 * day they leave. The room goes dirty, because someone has to clean it before
 * it can be sold again.
 */
hotelRouter.post("/stays/:id/check-out", requirePerm("sales"), async (req, res) => {
  const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];

  const out = await withTransaction(async (session) => {
    const stay = await Stay.findOne({ _id: req.params.id, businessId: req.ctx.businessId }).session(session);
    if (!stay) throw notFound("Folio not found.");
    if (stay.status === "checked_out") throw conflict("This guest already checked out.", "already_out");
    if (stay.status !== "checked_in") throw conflict("Check the guest in first.", "not_in_house");

    const totals = folioTotals(req.ctx.business, stay.charges, stay.discount);
    const already = money(stay.payments.reduce((s, p) => s + p.amount, 0));
    const nowPaid = money(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
    const due = money(totals.total - already);
    if (Math.abs(nowPaid - due) > 0.01) {
      throw badRequest(`Payments (${nowPaid}) don't match the balance owing (${due}).`, "payment_mismatch");
    }

    for (const p of payments) {
      if (!["cash", "pos", "transfer"].includes(p.method)) throw badRequest("Unknown payment method.");
      stay.payments.push({ method: p.method, amount: money(p.amount), at: new Date() });
    }

    const split = {};
    for (const p of stay.payments) split[p.method] = money((split[p.method] || 0) + p.amount);

    const seq = await nextSeq(`sale:${stay.branchId}`, session);
    const [sale] = await Sale.create([{
      accountId: req.ctx.accountId, businessId: req.ctx.businessId, branchId: stay.branchId,
      saleNo: `R-${String(seq).padStart(5, "0")}`,
      staffId: req.ctx.userId, staffName: req.ctx.actorName,
      customerId: stay.customerId, customerName: stay.guestName,
      items: stay.charges.map((c) => ({
        productId: c.productId || stay._id, name: c.name, qty: c.qty,
        unitPrice: c.unitPrice, lineCost: c.lineCost, lineNet: c.lineNet, returnedQty: 0,
      })),
      subtotal: totals.subtotal, discount: totals.discount, vat: totals.vat, total: totals.total,
      payments: Object.entries(split).map(([method, amount]) => ({ method, amount })),
    }], { session });

    stay.status = "checked_out";
    stay.checkedOutAt = new Date();
    stay.vat = totals.vat;
    stay.total = totals.total;
    stay.saleId = sale._id;
    await stay.save({ session });

    // The guest has gone; the room needs making up before it sells again.
    await Room.updateOne({ _id: stay.roomId }, { $set: { housekeeping: "dirty" } }, { session });

    if (stay.customerId) {
      const customer = await Customer.findById(stay.customerId).session(session);
      if (customer) {
        customer.totalSpend = money(customer.totalSpend + totals.total);
        customer.visits += 1;
        customer.lastSeen = new Date();
        await customer.save({ session });
      }
    }

    const totalCost = money(stay.charges.reduce((s, c) => s + (c.lineCost || 0), 0));
    await bumpDailyMetric(req.ctx, stay.branchId, localDay(), {
      revenue: totals.total, cost: totalCost, profit: totals.total - totals.vat - totalCost,
      txns: 1, discountTotal: totals.discount, vatTotal: totals.vat, payments: split,
    }, session);

    return { stay, sale };
  });

  audit(req.ctx, "hotel.check_out", { type: "stay", id: out.stay._id, label: out.stay.folioNo }, undefined, {
    room: out.stay.roomNumber, total: out.stay.total, saleNo: out.sale.saleNo,
  });
  res.json({ stay: shapeStay(out.stay, req.ctx.business, canSeeCost(req.ctx)), saleNo: out.sale.saleNo });
});

// POST /api/hotel/stays/:id/cancel — frees the room immediately
hotelRouter.post("/stays/:id/cancel", requirePerm("sales"), async (req, res) => {
  const stay = await Stay.findOne({ _id: req.params.id, businessId: req.ctx.businessId });
  if (!stay) return res.status(404).json({ error: "not_found", message: "Folio not found." });
  if (stay.status === "checked_out") return res.status(409).json({ error: "closed", message: "That stay is already settled." });
  if (stay.status === "checked_in") {
    return res.status(409).json({ error: "in_house", message: "The guest is in the room — check them out instead." });
  }
  stay.status = String(req.body?.noShow) === "true" ? "no_show" : "cancelled";
  await stay.save();
  audit(req.ctx, "hotel.cancel", { type: "stay", id: stay._id, label: stay.folioNo }, undefined, { room: stay.roomNumber });
  res.json({ stay: shapeStay(stay, req.ctx.business, canSeeCost(req.ctx)) });
});
