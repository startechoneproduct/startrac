import { expect, test, type APIRequestContext } from "@playwright/test";
import { closeDb, customerDoc, invoiceSale, localToday, metricFor, movementsFor, productInBusiness, salesCount, seedProduct, setTrialEnd, setVat, stockLevel } from "./support/db";
import { mailTo } from "./support/mailbox";
import { newOwner, type Owner } from "./support/owner";

/**
 * Invoices: drafted, issued (stock out, the sale recorded as owed, the customer's
 * balance up), paid in parts, overdue, sent, viewed by the customer, and voided
 * cleanly. The numbers here are worked out by hand so a wrong total can't hide.
 */
test.afterAll(closeDb);

const BASE = "/api/invoices";
const post = (r: APIRequestContext, o: Owner, path: string, data?: unknown) => r.post(`${BASE}${path}`, { headers: o.headers, data });
const get = async (r: APIRequestContext, o: Owner, path: string) => (await r.get(`${BASE}${path}`, { headers: o.headers })).json();

async function shop(request: APIRequestContext) {
  const o = await newOwner(request);
  const rice = await seedProduct(o.accountId, o.businessId, o.branchId, "Rice", 1000, 20, { cost: 700 });
  const oil = await seedProduct(o.accountId, o.businessId, o.branchId, "Oil", 2000, 3, { cost: 1500 });
  return { o, rice, oil };
}
const draft = async (request: APIRequestContext, o: Owner, body: Record<string, unknown>) => {
  const r = await post(request, o, "", body);
  expect(r.status(), JSON.stringify(await r.json().catch(() => ({})))).toBe(201);
  return (await r.json()).invoice;
};
const customer = { name: "Ada Obi", phone: "08031110001", email: "ada@example.test", address: "12 Lekki Road" };

test.describe("Drafting", () => {
  test("works out the totals on the server: lines, discount and VAT", async ({ request }) => {
    const { o, rice } = await shop(request);
    await setVat(o.businessId, 7.5);
    const inv = await draft(request, o, { customer, applyVat: true, discountPct: 10, items: [{ productId: rice, qty: 2 }, { name: "Delivery", qty: 1, unitPrice: 500 }] });
    // 2 × 1,000 + 500 = 2,500; 10% off = 2,250; VAT 7.5% = 168.75; total 2,418.75
    expect(inv).toMatchObject({ status: "draft", subtotal: 2500, discount: 250, vatRate: 7.5, vat: 168.75, total: 2418.75, balance: 0, invoiceNo: "" });
    expect(inv.items[0]).toMatchObject({ name: "Rice", unitPrice: 1000, lineNet: 2000 }); // price and name came from the catalog
    expect(inv.dueDate).toBeTruthy();                                                      // default 14 days out
    // A draft touches nothing.
    expect(await stockLevel(o.branchId, rice)).toBe(20);
    expect(await salesCount(o.businessId, "invoice")).toBe(0);
    expect(await customerDoc(o.businessId, "Ada Obi")).toBeNull();
  });

  test("VAT is only added when the business has VAT switched on", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = await draft(request, o, { customer, applyVat: true, items: [{ productId: rice, qty: 1 }] });
    expect(inv.vat).toBe(0);
    expect(inv.total).toBe(1000);
  });

  test("a negotiated price overrides the catalog; a fixed discount is capped at the subtotal", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = await draft(request, o, { customer, discount: 99999, items: [{ productId: rice, qty: 3, unitPrice: 900 }] });
    expect(inv.subtotal).toBe(2700);
    expect(inv.discount).toBe(2700);
    expect(inv.total).toBe(0);
  });

  test("refuses lines it can't trust", async ({ request }) => {
    const { o, rice } = await shop(request);
    const other = await shop(request);
    const bad = async (items: unknown[], why: string) => {
      const r = await post(request, o, "", { customer, items });
      expect(r.status(), why).toBe(400);
    };
    await bad([{ name: "No price", qty: 1 }], "a custom line needs a price");
    await bad([{ unitPrice: 5, qty: 1 }], "a custom line needs a description");
    await bad([{ productId: rice, qty: 0 }], "zero quantity");
    await bad([{ productId: other.rice, qty: 1 }], "another business's product");
    expect((await post(request, o, "", { customer, items: [] })).status()).toBe(400);
  });

  test("a draft can be changed and deleted; an issued invoice cannot", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    const edited = await request.put(`${BASE}/${inv.id}`, { headers: o.headers, data: { customer, items: [{ productId: rice, qty: 5 }] } });
    expect((await edited.json()).invoice.total).toBe(5000);
    expect((await request.delete(`${BASE}/${inv.id}`, { headers: o.headers })).status()).toBe(200);
    expect((await request.get(`${BASE}/${inv.id}`, { headers: o.headers })).status()).toBe(404);

    const live = await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    await post(request, o, `/${live.id}/issue`);
    expect((await request.put(`${BASE}/${live.id}`, { headers: o.headers, data: { customer, items: [{ productId: rice, qty: 9 }] } })).status()).toBe(409);
    expect((await request.delete(`${BASE}/${live.id}`, { headers: o.headers })).status()).toBe(409);
  });
});

