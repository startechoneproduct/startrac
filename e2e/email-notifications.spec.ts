import { expect, test, type APIRequestContext } from "@playwright/test";
import mongoose from "mongoose";
import { closeDb, db, payFor, runBillingNoticesNow, seedProduct, setCreatedDaysAgo, setPaidUntil, setTrialEnd } from "./support/db";
import { OWNER, SLUG } from "./support/env";
import { allMail, codeIn, mailTo } from "./support/mailbox";
import { freshIp, newOwner, type Owner } from "./support/owner";

/**
 * Every email the app sends besides the sign-up code: password reset, welcome,
 * payment receipt, plan reminders, stock alerts, online orders, support
 * tickets and new staff. All over real SMTP to the pretend mail server.
 */
test.afterAll(closeDb);

let n = 0;
const uniq = (tag: string) => `${tag}-${Date.now().toString(36)}-${++n}@example.test`;
const mailsTo = (address: string) => allMail().filter((m) => m.to.some((t) => t.toLowerCase() === address.toLowerCase()));
const nobodyGot = async (address: string, ms = 1500) => { await new Promise((r) => setTimeout(r, ms)); return mailsTo(address).length === 0; };

async function signUp(request: APIRequestContext, plan: "free" | "pro" | "business" = "free", pay = true) {
  const email = uniq("notify");
  const res = await request.post("/api/auth/register", {
    headers: { "x-forwarded-for": freshIp() },
    data: { name: "Notify Owner", email, phone: "08031112222", password: "OwnerPass123", businessName: `Notify Shop ${n}`, businessType: "supermarket", plan },
  });
  expect(res.status()).toBe(201);
  const s = await res.json();
  if (pay) expect((await payFor(s.account.id, plan)).ok).toBe(true);
  return { email, accountId: s.account.id as string, token: s.token as string };
}

