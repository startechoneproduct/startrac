import mongoose from "mongoose";
import { MONGO_URI, assertLocalMongo } from "./env";
import { SMTP_PORT } from "./smtp";

/**
 * Server code the tests run directly (taking a payment, the plan-email sweep). It sends mail
 * itself, so mail is pointed at the pretend server BEFORE it is first loaded.
 */
async function server() {
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP_PORT), SMTP_SECURE: "false", SMTP_USER: "app@example.test", SMTP_PASS: "test-password", MAIL_FROM: "" });
  // @ts-expect-error plain JS from the server
  const [billing, plans, notices] = await Promise.all([import("../../server/modules/billing/billing.routes.js"), import("../../server/shared/plans.js"), import("../../server/modules/billing/billingNotices.js")]);
  return { applyTransaction: billing.applyTransaction, PLANS: plans.PLANS, runBillingNotices: notices.runBillingNotices };
}

/**
 * Direct access to the THROWAWAY database, for the two things a browser can't
 * reasonably do: arrange a situation (stock running out mid-shop) and check what
 * the UI claims actually reached the data. Raw collections, except for paying
 * (see payFor), which runs the server's own payment code.
 */
export async function db() {
  assertLocalMongo();
  if (mongoose.connection.readyState !== 1) await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  return mongoose.connection.db!;
}

export async function closeDb() {
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
}

async function productByName(name: string) {
  const p = await (await db()).collection("products").findOne({ name });
  if (!p) throw new Error(`No product named "${name}" in the test database`);
  return p;
}

export async function stockOf(name: string): Promise<number> {
  const p = await productByName(name);
  const inv = await (await db()).collection("inventories").findOne({ productId: p._id });
  return inv?.stock ?? 0;
}

export async function setStock(name: string, stock: number) {
  const p = await productByName(name);
  await (await db()).collection("inventories").updateOne({ productId: p._id }, { $set: { stock } });
}

export async function business() {
  const b = await (await db()).collection("businesses").findOne({ "site.slug": "fresh-mart" });
  if (!b) throw new Error("test business missing");
  return b;
}

export async function setAcceptingOrders(on: boolean) {
  await (await db()).collection("businesses").updateOne({ "site.slug": "fresh-mart" }, { $set: { "site.storefront.acceptingOrders": on } });
}

export const customerByEmail = async (email: string) => (await db()).collection("customers").findOne({ email });
export const ordersByStatus = async (status: string) => (await db()).collection("orders").countDocuments({ status });
export const onlineSales = async () => (await db()).collection("sales").find({ channel: "online" }).toArray();

/** Make an account's subscription run out yesterday (the old "lapsed, read-only" state). */
export async function expireSubscription(accountId: string) {
  await (await db()).collection("accounts").updateOne(
    { _id: new mongoose.Types.ObjectId(accountId) },
    { $set: { subscription: { plan: "pro", trial: false, currentPeriodEnd: new Date(Date.now() - 864e5), payments: [] } } }
  );
}

// ── plan & customer-limit helpers ───────────────────────────────────────────
const oid = (s: string) => new mongoose.Types.ObjectId(s);

/**
 * Pay for a plan the way Paystack's confirmation would: the server's own
 * applyTransaction runs on a verified-payment record, so what a payment does to an
 * account is exactly what these tests see. `reference` makes a payment unique.
 */
let payN = 0;
export async function payFor(accountId: string, plan: "free" | "pro" | "business", over: Record<string, unknown> = {}) {
  await db(); // makes sure the models talk to the test database
  const { applyTransaction, PLANS } = await server();
  const tx = { status: "success", reference: `test_${Date.now().toString(36)}_${++payN}`, currency: "NGN", amount: PLANS[plan].price * 100, metadata: { plan, accountId }, ...over };
  return applyTransaction(tx) as Promise<{ ok: boolean; reason?: string; already?: boolean; plan?: string }>;
}

/** When the free welcome days (the Pro bonus) end, N days from now; negative = already over, so back to the paid plan. */
export async function setTrialEnd(accountId: string, daysFromNow: number) {
  await (await db()).collection("accounts").updateOne({ _id: oid(accountId) }, { $set: { "subscription.bonus.until": new Date(Date.now() + daysFromNow * 864e5) } });
}