test.describe("Issuing", () => {
  test("takes the stock out, records the sale as owed, and puts it on the customer's account", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = await draft(request, o, { customer, items: [{ productId: rice, qty: 4 }] }); // 4,000
    const r = await post(request, o, `/${inv.id}/issue`);
    expect(r.status()).toBe(200);
    const issued = (await r.json()).invoice;

    expect(issued).toMatchObject({ status: "issued", invoiceNo: "INV-0001", total: 4000, balance: 4000, amountPaid: 0 });
    expect(issued.shareUrl).toMatch(/\/i\/[a-f0-9]{32}$/);
    expect(await stockLevel(o.branchId, rice)).toBe(16);

    const sale = await invoiceSale(o.businessId, "INV-0001");
    expect(sale).toMatchObject({ channel: "invoice", total: 4000, status: "completed", customerName: "Ada Obi" });
    expect(sale!.payments).toEqual([{ method: "credit", amount: 4000 }]); // owed, not paid

    const ada = await customerDoc(o.businessId, "Ada Obi");
    expect(ada).toMatchObject({ totalSpend: 4000, visits: 1, creditBalance: 4000 });
    expect(ada!.phone).toBe("08031110001");

    // Revenue is booked today (accrual); no cash has been collected yet.
    const day = await metricFor(o.businessId, localToday());
    expect(day).toMatchObject({ revenue: 4000, txns: 1 });
    expect(day!.cost).toBe(2800);
    expect(day!.paymentSplit.cash + day!.paymentSplit.pos + day!.paymentSplit.transfer).toBe(0);

    // The ledger explains the stock movement.
    expect((await movementsFor(rice)).at(-1)).toMatchObject({ type: "OUT", qty: -4, refType: "invoice", reason: "Invoice INV-0001" });
  });

  test("won't issue what you can't supply — and changes nothing when it refuses", async ({ request }) => {
    const { o, rice, oil } = await shop(request);
    const inv = await draft(request, o, { customer, items: [{ productId: rice, qty: 2 }, { productId: oil, qty: 5 }] }); // only 3 oil
    const r = await post(request, o, `/${inv.id}/issue`);
    expect(r.status()).toBe(409);
    expect((await r.json()).message).toContain("Oil");
    expect(await stockLevel(o.branchId, rice)).toBe(20);  // the rice that WAS available wasn't taken either
    expect(await stockLevel(o.branchId, oil)).toBe(3);
    expect(await salesCount(o.businessId, "invoice")).toBe(0);
    expect((await get(request, o, `/${inv.id}`)).invoice.status).toBe("draft");
  });

  test("needs a customer, and can only be issued once", async ({ request }) => {
    const { o, rice } = await shop(request);
    const anon = await draft(request, o, { items: [{ productId: rice, qty: 1 }] });
    expect((await post(request, o, `/${anon.id}/issue`)).status()).toBe(400);

    const inv = await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    expect((await post(request, o, `/${inv.id}/issue`)).status()).toBe(200);
    const again = await post(request, o, `/${inv.id}/issue`);
    expect(again.status()).toBe(409);
    expect(await stockLevel(o.branchId, rice)).toBe(19); // taken once, not twice
  });

  test("invoice numbers run without gaps, even when drafts are deleted", async ({ request }) => {
    const { o, rice } = await shop(request);
    const mk = () => draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    const a = await mk(); const junk = await mk(); const b = await mk();
    await request.delete(`${BASE}/${junk.id}`, { headers: o.headers });
    expect((await (await post(request, o, `/${a.id}/issue`)).json()).invoice.invoiceNo).toBe("INV-0001");
    expect((await (await post(request, o, `/${b.id}/issue`)).json()).invoice.invoiceNo).toBe("INV-0002");
  });

  test("services and fees (custom lines) bill without touching stock, and still appear in sales", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = await draft(request, o, { customer, items: [{ name: "Installation", qty: 1, unitPrice: 15000 }, { productId: rice, qty: 1 }] });
    await post(request, o, `/${inv.id}/issue`);
    expect(await stockLevel(o.branchId, rice)).toBe(19); // only the product moved
    const svc = await productInBusiness(o.businessId, "Installation");
    expect(svc).toMatchObject({ status: "archived", serviceItem: true }); // a stand-in, never on the till
    const sale = await invoiceSale(o.businessId, "INV-0001");
    expect(sale!.items.map((i: any) => i.name).sort()).toEqual(["Installation", "Rice"]);
    expect(sale!.total).toBe(16000);
  });

  test("links to an existing customer by phone instead of adding a duplicate", async ({ request }) => {
    const { o, rice } = await shop(request);
    await request.post("/api/customers", { headers: o.headers, data: { name: "Ada (till)", phone: "08031110001" } });
    const inv = await draft(request, o, { customer: { name: "Ada Obi", phone: "0803 111 0001" }, items: [{ productId: rice, qty: 1 }] });
    await post(request, o, `/${inv.id}/issue`);
    const list = (await (await request.get("/api/customers?q=Ada", { headers: o.headers })).json()).customers;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Ada (till)", creditBalance: 1000 });
  });
});

