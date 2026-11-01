import { expect, test } from "@playwright/test";
import { closeDb, customerDoc, fillCustomers, metricFor, productInBusiness, salesCount, seedProduct, setTrialEnd, stockLevel } from "./support/db";
import { newOwner, uploadCsv } from "./support/owner";

/**
 * Uploading past sales: the history lands in sales, daily figures and the
 * customer book, never in today's stock — and a wrong upload can be undone.
 */
test.afterAll(closeDb);

const URL = "/api/history-import/sales";

// Two receipts on 15 March (R-1 has two lines), a till-less sale on 16 March, a repeat customer on 20 March.
const CSV = `Date,Receipt No,Item,Quantity,Unit Price,Customer,Phone,Payment Method
15/03/2025,R-1,Rice,2,5000,Ada Obi,08031110001,Cash
15/03/2025,R-1,Oil,1,2000,Ada Obi,08031110001,Cash
16/03/2025,R-2,Rice,1,5000,,,Bank Transfer
20/03/2025,R-3,Beans,4,800,Ada Obi,08031110001,POS
`;

test.describe("Preview", () => {
  test("says exactly what would be recorded, and writes nothing", async ({ request }) => {
    const o = await newOwner(request);
    await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 5200, 40, { cost: 3900 });

    const r = await (await uploadCsv(request, URL, o, CSV)).json();
    expect(r.committed).toBe(false);
    expect(r.mapping).toMatchObject({ date: "Date", receipt: "Receipt No", item: "Item", qty: "Quantity", price: "Unit Price", customer: "Customer", phone: "Phone", payment: "Payment Method" });
    expect(r.totals).toMatchObject({ rows: 4, sales: 3, lines: 4, invalid: 0, duplicate: 0 });
    expect(r.totals.newCustomers).toBe(1);   // Ada, once, across her two sales
    expect(r.totals.newProducts).toBe(2);    // Oil and Beans aren't in the catalog; Rice is
    expect(r.revenue).toBe(2 * 5000 + 2000 + 5000 + 4 * 800);
    expect(r.from).toBe("2025-03-15");
    expect(r.to).toBe("2025-03-20");
    expect(await salesCount(o.businessId)).toBe(0);
  });

  test("explains rows it can't use instead of guessing", async ({ request }) => {
    const o = await newOwner(request);
    const bad = `Date,Item,Qty,Price
not a date,Rice,1,100
15/03/2025,,1,100
15/03/2025,Rice,zero,100
15/03/2025,Rice,1,
01/01/2999,Rice,1,100
15/03/2025,Rice,2,100
`;
    const r = await (await uploadCsv(request, URL, o, bad)).json();
    expect(r.totals).toMatchObject({ rows: 6, sales: 1, invalid: 5 });
    const reasons = r.problems.map((p: any) => p.reason).join(" | ");
    expect(reasons).toContain("isn't a usable date");
    expect(reasons).toContain("No item name");
    expect(reasons).toContain("isn't a valid quantity");
    expect(reasons).toContain("No price or total");
  });

  test("a file without the essential columns is explained, with the headers to choose from", async ({ request }) => {
    const o = await newOwner(request);
    const r = await uploadCsv(request, URL, o, "Colour,Size\nRed,L\nBlue,M\n");
    expect(r.status()).toBe(422);
    const body = await r.json();
    expect(body.error).toBe("no_columns");
    expect(body.headers).toEqual(["Colour", "Size"]);
  });

  test("reads dates day-first, the way they're written here: 05-03-2025 is 5 March, not 3 May", async ({ request }) => {
    const o = await newOwner(request);
    const csv = `Date,Item,Qty,Price
05-03-2025,Rice,1,100
06/03/2025,Rice,1,100
7.3.25,Rice,1,100
`;
    const r = await (await uploadCsv(request, URL, o, csv)).json();
    expect(r.from).toBe("2025-03-05");
    expect(r.to).toBe("2025-03-07");
    expect(r.totals.invalid).toBe(0);
  });

  test("accepts a line total instead of a unit price, and several date styles", async ({ request }) => {
    const o = await newOwner(request);
    const csv = `Sale Date,Product,Qty,Amount
2025-03-15,Rice,4,20000
15-03-2025,Rice,2,10000
`;
    const r = await (await uploadCsv(request, URL, o, csv, { commit: "1" })).json();
    expect(r.created).toBe(2);
    expect(r.revenue).toBe(30000);
    expect(r.from).toBe("2025-03-15");
    expect(r.to).toBe("2025-03-15");
  });
});