test.describe("Forgotten password", () => {
  test("a code is emailed, the new password works, the old one doesn't, and the code is single-use", async ({ request }) => {
    const u = await signUp(request);
    const r = await request.post("/api/auth/forgot", { headers: { "x-forwarded-for": freshIp() }, data: { email: u.email } });
    expect(r.status()).toBe(200);
    const mail = await mailTo(u.email, /Reset your StarTrack password/);
    const code = codeIn(mail);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await request.post("/api/auth/reset", { data: { email: u.email, code: code === "000000" ? "111111" : "000000", password: "BrandNew123" } });
    expect(wrong.status()).toBe(400);
    expect((await request.post("/api/auth/login", { data: { email: u.email, password: "BrandNew123" } })).status()).toBe(401); // nothing changed

    const ok = await request.post("/api/auth/reset", { data: { email: u.email, code, password: "BrandNew123" } });
    expect(ok.status()).toBe(200);
    expect((await request.post("/api/auth/login", { data: { email: u.email, password: "BrandNew123" } })).status()).toBe(200);
    expect((await request.post("/api/auth/login", { data: { email: u.email, password: "OwnerPass123" } })).status()).toBe(401);
    expect((await request.post("/api/auth/reset", { data: { email: u.email, code, password: "AnotherOne123" } })).status()).toBeGreaterThanOrEqual(400);

    const notice = await mailTo(u.email, /password was changed/);
    expect(notice.html).toContain("reset it again");
    expect(await verifiedEmail(u.email)).toBe(true);   // they proved they own the address
  });

  test("an unknown address gets the very same answer — and no email", async ({ request }) => {
    const u = await signUp(request);
    const ghost = uniq("ghost");
    const ipHeader = { "x-forwarded-for": freshIp() };
    const known = await request.post("/api/auth/forgot", { headers: ipHeader, data: { email: u.email } });
    const unknown = await request.post("/api/auth/forgot", { headers: ipHeader, data: { email: ghost } });
    expect(unknown.status()).toBe(known.status());
    expect(await unknown.json()).toEqual(await known.json());
    expect(await nobodyGot(ghost)).toBe(true);
    // And guessing at a reset for someone with no code pending doesn't reveal that they exist.
    const a = await request.post("/api/auth/reset", { data: { email: ghost, code: "123456", password: "Whatever123" } });
    const b = await request.post("/api/auth/reset", { data: { email: signUpEmail(u), code: "123456", password: "Whatever123" } });
    expect(a.status()).toBe(b.status());
    expect((await a.json()).error).toBe((await b.json()).error);
  });

  test("an expired code, too many wrong codes, and asking over and over are all refused", async ({ request }) => {
    const u = await signUp(request);
    await request.post("/api/auth/forgot", { headers: { "x-forwarded-for": freshIp() }, data: { email: u.email } });
    const code = codeIn(await mailTo(u.email, /Reset your StarTrack password/));
    await (await db()).collection("verificationcodes").updateMany({ target: u.email, purpose: "reset_password" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await request.post("/api/auth/reset", { data: { email: u.email, code, password: "BrandNew123" } });
    expect(late.status()).toBe(409);

    const v = await signUp(request);
    await request.post("/api/auth/forgot", { headers: { "x-forwarded-for": freshIp() }, data: { email: v.email } });
    let blocked = false;
    for (let i = 0; i < 12 && !blocked; i++) blocked = (await request.post("/api/auth/reset", { data: { email: v.email, code: String(100000 + i), password: "BrandNew123" } })).status() === 429;
    expect(blocked, "guessing codes must lock out").toBe(true);

    const w = await signUp(request);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request.post("/api/auth/forgot", { headers: { "x-forwarded-for": freshIp() }, data: { email: w.email } })).status());
    expect(statuses).toContain(429);
  });

  test("on screen: Forgot password? → email → code → new password → back to sign in", async ({ page, request }) => {
    const u = await signUp(request);
    await page.addInitScript(() => localStorage.setItem("startrack.tour.dashboard-v1", "1"));
    await page.goto("/login");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page.getByLabel("Email address for password reset").fill(u.email);
    await page.getByRole("button", { name: "Email me a code" }).click();

    const code = codeIn(await mailTo(u.email, /Reset your StarTrack password/));
    await page.getByLabel("Reset code").fill(code);
    await page.getByLabel("New password", { exact: true }).fill("ScreenReset123");
    await page.getByLabel("New password again").fill("different123");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("The two passwords don't match.")).toBeVisible();
    await page.getByLabel("New password again").fill("ScreenReset123");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("Your password has been changed.")).toBeVisible();
    await page.getByRole("button", { name: "Back to sign in" }).click();

    await page.getByPlaceholder("Password").fill("ScreenReset123");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/app\//);
  });
});

const signUpEmail = (u: { email: string }) => u.email;
const verifiedEmail = async (email: string) => !!(await (await db()).collection("users").findOne({ email }))?.emailVerified;

