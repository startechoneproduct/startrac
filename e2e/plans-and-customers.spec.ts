import { freshIp } from "./support/owner";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { closeDb, customerCount, fillCustomers, payFor, seedProduct, setPaidUntil, setTrialEnd } from "./support/db";

/**
 * Plans are paid. Someone who pays for Freemium gets Pro free for 14 days inside
 * their first month, then carries on with the Freemium they paid for. Customer
 * limits follow the plan: Freemium 100, Pro 2,000, Business unlimited — for typing customers in,
 * uploading a list, ringing one up at the till, and website sign-ups.
 */
test.afterAll(closeDb);
const stamp = Date.now().toString(36);
let n = 0;

async function newOwner(request: APIRequestContext, signedUpFor: "free" | "pro" | "business" = "free", pay = true) {
  const tag = `${signedUpFor}-${++n}`;
  const email = `plan-${tag}-${stamp}@example.test`;
  const res = await request.post("/api/auth/register", {
    headers: { "x-forwarded-for": freshIp() },
    data: { name: "Plan Tester", email, phone: "08031112222", password: "OwnerPass123", businessName: `Plan Shop ${tag}`, businessType: "supermarket", plan: signedUpFor },
  });
  expect(res.status()).toBe(201);
  const s = await res.json();
  const ids = { accountId: s.account.id as string, businessId: s.businesses[0].id as string, branchId: s.branches[0].id as string };
  if (pay) expect((await payFor(ids.accountId, signedUpFor)).ok).toBe(true);
  return { email, ...ids, token: s.token as string, headers: { Authorization: `Bearer ${s.token}`, "x-business-id": ids.businessId, "x-branch-id": ids.branchId } };
}

const me = async (request: APIRequestContext, o: { token: string }) => (await (await request.get("/api/auth/me", { headers: { Authorization: `Bearer ${o.token}` } })).json()).plan;

const CSV = `Name,Phone Number,Email,Address
Ada Obi,08031110001,ada@x.com,Lekki
Bola Eze,8031110002,,Ikeja
Chi Dike,0803 111 0003,chi@x.com,
Ada Again,08031110001,,
Dup Email,08031110009,ada@x.com,
NoPhone Person,,,
Bad Phone,123,,
Dayo Ade,08031110005,dayo@x.com,
`;
const upload = (request: APIRequestContext, o: { headers: Record<string, string> }, commit: boolean, csv = CSV) =>
  request.post("/api/customers/import", { headers: o.headers, multipart: { file: { name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }, ...(commit ? { commit: "1" } : {}) } });