test.describe("Saving", () => {
  test("records the sales, groups lines by receipt, leaves stock alone, and feeds the daily figures", async ({ request }) => {
    const o = await newOwner(request);
    const rice = await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 5200, 40, { cost: 3900 });

    const r = await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json();
    expect(r.committed).toBe(true);
    expect(r.created).toBe(3);
    expect(await salesCount(o.businessId, "import")).toBe(3);
    expect(await stockLevel(o.branchId, rice)).toBe(40); // these sales happened long ago: today's shelf is untouched

    // Receipt R-1 is ONE sale with two lines.
    const list = await (await request.get("/api/sales?from=2025-03-01&to=2025-03-31&channel=import", { headers: o.headers })).json();
    expect(list.sales).toHaveLength(3);
    const r1 = list.sales.find((s: any) => s.items.length === 2);
    expect(r1.total).toBe(12000);
    expect(r1.customerName).toBe("Ada Obi");
    expect(r1.channel).toBe("import");
    expect(r1.saleNo).toMatch(/^H-\d{5}$/);
    expect(r1.staffName).toBe("Imported history");

    // Payment methods were understood from free text.
    const methods = Object.fromEntries(list.sales.map((s: any) => [s.total, s.payments[0].method]));
    expect(methods[12000]).toBe("cash");
    expect(methods[5000]).toBe("transfer");
    expect(methods[3200]).toBe("pos");

    // The daily figures the dashboard reads now include that history.
    const day = await metricFor(o.businessId, "2025-03-15");
    expect(day).toMatchObject({ revenue: 12000, txns: 1 });
    expect(day!.paymentSplit.cash).toBe(12000);
    // Profit uses the catalog cost where it's known (Rice 2 × 3,900), and 0 for items with no cost on record.
    expect(day!.cost).toBe(7800);
    expect(day!.profit).toBe(12000 - 7800);
  });

  test("joins the customer book: one Ada across her sales, with her lifetime spend", async ({ request }) => {
    const o = await newOwner(request);
    await uploadCsv(request, URL, o, CSV, { commit: "1" });
    const ada = await customerDoc(o.businessId, "Ada Obi");
    expect(ada).toBeTruthy();
    expect(ada!.totalSpend).toBe(12000 + 3200);
    expect(ada!.visits).toBe(2);
    expect(ada!.source).toBe("import");
    expect(new Date(ada!.firstSeen).toISOString().slice(0, 10)).toBe("2025-03-15");
    expect(new Date(ada!.lastSeen).toISOString().slice(0, 10)).toBe("2025-03-20");
  });

  test("matches an existing customer by phone instead of creating a second one", async ({ request }) => {
    const o = await newOwner(request);
    await request.post("/api/customers", { headers: o.headers, data: { name: "Ada (till)", phone: "08031110001" } });
    const r = await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json();
    expect(r.totals.newCustomers).toBe(0);
    const list = (await (await request.get("/api/customers?q=Ada", { headers: o.headers })).json()).customers;
    expect(list).toHaveLength(1);
    expect(list[0].totalSpend).toBe(15200);
  });

  test("items that aren't in the catalog become archived placeholders, so old receipts keep their names", async ({ request }) => {
    const o = await newOwner(request);
    await uploadCsv(request, URL, o, CSV, { commit: "1" });
    const oil = await productInBusiness(o.businessId, "Oil");
    expect(oil).toBeTruthy();
    expect(oil!.status).toBe("archived"); // not in the till, not counted against the product limit
    const catalog = (await (await request.get("/api/products", { headers: o.headers })).json()).products ?? [];
    expect(catalog.find((p: any) => p.name === "Oil")).toBeUndefined();
  });

  test("uploading the same file twice records it once", async ({ request }) => {
    const o = await newOwner(request);
    await uploadCsv(request, URL, o, CSV, { commit: "1" });
    const again = await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json();
    expect(again.totals.duplicate).toBe(3);
    expect(again.created).toBe(0);
    expect(await salesCount(o.businessId, "import")).toBe(3);
    expect((await metricFor(o.businessId, "2025-03-15"))!.revenue).toBe(12000); // not doubled
  });

  test("on the Pro trial, a full customer book still imports the sales without adding people", async ({ request }) => {
    const o = await newOwner(request);
    await fillCustomers(o.accountId, o.businessId, 2000); // Pro's limit
    const r = await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json();
    expect(r.created).toBe(3);
    expect(r.totals.newCustomers).toBe(0);
    expect(r.totals.noCustomerSaved).toBeGreaterThan(0);
    const list = await (await request.get("/api/sales?from=2025-03-01&to=2025-03-31&channel=import", { headers: o.headers })).json();
    expect(list.sales.some((s: any) => s.customerName === "Ada Obi")).toBe(true);
    expect(await customerDoc(o.businessId, "Ada Obi")).toBeNull();
  });
});