test.describe("Welcome and billing", () => {
  test("a new owner is welcomed, told what to do next, and not shown anyone's password", async ({ request }) => {
    const u = await signUp(request, "free", false);
    const mail = await mailTo(u.email, /Welcome to StarTrack/);
    expect(mail.html).toContain("first payment");
    expect(mail.html).toContain("₦2,000");
    expect(mail.html).toContain("14 days of Pro");
    expect(mail.html).not.toMatch(/OwnerPass123/);
  });

  test("paying sends a receipt that mentions the free Pro days", async ({ request }) => {
    const u = await signUp(request, "free", false);
    await payFor(u.accountId, "free");
    const mail = await mailTo(u.email, /Payment received/);
    expect(mail.subject).toContain("Freemium");
    expect(mail.subject).toContain("₦2,000");
    expect(mail.html).toContain("Pro, free, until");
    // Paying for Pro has no bonus line.
    const p = await signUp(request, "pro", false);
    await payFor(p.accountId, "pro");
    expect((await mailTo(p.email, /Payment received/)).html).not.toContain("free, until");
  });

  test("the free Pro days ending, the plan ending, and the plan ending for good each get one email — once", async ({ request }) => {
    const u = await signUp(request);
    await runBillingNoticesNow();
    expect(mailsTo(u.email).some((m) => /free .* days end|days left/i.test(m.subject))).toBe(false);   // nothing due yet

    await setTrialEnd(u.accountId, 2);
    await runBillingNoticesNow();
    const bonus = await mailTo(u.email, /free Pro days end in 2 days/);
    expect(bonus.html).toContain("Freemium");
    const count = () => mailsTo(u.email).filter((m) => /free Pro days end/.test(m.subject)).length;
    expect(count()).toBe(1);
    await runBillingNoticesNow();
    expect(count()).toBe(1);                                                                              // not again

    await setTrialEnd(u.accountId, -1);          // Pro days over; the paid month is next
    await setPaidUntil(u.accountId, 2);
    await runBillingNoticesNow();
    await mailTo(u.email, /Your Freemium plan ends in 2 days/);

    await setPaidUntil(u.accountId, -1);
    await runBillingNoticesNow();
    const ended = await mailTo(u.email, /plan has ended/);
    expect(ended.html).toContain("view-only");
  });

  test("an account that never paid is nudged after a day, once", async ({ request }) => {
    const u = await signUp(request, "free", false);
    await runBillingNoticesNow();
    expect(mailsTo(u.email).some((m) => /Finish setting up/.test(m.subject))).toBe(false);   // too soon
    await setCreatedDaysAgo(u.accountId, 2);
    await runBillingNoticesNow();
    await mailTo(u.email, /Finish setting up/);
    await runBillingNoticesNow();
    expect(mailsTo(u.email).filter((m) => /Finish setting up/.test(m.subject))).toHaveLength(1);
  });

  test("a suspended account and early-access accounts get no plan emails", async ({ request }) => {
    const u = await signUp(request);
    await (await db()).collection("accounts").updateOne({ _id: new mongoose.Types.ObjectId(u.accountId) }, { $set: { status: "suspended" } });
    await setPaidUntil(u.accountId, -1);
    await runBillingNoticesNow();
    expect(mailsTo(u.email).some((m) => /plan has ended/.test(m.subject))).toBe(false);
  });
});