test.describe("Payments", () => {
  async function issued(request: APIRequestContext, qty = 4) {
    const s = await shop(request);
    const inv = await draft(request, s.o, { customer, items: [{ productId: s.rice, qty }] });
    const issuedInv = (await (await post(request, s.o, `/${inv.id}/issue`)).json()).invoice;
    return { ...s, inv: issuedInv };
  }

  test("a part-payment, then the rest: balances fall on the invoice AND the customer's account", async ({ request }) => {
    const { o, inv } = await issued(request); // 4,000
    const p1 = (await (await post(request, o, `/${inv.id}/payments`, { method: "transfer", amount: 1500, note: "deposit" })).json()).invoice;
    expect(p1).toMatchObject({ status: "partial", amountPaid: 1500, balance: 2500 });
    expect(p1.payments[0]).toMatchObject({ method: "transfer", amount: 1500, note: "deposit" });
    expect((await customerDoc(o.businessId, "Ada Obi"))!.creditBalance).toBe(2500);

    const day = await metricFor(o.businessId, localToday());
    expect(day!.paymentSplit.transfer).toBe(1500);  // cash collected shows in today's split…
    expect(day!.revenue).toBe(4000);                 // …but revenue isn't counted twice

    const p2 = (await (await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 2500 })).json()).invoice;
    expect(p2).toMatchObject({ status: "paid", balance: 0, amountPaid: 4000 });
    expect((await customerDoc(o.businessId, "Ada Obi"))!.creditBalance).toBe(0);
  });

  test("won't take more than is owed, or a payment on something already settled", async ({ request }) => {
    const { o, inv } = await issued(request);
    const over = await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 4001 });
    expect(over.status()).toBe(400);
    expect((await over.json()).error).toBe("overpayment");
    expect((await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 0 })).status()).toBe(400);
    expect((await post(request, o, `/${inv.id}/payments`, { method: "cheque", amount: 10 })).status()).toBe(400);
    await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 4000 });
    expect((await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 1 })).status()).toBe(409);
    expect((await customerDoc(o.businessId, "Ada Obi"))!.creditBalance).toBe(0);
  });

  test("a payment recorded by mistake can be removed, and everything follows", async ({ request }) => {
    const { o, inv } = await issued(request);
    const paid = (await (await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 4000 })).json()).invoice;
    expect(paid.status).toBe("paid");
    const gone = await request.delete(`${BASE}/${inv.id}/payments/${paid.payments[0].id}`, { headers: o.headers });
    const back = (await gone.json()).invoice;
    expect(back).toMatchObject({ status: "issued", amountPaid: 0, balance: 4000 });
    expect((await customerDoc(o.businessId, "Ada Obi"))!.creditBalance).toBe(4000);
    expect((await metricFor(o.businessId, localToday()))!.paymentSplit.cash).toBe(0);
  });
});