test.describe("Protecting the books", () => {
  test("imported sales can't be voided or returned — that would invent stock", async ({ request }) => {
    const o = await newOwner(request);
    const rice = await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 5200, 40);
    await uploadCsv(request, URL, o, "Date,Item,Qty,Price\n15/03/2025,Rice,2,5200\n", { commit: "1" });
    const sale = (await (await request.get("/api/sales?from=2025-03-01&to=2025-03-31&channel=import", { headers: o.headers })).json()).sales[0];

    const voided = await request.post(`/api/sales/${sale.id}/void`, { headers: o.headers, data: { reason: "oops, wrong" } });
    expect(voided.status()).toBe(409);
    expect((await voided.json()).error).toBe("imported_sale");

    const returned = await request.post("/api/returns", { headers: o.headers, data: { saleId: sale.id, items: [{ productId: rice, qty: 1 }], reason: "changed mind", refundMethod: "cash" } });
    expect(returned.status()).toBe(409);
    expect(await stockLevel(o.branchId, rice)).toBe(40);
  });

  test("the till's own sales view separates in-person sales from imported and online ones", async ({ request }) => {
    const o = await newOwner(request);
    const item = await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 100, 10);
    await request.post("/api/sales", { headers: o.headers, data: { items: [{ productId: item, qty: 1 }], payments: [{ method: "cash", amount: 100 }] } });
    await uploadCsv(request, URL, o, "Date,Item,Qty,Price\n15/03/2025,Rice,1,100\n", { commit: "1" });
    const today = new Date().toISOString().slice(0, 10);
    const q = async (ch: string) => (await (await request.get(`/api/sales?from=2025-01-01&to=${today}&channel=${ch}`, { headers: o.headers })).json()).sales.length;
    expect(await q("pos")).toBe(1);
    expect(await q("import")).toBe(1);
  });
});

test.describe("Undo", () => {
  test("taking an upload back removes its sales, people and items and reverses the figures", async ({ request }) => {
    const o = await newOwner(request);
    const rice = await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 5200, 40, { cost: 3900 });
    // Today's real business must survive the undo.
    await request.post("/api/sales", { headers: o.headers, data: { items: [{ productId: rice, qty: 1 }], payments: [{ method: "cash", amount: 5200 }] } });

    const saved = await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json();
    expect(await salesCount(o.businessId, "import")).toBe(3);

    const batches = (await (await request.get("/api/history-import/batches", { headers: o.headers })).json()).batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ fileName: "data.csv", sales: 3, status: "active", newCustomers: 1, newProducts: 2 });

    const undo = await request.post(`/api/history-import/batches/${saved.batchId}/undo`, { headers: o.headers });
    expect(undo.status()).toBe(200);
    expect((await undo.json()).removed).toBe(3);

    expect(await salesCount(o.businessId, "import")).toBe(0);
    expect(await salesCount(o.businessId)).toBe(1);                      // today's sale is still there
    expect((await metricFor(o.businessId, "2025-03-15"))!.revenue).toBe(0); // the history's contribution is gone
    expect(await customerDoc(o.businessId, "Ada Obi")).toBeNull();
    expect(await productInBusiness(o.businessId, "Oil")).toBeNull();
    expect(await productInBusiness(o.businessId, "Rice")).toBeTruthy(); // the real product stays
    expect(await stockLevel(o.branchId, rice)).toBe(39);                 // only today's sale moved stock

    // It can't be undone twice, and the list says so.
    expect((await request.post(`/api/history-import/batches/${saved.batchId}/undo`, { headers: o.headers })).status()).toBe(409);
    expect((await (await request.get("/api/history-import/batches", { headers: o.headers })).json()).batches[0].status).toBe("undone");

    // …and the same file can then be loaded again properly.
    const again = await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json();
    expect(again.created).toBe(3);
  });

  test("one business can't undo another's upload", async ({ request }) => {
    const a = await newOwner(request, "a");
    const b = await newOwner(request, "b");
    const saved = await (await uploadCsv(request, URL, a, CSV, { commit: "1" })).json();
    expect((await request.post(`/api/history-import/batches/${saved.batchId}/undo`, { headers: b.headers })).status()).toBe(409);
    expect(await salesCount(a.businessId, "import")).toBe(3);
  });
});