test.describe("Stock alerts", () => {
  test("running out of something emails the owner within moments, without having set up any alert address", async ({ request }) => {
    const o = await newOwner(request);
    const item = await seedProduct(o.accountId, o.businessId, o.branchId, "Last Bag Of Rice", 1000, 1, { cost: 700, reorderLevel: 2 });
    await request.post("/api/sales", { headers: o.headers, data: { items: [{ productId: item, qty: 1 }], payments: [{ method: "cash", amount: 1000 }] } });
    const mail = await mailTo(o.email, /out of stock/);
    expect(mail.subject).toContain("[Action needed]");
    expect(mail.html).toContain("Last Bag Of Rice");
  });

  test("addresses listed in Settings are used instead of the owner's, and the same alert isn't sent twice", async ({ request }) => {
    const o = await newOwner(request);
    const buyer = uniq("buyer");
    await (await db()).collection("businesses").updateOne({ _id: new mongoose.Types.ObjectId(o.businessId) }, { $set: { "settings.alertEmails": [buyer] } });
    const item = await seedProduct(o.accountId, o.businessId, o.branchId, "Palm Oil Drum", 9000, 1, { cost: 7000, reorderLevel: 2 });
    await request.post("/api/sales", { headers: o.headers, data: { items: [{ productId: item, qty: 1 }], payments: [{ method: "cash", amount: 9000 }] } });
    await mailTo(buyer, /out of stock/);
    expect(mailsTo(o.email).some((m) => /out of stock/.test(m.subject))).toBe(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(mailsTo(buyer).filter((m) => /out of stock/.test(m.subject))).toHaveLength(1);
  });
});

test.describe("Online orders", () => {
  test("the owner is emailed at once, and the customer hears about each step", async ({ request }) => {
    const reg = await request.post(`/api/public/store/${SLUG}/auth/register`, {
      headers: { "x-forwarded-for": freshIp() },
      data: { name: "Mail Shopper", email: uniq("shopper"), phone: `0803${Math.floor(1000000 + Math.random() * 8999999)}`, password: "ShopPass123" },
    });
    expect(reg.status()).toBe(201);
    const { token, shopper } = await reg.json();
    const auth = { Authorization: `Bearer ${token}` };
    const cat = await (await request.get(`/api/public/store/${SLUG}/catalog`, { headers: auth })).json();
    const prod = cat.products.find((p: any) => p.name === "Spaghetti 500g") || cat.products[0];

    const placed = await request.post(`/api/public/store/${SLUG}/orders`, {
      headers: auth,
      data: { clientOrderId: `mail-${Date.now()}-${Math.random().toString(36).slice(2)}`, items: [{ productId: prod.id, qty: 2 }], fulfilment: { type: "pickup" }, payment: { method: "pay_at_pickup" } },   // 2 x ₦650 clears the ₦1,000 minimum
    });
    expect(placed.status(), JSON.stringify(await placed.json())).toBe(201);
    const order = (await placed.json()).order;

    const toOwner = await mailTo(OWNER.email, new RegExp(`New online order ${order.orderNo}`));
    expect(toOwner.html).toContain("Mail Shopper");
    const first = await mailTo(shopper.email, /We've got your order/);
    expect(first.subject).toContain(order.orderNo);

    // The owner accepts it: the customer is told.
    const login = await (await request.post("/api/auth/login", { data: { email: OWNER.email, password: OWNER.password } })).json();
    const headers = { Authorization: `Bearer ${login.token}`, "x-business-id": login.businesses[0].id, "x-branch-id": login.branches[0].id };
    expect((await request.post(`/api/orders/${order.id}/confirm`, { headers, data: {} })).status()).toBe(200);
    await mailTo(shopper.email, /Your order is confirmed/);
    // And the in-app alert for the owner isn't ALSO repeated in the digest.
    await new Promise((r) => setTimeout(r, 1200));
    expect(mailsTo(OWNER.email).filter((m) => /online order|updates? from your shop|shop updates?/i.test(m.subject) && !/New online order/.test(m.subject))).toHaveLength(0);
  });
});

test.describe("People", () => {
  async function addAdmin(request: APIRequestContext, o: Owner) {
    const email = uniq("admin");
    const r = await request.post("/api/staff", { headers: o.headers, data: { name: "Ada Admin", role: "admin", pin: "4321", email, password: "AdminPass123" } });
    expect(r.status(), JSON.stringify(await r.json())).toBe(201);
    const login = await (await request.post("/api/auth/login", { data: { email, password: "AdminPass123" } })).json();
    return { email, headers: { ...o.headers, Authorization: `Bearer ${login.token}` } as Record<string, string> };
  }

  test("someone added with an email address is told so — and their password isn't in it", async ({ request }) => {
    const o = await newOwner(request);
    const a = await addAdmin(request, o);
    const mail = await mailTo(a.email, /You've been added to/);
    expect(mail.html).toContain("admin");
    expect(mail.html).not.toContain("AdminPass123");
    // Till-only staff (no email) never trigger mail.
    const before = allMail().length;
    await request.post("/api/staff", { headers: o.headers, data: { name: "Till Only", role: "staff", branchId: o.branchId, pin: "2468" } });
    await new Promise((r) => setTimeout(r, 800));
    expect(allMail().length).toBe(before);
  });

  test("a reply on a support ticket reaches the person's inbox, not just their bell", async ({ request }) => {
    const o = await newOwner(request);
    const admin = await addAdmin(request, o);
    const t = await request.post("/api/tickets", { headers: admin.headers, data: { subject: "Printer will not print receipts", description: "Since Monday" } });
    expect(t.status(), JSON.stringify(await t.json())).toBe(201);
    const id = (await t.json()).ticket.id;
    expect((await request.post(`/api/tickets/${id}/comments`, { headers: o.headers, data: { body: "Try restarting it, then reload the page." } })).status()).toBe(201);
    const mail = await mailTo(admin.email, /New reply on/);
    expect(mail.subject).toContain("Printer will not print receipts");
    expect(mail.html).toContain("Try restarting it");
    // The person who wrote the reply isn't emailed about their own reply.
    expect(mailsTo(o.email).some((m) => /New reply on/.test(m.subject))).toBe(false);
  });
});
