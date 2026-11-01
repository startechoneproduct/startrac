import mongoose from "mongoose";
import { API_PORT, MONGO_URI, OWNER, PRODUCTS, SLUG, assertLocalMongo } from "./support/env";
import { startFakeSmtp } from "./support/smtp";

/**
 * Builds the world the tests run in: a supermarket owner on the Business plan,
 * a published page with the online store switched on, and a shelf of products.
 * The API is already running (Playwright starts it first), pointed at the
 * throwaway database — and we re-verify that before writing a single document.
 */
export default async function globalSetup() {
  assertLocalMongo();
  const stopSmtp = await startFakeSmtp(); // the app's mail goes here; see support/smtp.ts
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 6000 });
  } catch {
    throw new Error("Can't reach the local MongoDB on port 27818. Start it with `npm run dev:db`, then run the tests again.");
  }
  const db = mongoose.connection.db!;

  // A clean slate (documents only — keep the indexes the API just built).
  for (const c of await db.collections()) await c.deleteMany({});

  const api = `http://localhost:${API_PORT}`;
  const res = await fetch(`${api}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: OWNER.name, email: OWNER.email, phone: OWNER.phone, password: OWNER.password, businessName: "Fresh Mart", businessType: "supermarket" }),
  });
  const reg = await res.json();
  if (res.status !== 201) throw new Error(`Couldn't register the test owner: ${JSON.stringify(reg)}`);

  const oid = (s: string) => new mongoose.Types.ObjectId(s);
  const accountId = oid(reg.account.id), businessId = oid(reg.businesses[0].id), branchId = oid(reg.branches[0].id);

  // On the Business plan (the page and store need it), contact details already verified
  // so no "verify your email" prompt gets in the owner's way.
  await db.collection("accounts").updateOne({ _id: accountId }, { $set: { subscription: { plan: "business", trial: false, currentPeriodEnd: new Date(Date.now() + 90 * 864e5), payments: [] } } });
  await db.collection("users").updateOne({ email: OWNER.email }, { $set: { emailVerified: true, phoneVerified: true } });

  await db.collection("businesses").updateOne({ _id: businessId }, { $set: {
    "site.enabled": true, "site.slug": SLUG, "site.accent": "#0f9f6e", "site.template": "classic",
    "site.headline": "Fresh groceries, delivered", "site.tagline": "Everything for your kitchen, from our shelves to your door.",
    "site.about": "Fresh Mart has been serving Lekki families since 2015.",
    "site.announcement": "Free delivery on orders over ₦20,000",
    "site.contact.phone": "08030000009", "site.contact.whatsapp": "08030000009", "site.contact.address": "12 Admiralty Way, Lekki Phase 1",
    "site.storefront": {
      enabled: true, acceptingOrders: true, pickup: true, delivery: true, deliveryFee: 500, freeDeliveryOver: 20000, minOrder: 1000,
      payOnDelivery: true, payAtPickup: true, transfer: true, bankName: "GTBank", accountName: "Fresh Mart Ltd", accountNumber: "0123456789",
      leadTime: "Ready in about 30 minutes", instructions: "", deliveryAreas: "Lekki, Ikoyi, Victoria Island",
    },
  } });

  const now = new Date();
  for (const [name, category, price, cost, stock] of PRODUCTS) {
    const p = await db.collection("products").insertOne({ accountId, businessId, name, category, price, cost, status: "active", archetype: "stock", unit: "unit", reorderLevel: 2, imageUrl: "", createdAt: now, updatedAt: now });
    await db.collection("inventories").insertOne({ accountId, businessId, branchId, productId: p.insertedId, stock, createdAt: now, updatedAt: now });
  }

  await mongoose.disconnect();
  return stopSmtp; // Playwright runs this once the whole run is over
}