/** When the paid month ends, N days from now; negative = already over, so the account lapses (view-only). */
export async function setPaidUntil(accountId: string, daysFromNow: number) {
  await (await db()).collection("accounts").updateOne({ _id: oid(accountId) }, { $set: { "subscription.currentPeriodEnd": new Date(Date.now() + daysFromNow * 864e5) } });
}

/** Pad a customer book with N filler customers, quickly. */
export async function fillCustomers(accountId: string, businessId: string, n: number) {
  const now = new Date();
  const docs = Array.from({ length: n }, (_, i) => ({ accountId: oid(accountId), businessId: oid(businessId), branchId: null, name: `Filler ${i}`, phone: "", whatsapp: "", email: "", notes: "", source: "pos", totalSpend: 0, visits: 0, firstSeen: now, lastSeen: now, createdAt: now, updatedAt: now }));
  for (let i = 0; i < docs.length; i += 1000) await (await db()).collection("customers").insertMany(docs.slice(i, i + 1000));
}
export const customerCount = async (businessId: string) => (await db()).collection("customers").countDocuments({ businessId: oid(businessId) });

export async function seedProduct(
  accountId: string, businessId: string, branchId: string, name: string, price: number, stock: number,
  opts: { cost?: number; reorderLevel?: number; category?: string } = {}
) {
  const now = new Date();
  const p = await (await db()).collection("products").insertOne({ accountId: oid(accountId), businessId: oid(businessId), name, category: opts.category ?? "General", price, cost: opts.cost ?? 0, status: "active", archetype: "stock", unit: "unit", reorderLevel: opts.reorderLevel ?? 2, imageUrl: "", createdAt: now, updatedAt: now });
  await (await db()).collection("inventories").insertOne({ accountId: oid(accountId), businessId: oid(businessId), branchId: oid(branchId), productId: p.insertedId, stock, createdAt: now, updatedAt: now });
  return String(p.insertedId);
}

export const stockLevel = async (branchId: string, productId: string) => (await (await db()).collection("inventories").findOne({ branchId: oid(branchId), productId: oid(productId) }))?.stock ?? 0;
export const productDoc = async (productId: string) => (await db()).collection("products").findOne({ _id: oid(productId) });
export const movementsFor = async (productId: string) => (await db()).collection("stockmovements").find({ productId: oid(productId) }).sort({ at: 1 }).toArray();
export const metricFor = async (businessId: string, date: string) => (await db()).collection("dailymetrics").findOne({ businessId: oid(businessId), date });
export const salesCount = async (businessId: string, channel?: string) => (await db()).collection("sales").countDocuments({ businessId: oid(businessId), ...(channel ? { channel } : {}) });
export const customerDoc = async (businessId: string, name: string) => (await db()).collection("customers").findOne({ businessId: oid(businessId), name });
export const productInBusiness = async (businessId: string, name: string) => (await db()).collection("products").findOne({ businessId: oid(businessId), name });

/** Turn VAT on for a business (invoices only add it when the business has it enabled). */
export async function setVat(businessId: string, rate = 7.5) {
  await (await db()).collection("businesses").updateOne({ _id: oid(businessId) }, { $set: { "settings.vatEnabled": true, "settings.vatRate": rate } });
}
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const invoiceSale = async (businessId: string, saleNo: string) => (await db()).collection("sales").findOne({ businessId: oid(businessId), saleNo });

/** Runs the pass that sends plan emails (free days ending, plan ending), as the scheduled sweep would. */
export async function runBillingNoticesNow(): Promise<{ checked: number; sent: number }> {
  await db();
  return (await server()).runBillingNotices();
}

/** Pretend an account was created N days ago (for "hasn't paid yet" reminders). */
export async function setCreatedDaysAgo(accountId: string, days: number) {
  await (await db()).collection("accounts").updateOne({ _id: oid(accountId) }, { $set: { createdAt: new Date(Date.now() - days * 864e5) } });
}