test.describe("Paying for a plan", () => {
  test("a new account is view-only until it pays", async ({ request }) => {
    const o = await newOwner(request, "free", false);
    const plan = await me(request, o);
    expect(plan).toMatchObject({ key: "free", awaitingPayment: true, lapsed: true, paymentsOn: true });
    expect((await request.get("/api/products", { headers: o.headers })).status()).toBe(200);   // can look
    const w = await request.post("/api/customers", { headers: o.headers, data: { name: "Too Early" } });
    expect(w.status()).toBe(402);                                                                // can't change
    expect((await w.json()).error).toBe("subscription_lapsed");
  });

  test("paying for Freemium starts it AND upgrades them to Pro for 14 days", async ({ request }) => {
    const o = await newOwner(request, "free", false);
    expect((await payFor(o.accountId, "free")).ok).toBe(true);
    const plan = await me(request, o);
    expect(plan).toMatchObject({ key: "pro", trial: true, lapsed: false, awaitingPayment: false, paidPlan: "free" });
    expect(plan.limits.customers).toBe(2000);
    expect(plan.features).toEqual(expect.arrayContaining(["ai", "reports", "csvImport", "suppliers"]));
    expect(plan.features).not.toContain("sitePage"); // Business-only stays Business-only
    const bonusDays = (new Date(plan.periodEnd).getTime() - Date.now()) / 864e5;
    expect(bonusDays).toBeGreaterThan(13.9);
    expect(bonusDays).toBeLessThanOrEqual(14.01);
    const paidDays = (new Date(plan.paidUntil).getTime() - Date.now()) / 864e5;
    expect(paidDays).toBeGreaterThan(29.9);                                                      // the month they paid for
    expect((await request.post("/api/customers", { headers: o.headers, data: { name: "Working" } })).status()).toBe(201);
  });

  test("after the 14 days they're back on the Freemium they paid for — not locked out", async ({ request }) => {
    const o = await newOwner(request, "free");
    await setTrialEnd(o.accountId, -1);

    const plan = await me(request, o);
    expect(plan).toMatchObject({ key: "free", name: "Freemium", trial: false, trialEnded: true, lapsed: false });
    expect(plan.limits.customers).toBe(100);
    expect(plan.features).not.toContain("ai");

    // Work carries on (they paid for the month)...
    expect((await request.post("/api/customers", { headers: o.headers, data: { name: "Still Working" } })).status()).toBe(201);
    // ...but Pro features are paused, with the usual explanation.
    const pro = await request.get("/api/suppliers", { headers: o.headers });
    expect(pro.status()).toBe(403);
    expect((await pro.json()).error).toBe("plan_required");
  });

  test("Pro and Business sign-ups pay for what they chose, with no bonus", async ({ request }) => {
    const pro = await newOwner(request, "pro");
    const biz = await newOwner(request, "business");
    expect(await me(request, pro)).toMatchObject({ key: "pro", trial: false, paidPlan: "pro" });
    expect(await me(request, biz)).toMatchObject({ key: "business", trial: false, paidPlan: "business" });
    const days = (new Date((await me(request, pro)).periodEnd).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(29.9);
  });

  test("the Pro bonus is once only: renewing Freemium later doesn't repeat it", async ({ request }) => {
    const o = await newOwner(request, "free");
    await setTrialEnd(o.accountId, -1);                  // bonus over
    expect((await payFor(o.accountId, "free")).ok).toBe(true); // renew
    const plan = await me(request, o);
    expect(plan.key).toBe("free");
    expect(plan.trial).toBe(false);
  });

  test("when the paid month ends the account lapses to view-only, and paying again reopens it", async ({ request }) => {
    const o = await newOwner(request, "pro");
    await setPaidUntil(o.accountId, -1);
    expect(await me(request, o)).toMatchObject({ key: "free", lapsed: true });
    expect((await request.post("/api/customers", { headers: o.headers, data: { name: "Locked" } })).status()).toBe(402);
    expect((await request.get("/api/customers", { headers: o.headers })).status()).toBe(200);
    expect((await payFor(o.accountId, "pro")).ok).toBe(true);
    expect(await me(request, o)).toMatchObject({ key: "pro", lapsed: false });
    expect((await request.post("/api/customers", { headers: o.headers, data: { name: "Reopened" } })).status()).toBe(201);
  });

  test("a payment is only accepted for the right amount, plan and currency, and only once", async ({ request }) => {
    const o = await newOwner(request, "free", false);
    expect((await payFor(o.accountId, "free", { amount: 100 })).reason).toBe("wrong_amount");        // paid ₦1, not ₦2,000
    expect((await payFor(o.accountId, "free", { currency: "USD" })).reason).toBe("wrong_currency");
    expect((await payFor(o.accountId, "free", { status: "failed" })).reason).toBe("not_paid");
    expect((await payFor(o.accountId, "free", { metadata: { plan: "diamond", accountId: o.accountId } })).reason).toBe("unknown_payment");
    expect((await me(request, o)).awaitingPayment).toBe(true);                                          // none of them counted
    const first = await payFor(o.accountId, "free", { reference: "ref_once_only" });
    const again = await payFor(o.accountId, "free", { reference: "ref_once_only" });                    // same payment reported twice
    expect(first.ok && !first.already).toBe(true);
    expect(again.already).toBe(true);
    const end1 = (await me(request, o)).paidUntil;
    expect((new Date(end1).getTime() - Date.now()) / 864e5).toBeLessThan(30.1); // not extended by the repeat
  });

  test("the billing page lists the real prices; checkout needs the payment provider to be set up", async ({ request }) => {
    const o = await newOwner(request, "free", false);
    const billing = await (await request.get("/api/billing", { headers: o.headers })).json();
    expect(billing).toMatchObject({ paymentsOn: true, awaitingPayment: true });
    const r = await request.post("/api/billing/checkout", { headers: o.headers, data: { plan: "free" } });
    expect([200, 400]).toContain(r.status());               // 400 payments_off here: no Paystack key on the test server
    if (r.status() === 400) expect((await r.json()).error).toBe("payments_off");
  });
});

test.describe("Customer limits follow the plan", () => {
  test("on the Pro trial you can add customers up to Pro's limit of 2,000 — and no further", async ({ request }) => {
    const o = await newOwner(request);
    await fillCustomers(o.accountId, o.businessId, 1999);

    const last = await request.post("/api/customers", { headers: o.headers, data: { name: "Number 2000" } });
    expect(last.status(), "the 2,000th customer is allowed").toBe(201);

    const over = await request.post("/api/customers", { headers: o.headers, data: { name: "Number 2001" } });
    expect(over.status()).toBe(403);
    const body = await over.json();
    expect(body.error).toBe("plan_limit");
    expect(body.limit).toBe("customers");
    expect(body.cap).toBe(2000);
    expect(body.message).toContain("2000 customers");
  });

  test("after the trial the cap is Freemium's 100, and existing customers are never deleted", async ({ request }) => {
    const o = await newOwner(request);
    await fillCustomers(o.accountId, o.businessId, 150); // more than Freemium allows, entered during the trial
    await setTrialEnd(o.accountId, -1);

    expect(await customerCount(o.businessId)).toBe(150); // nothing removed
    const blocked = await request.post("/api/customers", { headers: o.headers, data: { name: "One more" } });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).cap).toBe(100);
    const list = await (await request.get("/api/customers", { headers: o.headers })).json();
    expect(list.customers.length).toBeGreaterThan(0); // still readable
  });

  test("the till never refuses a sale over the limit — the customer just isn't saved to the book", async ({ request }) => {
    const o = await newOwner(request);
    await setTrialEnd(o.accountId, -1);
    await fillCustomers(o.accountId, o.businessId, 100); // Freemium's book is full
    const productId = await seedProduct(o.accountId, o.businessId, o.branchId, "Test Item", 500, 10);

    const sale = await request.post("/api/sales", {
      headers: o.headers,
      data: { items: [{ productId, qty: 1 }], payments: [{ method: "cash", amount: 500 }], customer: { name: "Walk-in Wale", phone: "08099990000" } },
    });
    expect(sale.status(), "a sale must never fail over a customer limit").toBe(201);
    const body = await sale.json();
    expect(body.sale.customerName).toBe("Walk-in Wale"); // still on the receipt
    expect(await customerCount(o.businessId)).toBe(100); // but not added to the book
  });
});