test.describe("Overdue", () => {
  test("is worked out from the due date, never stored — and clears once it's paid", async ({ request }) => {
    const s = await shop(request);
    const mk = async (qty: number) => (await (await post(request, s.o, `/${(await draft(request, s.o, { customer, items: [{ productId: s.rice, qty }] })).id}/issue`)).json()).invoice;
    const late = await mk(1);
    const fine = await mk(2);
    const settled = await mk(3);

    const yesterday = new Date(Date.now() - 86_400_000 * 3).toISOString();
    await request.patch(`${BASE}/${late.id}`, { headers: s.o.headers, data: { dueDate: yesterday } });
    await request.patch(`${BASE}/${settled.id}`, { headers: s.o.headers, data: { dueDate: yesterday } });
    await post(request, s.o, `/${settled.id}/payments`, { method: "cash", amount: 3000 });

    const l = await get(request, s.o, `/${late.id}`);
    expect(l.invoice).toMatchObject({ status: "issued", displayStatus: "overdue", overdue: true });
    expect(l.invoice.daysOverdue).toBeGreaterThanOrEqual(2);
    expect((await get(request, s.o, `/${fine.id}`)).invoice.displayStatus).toBe("issued");
    expect((await get(request, s.o, `/${settled.id}`)).invoice.displayStatus).toBe("paid");

    const list = await get(request, s.o, "?status=overdue");
    expect(list.invoices.map((i: any) => i.invoiceNo)).toEqual([late.invoiceNo]);
    expect(list.summary).toMatchObject({ overdue: 1000, overdueCount: 1, outstanding: 3000, outstandingCount: 2 });
    expect(list.summary.collectedThisMonth).toBe(3000);
  });
});

test.describe("Voiding", () => {
  test("undoes everything: stock back, sale cancelled, figures and the customer's account reversed", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = await draft(request, o, { customer, items: [{ productId: rice, qty: 4 }] });
    await post(request, o, `/${inv.id}/issue`);
    await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 1000 });
    expect(await stockLevel(o.branchId, rice)).toBe(16);

    expect((await post(request, o, `/${inv.id}/void`, { reason: "x" })).status()).toBe(400); // a real reason, please
    const r = await post(request, o, `/${inv.id}/void`, { reason: "Customer cancelled the order" });
    expect(r.status()).toBe(200);
    const v = (await r.json()).invoice;
    expect(v.status).toBe("void");
    expect(v.voidInfo.reason).toBe("Customer cancelled the order");

    expect(await stockLevel(o.branchId, rice)).toBe(20);
    expect((await invoiceSale(o.businessId, "INV-0001"))!.status).toBe("voided");
    const day = await metricFor(o.businessId, localToday());
    expect(day).toMatchObject({ revenue: 0, cost: 0, profit: 0, txns: 0 });
    expect(day!.paymentSplit.cash).toBe(0);
    expect(await customerDoc(o.businessId, "Ada Obi")).toMatchObject({ totalSpend: 0, visits: 0, creditBalance: 0 });

    // Nothing more can be done to it.
    expect((await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 1 })).status()).toBe(409);
    expect((await post(request, o, `/${inv.id}/void`, { reason: "again please" })).status()).toBe(409);
    expect((await post(request, o, `/${inv.id}/send`, { via: "link" })).status()).toBe(409);
  });

  test("a draft is deleted, not voided; and the sales screen can't void an invoice's sale behind its back", async ({ request }) => {
    const { o, rice } = await shop(request);
    const d = await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    expect((await post(request, o, `/${d.id}/void`, { reason: "never mind" })).status()).toBe(409);

    await post(request, o, `/${d.id}/issue`);
    const sale = (await (await request.get(`/api/sales?from=2020-01-01&to=${localToday()}&channel=invoice`, { headers: o.headers })).json()).sales[0];
    expect(sale).toMatchObject({ channel: "invoice", saleNo: "INV-0001" });
    const voided = await request.post(`/api/sales/${sale.id}/void`, { headers: o.headers, data: { reason: "trying the back door" } });
    expect(voided.status()).toBe(409);
    expect((await voided.json()).error).toBe("invoice_sale");
    expect(await stockLevel(o.branchId, rice)).toBe(19);
  });
});