test.describe("Access", () => {
  test("is a Pro feature: available on the trial, paused after", async ({ request }) => {
    const o = await newOwner(request);
    expect((await uploadCsv(request, URL, o, CSV)).status()).toBe(200);
    await setTrialEnd(o.accountId, -1);
    const r = await uploadCsv(request, URL, o, CSV);
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe("plan_required");
  });

  test("offers a template file to start from", async ({ request }) => {
    const o = await newOwner(request);
    const r = await request.get("/api/history-import/template.csv", { headers: o.headers });
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text).toContain("Date,Receipt No,Item,Quantity,Unit Price,Customer,Phone,Payment Method");
    // …and the template itself imports cleanly.
    const preview = await (await uploadCsv(request, URL, o, text.replace("﻿", ""))).json();
    expect(preview.totals.invalid).toBe(0);
    expect(preview.totals.sales).toBe(2);
  });
});

test.describe("Seeing what was uploaded", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function signIn(page: import("@playwright/test").Page, email: string) {
    await page.addInitScript(() => localStorage.setItem("startrack.tour.dashboard-v1", "1"));
    await page.goto("/login");
    await page.getByPlaceholder("Email address").fill(email);
    await page.getByPlaceholder("Password").fill("OwnerPass123");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
  }

  test("each upload has a View sales link that opens exactly its records, even from last year", async ({ page, request }) => {
    const o = await newOwner(request);
    await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 5200, 40, { cost: 3900 });
    // A normal till sale today, so the page has something that is NOT part of the upload.
    const rice = (await (await request.get("/api/products", { headers: o.headers })).json()).products[0].id;
    await request.post("/api/sales", { headers: o.headers, data: { items: [{ productId: rice, qty: 1 }], payments: [{ method: "cash", amount: 5200 }] } });
    expect((await (await uploadCsv(request, URL, o, CSV, { commit: "1" })).json()).created).toBe(3);

    await signIn(page, o.email);
    await page.goto("/app/import-history");
    await page.getByRole("link", { name: "View sales" }).click();

    // March 2025 is far outside "this month", yet its three sales are right there.
    await expect(page).toHaveURL(/\/app\/sales\?batch=/);
    await expect(page.getByTestId("batch-banner")).toContainText("Showing the sales from");
    await expect(page.locator("tbody").getByText("Imported history").first()).toBeVisible();   // the staff column: these came from a file
    await expect(page.locator("tbody").getByText("imported", { exact: true }).first()).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(3);   // only the upload, not today's till sale

    // A way back to everything.
    await page.getByRole("button", { name: "Show all sales" }).click();
    await expect(page.getByTestId("batch-banner")).toHaveCount(0);
    await expect(page.locator("tbody tr")).toHaveCount(1);   // this month: just the till sale
  });

  test("the upload's records show whichever branch is selected, and the API refuses another business's upload id", async ({ request }) => {
    const a = await newOwner(request);
    const b = await newOwner(request);
    await seedProduct(a.accountId, a.businessId, a.branchId, "Rice", 5200, 40, { cost: 3900 });
    await uploadCsv(request, URL, a, CSV, { commit: "1" });
    const batchId = (await (await request.get("/api/history-import/batches", { headers: a.headers })).json()).batches[0].id;

    const mine = await (await request.get(`/api/sales?batchId=${batchId}&from=2000-01-01&to=2099-01-01`, { headers: a.headers })).json();
    expect(mine.sales).toHaveLength(3);
    expect(mine.sales.every((s: any) => s.channel === "import")).toBe(true);
    const theirs = await (await request.get(`/api/sales?batchId=${batchId}&from=2000-01-01&to=2099-01-01`, { headers: b.headers })).json();
    expect(theirs.sales).toHaveLength(0);
  });
});