test.describe("Uploading customers", () => {
  test("a preview says exactly what would happen, and saves nothing", async ({ request }) => {
    const o = await newOwner(request);
    const r = await upload(request, o, false);
    expect(r.status()).toBe(200);
    const report = await r.json();
    expect(report.committed).toBe(false);
    expect(report.totals).toMatchObject({ rows: 8, add: 5, duplicate: 2, invalid: 1, overLimit: 0 });
    expect(report.mapping).toMatchObject({ name: "Name", phone: "Phone Number", email: "Email", address: "Address" });
    expect(report.problems[0].reason).toContain("doesn't look like a phone number");
    expect(await customerCount(o.businessId)).toBe(0);
  });

  test("saving adds the new people, skips duplicates and bad rows, and tags them 'import'", async ({ request }) => {
    const o = await newOwner(request);
    const report = await (await upload(request, o, true)).json();
    expect(report.committed).toBe(true);
    expect(report.created).toBe(5);
    expect(await customerCount(o.businessId)).toBe(5);

    const list = (await (await request.get("/api/customers", { headers: o.headers })).json()).customers;
    const bola = list.find((c: any) => c.name === "Bola Eze");
    expect(bola.phone).toBe("08031110002"); // Excel dropped the leading zero; it's put back
    expect(list.find((c: any) => c.name === "Ada Obi").source).toBe("import");

    // Uploading the same file again adds nobody.
    const again = await (await upload(request, o, true)).json();
    expect(again.created).toBe(0);
    expect(again.totals.duplicate).toBe(7);
    expect(await customerCount(o.businessId)).toBe(5);
  });

  test("an upload stops at the plan's limit and says how many didn't fit", async ({ request }) => {
    const o = await newOwner(request);
    await fillCustomers(o.accountId, o.businessId, 1996); // room for 4 more on Pro's 2,000
    const report = await (await upload(request, o, true)).json();
    expect(report.created).toBe(4);
    expect(report.totals.overLimit).toBe(1);
    expect(report.limit?.error).toBe("plan_limit");
    expect(await customerCount(o.businessId)).toBe(2000);
  });

  test("uploading is a Pro feature: available on the trial, paused after it", async ({ request }) => {
    const o = await newOwner(request);
    expect((await upload(request, o, false)).status()).toBe(200); // trial = Pro
    await setTrialEnd(o.accountId, -1);
    const r = await upload(request, o, false);
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe("plan_required");
  });

  test("a file with no recognisable columns is explained, not guessed at", async ({ request }) => {
    const o = await newOwner(request);
    const r = await upload(request, o, false, "Colour,Size\nRed,L\nBlue,M\n");
    expect(r.status()).toBe(422);
    const body = await r.json();
    expect(body.error).toBe("no_columns");
    expect(body.headers).toEqual(["Colour", "Size"]);
  });
});