test.describe("Sending", () => {
  async function issuedInv(request: APIRequestContext) {
    const s = await shop(request);
    const inv = await draft(request, s.o, { customer, items: [{ productId: s.rice, qty: 2 }] });
    return { ...s, inv: (await (await post(request, s.o, `/${inv.id}/issue`)).json()).invoice };
  }

  test("WhatsApp: a ready message to the customer's number, with the link and the amount", async ({ request }) => {
    const { o, inv } = await issuedInv(request);
    const r = await (await post(request, o, `/${inv.id}/send`, { via: "whatsapp" })).json();
    expect(r.whatsappUrl).toContain("wa.me/2348031110001"); // a 0… Nigerian number becomes 234…
    expect(r.text).toContain("INV-0001");
    expect(r.text).toContain("₦2,000");
    expect(r.text).toContain(inv.shareUrl);
    expect(r.invoice.sends).toHaveLength(1);
    expect(r.invoice.sends[0]).toMatchObject({ via: "whatsapp", kind: "invoice" });
  });

  test("a reminder asks for what's still owed", async ({ request }) => {
    const { o, inv } = await issuedInv(request);
    await post(request, o, `/${inv.id}/payments`, { method: "cash", amount: 500 });
    const r = await (await post(request, o, `/${inv.id}/send`, { via: "whatsapp", kind: "reminder" })).json();
    expect(r.text).toContain("reminder");
    expect(r.text).toContain("₦1,500 outstanding");
  });

  test("email really goes out, with the invoice link, and is counted as sent", async ({ request }) => {
    const { o, inv } = await issuedInv(request);
    const r = await (await post(request, o, `/${inv.id}/send`, { via: "email" })).json();
    expect(r.email.sent).toBe(true);
    expect(r.invoice.sends).toHaveLength(1);
    expect(r.invoice.sends[0]).toMatchObject({ via: "email", to: "ada@example.test" });
    const mail = await mailTo("ada@example.test", /Invoice INV-0001/);
    expect(mail.html).toContain(inv.shareUrl);
    expect((await post(request, o, `/${inv.id}/send`, { via: "email", to: "nonsense" })).status()).toBe(400);
  });

  test("a draft can't be sent: issue it first", async ({ request }) => {
    const { o, rice } = await shop(request);
    const d = await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    const r = await post(request, o, `/${d.id}/send`, { via: "link" });
    expect(r.status()).toBe(409);
    expect((await r.json()).message).toContain("Issue the invoice first");
  });
});