test.describe("The screens say the same thing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function signIn(page: import("@playwright/test").Page, email: string) {
    await page.addInitScript(() => localStorage.setItem("startrack.tour.dashboard-v1", "1"));
    await page.goto("/login");
    await page.getByPlaceholder("Email address").fill(email);
    await page.getByPlaceholder("Password").fill("OwnerPass123");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
  }

  test("the landing page shows the three prices and the Freemium welcome bonus", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Get started — 14 days of Pro free/ }).first()).toBeVisible();
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Simple, honest pricing." })).toBeVisible();
    for (const price of ["₦2,000", "₦7,500", "₦20,000"]) await expect(page.locator("#pricing")).toContainText(price);
    await expect(page.locator("#pricing")).toContainText("/ month");
    await expect(page.locator("#pricing")).toContainText("14 days of Pro, free");
    await expect(page.locator("#pricing")).not.toContainText("Payments are switched off");
  });

  test("someone who has paid for Freemium sees their Pro days and what comes after", async ({ page, request }) => {
    const o = await newOwner(request);
    await signIn(page, o.email);
    await page.goto("/app/billing");
    await expect(page.getByText(/You're enjoying Pro free until .* After that you carry on with Freemium, paid until/)).toBeVisible();
    await expect(page.locator("main").getByText("Customers", { exact: true }).locator("..")).toContainText("0 / 2,000");
  });

  test("a new account that hasn't paid is told to, with a Pay now button", async ({ page, request }) => {
    const o = await newOwner(request, "free", false);
    await signIn(page, o.email);
    await expect(page.getByText(/Make your first payment to start/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Pay now" })).toBeVisible();
    await page.goto("/app/billing");
    await expect(page.getByText("Not started")).toBeVisible();
    await expect(page.getByText("New here? Your first month includes 14 days of Pro, free.")).toBeVisible();
  });

  test("the Pro days ending soon are flagged; once over, the owner is told they're on the Freemium they paid for", async ({ page, request }) => {
    const o = await newOwner(request);
    await setTrialEnd(o.accountId, 3);
    await signIn(page, o.email);
    await expect(page.getByText(/Your free Pro days end in 3 days, then you carry on with Freemium, paid until/)).toBeVisible();

    await setTrialEnd(o.accountId, -1);
    await page.reload();
    await expect(page.getByText(/Your free Pro days are over and you're on Freemium, the plan you paid for/)).toBeVisible();
    await page.goto("/app/billing");
    await expect(page.locator("main").getByText("Customers", { exact: true }).locator("..")).toContainText("0 / 100"); // Freemium's customer limit
  });
});