test.describe("What the customer sees", () => {
  test("the link opens the invoice with no login, shows only what they should see, and tells the owner it was viewed", async ({ request }) => {
    const { o, rice } = await shop(request);
    await request.put(`${BASE}/settings`, { headers: o.headers, data: { dueDays: 30, terms: "Net 30", footer: "Thanks!", bankName: "GTBank", accountName: "Shop Ltd", accountNumber: "0123456789" } });
    const inv = (await (await post(request, o, `/${(await draft(request, o, { customer, notes: "Deliver Monday", items: [{ productId: rice, qty: 2 }] })).id}/issue`)).json()).invoice;
    const token = inv.shareUrl.split("/i/")[1];

    const r = await request.get(`/api/public/invoices/${token}`); // note: no auth headers at all
    expect(r.status()).toBe(200);
    const pub = await r.json();
    expect(pub.invoice).toMatchObject({ invoiceNo: "INV-0001", total: 2000, balance: 2000, displayStatus: "issued", notes: "Deliver Monday" });
    expect(pub.invoice.customer.name).toBe("Ada Obi");
    expect(pub.business.name).toContain("Shop");
    expect(pub.business.footer).toBe("Thanks!");
    expect(pub.bank).toMatchObject({ bankName: "GTBank", accountNumber: "0123456789" });

    // Nothing internal leaks: ids, who sent it, how often, cost.
    const raw = JSON.stringify(pub);
    for (const secret of ["customerId", "createdBy", "sends", "viewCount", "shareUrl", "lineCost", "accountId", "businessId"]) expect(raw, secret).not.toContain(secret);

    const mine = (await get(request, o, `/${inv.id}`)).invoice;
    expect(mine.viewCount).toBe(1);
    expect(mine.viewedAt).toBeTruthy();
    // 30-day terms were applied to the due date.
    const days = (new Date(mine.dueDate).getTime() - new Date(mine.issueDate).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  test("a PDF, for the owner and for the customer's link", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = (await (await post(request, o, `/${(await draft(request, o, { customer, items: [{ productId: rice, qty: 2 }, { name: "Delivery", qty: 1, unitPrice: 500 }] })).id}/issue`)).json()).invoice;

    const own = await request.get(`${BASE}/${inv.id}/pdf`, { headers: o.headers });
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("application/pdf");
    expect(own.headers()["content-disposition"]).toContain("INV-0001.pdf");
    const bytes = await own.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);

    const pub = await request.get(`/api/public/invoices/${inv.shareUrl.split("/i/")[1]}/pdf`);
    expect(pub.status()).toBe(200);
    expect((await pub.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("unknown, malformed and draft links all look the same: not available", async ({ request }) => {
    const { o, rice } = await shop(request);
    for (const t of ["0".repeat(32), "short", "../../etc", "G".repeat(32)]) {
      const r = await request.get(`/api/public/invoices/${t}`);
      expect(r.status(), t).toBe(404);
    }
    const d = await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });
    expect(d.shareUrl).toBe(""); // a draft has no link yet
  });

  test("a voided invoice still opens, marked void, with no way to pay", async ({ request }) => {
    const { o, rice } = await shop(request);
    await request.put(`${BASE}/settings`, { headers: o.headers, data: { dueDays: 14, terms: "", footer: "", bankName: "GTBank", accountName: "Shop", accountNumber: "0123456789" } });
    const inv = (await (await post(request, o, `/${(await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] })).id}/issue`)).json()).invoice;
    await post(request, o, `/${inv.id}/void`, { reason: "issued by mistake" });
    const pub = await (await request.get(`/api/public/invoices/${inv.shareUrl.split("/i/")[1]}`)).json();
    expect(pub.invoice.status).toBe("void");
    expect(pub.bank).toBeNull();
  });
});

test.describe("Access and plans", () => {
  test("one business can't see, change or pay another's invoices", async ({ request }) => {
    const a = await shop(request);
    const b = await shop(request);
    const inv = await draft(request, a.o, { customer, items: [{ productId: a.rice, qty: 1 }] });
    await post(request, a.o, `/${inv.id}/issue`);
    expect((await request.get(`${BASE}/${inv.id}`, { headers: b.o.headers })).status()).toBe(404);
    expect((await post(request, b.o, `/${inv.id}/payments`, { method: "cash", amount: 1 })).status()).toBe(404);
    expect((await post(request, b.o, `/${inv.id}/void`, { reason: "not mine to void" })).status()).toBe(404);
    expect((await get(request, b.o, "")).invoices).toHaveLength(0);
  });

  test("invoicing is a Pro tool: on during the trial, paused after, and customers' links keep working", async ({ request }) => {
    const { o, rice } = await shop(request);
    const inv = (await (await post(request, o, `/${(await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] })).id}/issue`)).json()).invoice;
    await setTrialEnd(o.accountId, -1); // back to Freemium

    const r = await request.get(BASE, { headers: o.headers });
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe("plan_required");
    // A customer who was sent an invoice must still be able to read it.
    expect((await request.get(`/api/public/invoices/${inv.shareUrl.split("/i/")[1]}`)).status()).toBe(200);
  });

  test("lists and filters: by status, search, and customer, with the headline totals", async ({ request }) => {
    const { o, rice } = await shop(request);
    const mk = async (cust: any, qty: number) => (await (await post(request, o, `/${(await draft(request, o, { customer: cust, items: [{ productId: rice, qty }] })).id}/issue`)).json()).invoice;
    const a = await mk(customer, 1);
    const b = await mk({ name: "Bola Eze", phone: "08031110002" }, 2);
    await post(request, o, `/${b.id}/payments`, { method: "cash", amount: 2000 });
    await draft(request, o, { customer, items: [{ productId: rice, qty: 1 }] });

    const all = await get(request, o, "");
    expect(all.total).toBe(3);
    expect(all.summary).toMatchObject({ outstanding: 1000, outstandingCount: 1, drafts: 1, collectedThisMonth: 2000 });
    expect((await get(request, o, "?status=paid")).invoices.map((i: any) => i.invoiceNo)).toEqual([b.invoiceNo]);
    expect((await get(request, o, "?status=unpaid")).invoices.map((i: any) => i.invoiceNo)).toEqual([a.invoiceNo]);
    expect((await get(request, o, "?status=draft")).invoices).toHaveLength(1);
    expect((await get(request, o, "?q=bola")).invoices.map((i: any) => i.invoiceNo)).toEqual([b.invoiceNo]);
    expect((await get(request, o, `?q=${a.invoiceNo}`)).invoices).toHaveLength(1);
  });
});
