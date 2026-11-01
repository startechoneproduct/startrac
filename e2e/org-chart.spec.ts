import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import mongoose from "mongoose";
import { closeDb, db } from "./support/db";
import { newOwner, type Owner } from "./support/owner";

/** The organization chart in the Staff module: the company as a hierarchy, owner at the top. */
test.afterAll(closeDb);
test.use({ viewport: { width: 1440, height: 900 } });

let pinN = 1000;
async function hire(request: APIRequestContext, o: Owner, name: string, role: "admin" | "manager" | "staff", extra: Record<string, unknown> = {}) {
  const email = role === "admin" ? `${name.toLowerCase().replace(/\W/g, "")}-${Date.now().toString(36)}@example.test` : undefined;
  const r = await request.post("/api/staff", {
    headers: o.headers,
    data: { name, role, pin: String(++pinN), ...(role !== "admin" ? { branchId: o.branchId } : {}), ...(email ? { email, password: "StaffPass123" } : {}), ...extra },
  });
  expect(r.status(), JSON.stringify(await r.json())).toBe(201);
  return (await r.json()).staff.id as string;
}

/** Owner → Ada Admin → Mo Manager → Sade Staff; Tunde Staff has no manager set. */
async function team(request: APIRequestContext) {
  const o = await newOwner(request);
  const ada = await hire(request, o, "Ada Admin", "admin", { position: "General Manager" });
  const mo = await hire(request, o, "Mo Manager", "manager", { position: "Floor Manager", reportsToId: ada });
  const sade = await hire(request, o, "Sade Staff", "staff", { position: "Cashier", reportsToId: mo });
  const tunde = await hire(request, o, "Tunde Staff", "staff", { position: "Stock Clerk" });
  return { o, ada, mo, sade, tunde };
}

const chart = async (request: APIRequestContext, o: Owner) => (await (await request.get("/api/staff/org-chart", { headers: o.headers })).json());
const names = (nodes: any[]) => nodes.map((n) => n.name);

test.describe("The hierarchy", () => {
  test("is a tree with the owner at the top and each person under their manager", async ({ request }) => {
    const { o } = await team(request);
    const c = await chart(request, o);
    expect(c.total).toBe(5);
    expect(c.chart).toHaveLength(1);                                     // one top: the owner
    const owner = c.chart[0];
    expect(owner.role).toBe("owner");
    expect(names(owner.children)).toEqual(["Ada Admin", "Tunde Staff"]); // admins first, then staff
    const ada = owner.children[0];
    expect(ada).toMatchObject({ position: "General Manager", inferred: true });   // no manager named: under the owner by default
    expect(ada.children[0].inferred).toBe(false);                                // Mo was explicitly set to report to Ada
    expect(names(ada.children)).toEqual(["Mo Manager"]);
    expect(names(ada.children[0].children)).toEqual(["Sade Staff"]);
    expect(ada.children[0].children[0].branchName).toBeTruthy();
  });

  test("someone with no manager set sits under the owner and is marked as such", async ({ request }) => {
    const { o } = await team(request);
    const tunde = (await chart(request, o)).chart[0].children.find((n: any) => n.name === "Tunde Staff");
    expect(tunde.inferred).toBe(true);
  });

  test("moving a manager moves their whole team with them", async ({ request }) => {
    const { o, mo, tunde } = await team(request);
    const r = await request.patch(`/api/staff/${mo}`, { headers: o.headers, data: { reportsToId: tunde } });
    expect(r.status()).toBe(200);
    const owner = (await chart(request, o)).chart[0];
    const t = owner.children.find((n: any) => n.name === "Tunde Staff");
    expect(names(t.children)).toEqual(["Mo Manager"]);
    expect(names(t.children[0].children)).toEqual(["Sade Staff"]);
  });

  test("a reporting loop can't be created, and people who left drop off the chart", async ({ request }) => {
    const { o, ada, mo, sade } = await team(request);
    // Ada reporting to Sade (who is below her) would make a circle.
    const loop = await request.patch(`/api/staff/${ada}`, { headers: o.headers, data: { reportsToId: sade } });
    expect(loop.status()).toBe(400);
    // Suspend Mo: he leaves the chart; Sade, left without a manager, falls under the owner.
    await request.patch(`/api/staff/${mo}`, { headers: o.headers, data: { status: "inactive" } });
    const c = await chart(request, o);
    expect(c.total).toBe(4);
    expect(names(c.chart[0].children)).toContain("Sade Staff");
  });

  test("shows the whole business whichever branch is selected, and nothing from another business", async ({ request }) => {
    const { o } = await team(request);
    const other = await newOwner(request);
    await hire(request, other, "Stranger Danger", "staff");
    const c = await chart(request, o);
    expect(JSON.stringify(c)).not.toContain("Stranger");
    expect((await chart(request, other)).total).toBe(2);
  });

  test("only people who manage staff can see it", async ({ request }) => {
    const { o } = await team(request);
    const code = (await (await db()).collection("businesses").findOne({ _id: new mongoose.Types.ObjectId(o.businessId) }))!.code;
    const till = await (await request.post("/api/auth/till", { data: { businessCode: code, pin: String(pinN) } })).json();
    const r = await request.get("/api/staff/org-chart", { headers: { ...o.headers, Authorization: `Bearer ${till.token}` } });
    expect(r.status()).toBe(403);
    expect((await request.get("/api/staff/org-chart")).status()).toBe(401);
  });
});

test.describe("The chart on screen", () => {
  async function open(page: Page, o: Owner) {
    await page.addInitScript(() => localStorage.setItem("startrack.tour.dashboard-v1", "1"));
    await page.goto("/login");
    await page.getByPlaceholder("Email address").fill(o.email);
    await page.getByPlaceholder("Password").fill("OwnerPass123");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await page.goto("/app/staff");
    await page.getByRole("button", { name: "Org chart" }).click();
    await expect(page.getByTestId("org-chart")).toBeVisible();
  }

  test("the button opens a hierarchy: owner on top, every person as a card under their manager", async ({ page, request }) => {
    const { o } = await team(request);
    await open(page, o);
    const nodes = page.getByTestId("org-node");
    await expect(nodes).toHaveCount(5);
    const box = async (name: string) => (await page.locator(`[data-name="${name}"]`).boundingBox())!;
    const [owner, ada, mo, sade, tunde] = [await box("Test Owner"), await box("Ada Admin"), await box("Mo Manager"), await box("Sade Staff"), await box("Tunde Staff")];
    // Higher in the hierarchy = higher on the page.
    expect(owner.y).toBeLessThan(ada.y);
    expect(ada.y).toBeLessThan(mo.y);
    expect(mo.y).toBeLessThan(sade.y);
    expect(tunde.y).toBeCloseTo(ada.y, 0);               // same level as Ada, both under the owner
    expect(tunde.x).toBeGreaterThan(ada.x);              // side by side, not stacked
    await expect(page.locator('[data-name="Ada Admin"]')).toContainText("General Manager");
    await expect(page.locator('[data-name="Ada Admin"]')).toContainText("Admin");
    await page.getByTestId("org-chart").screenshot({ path: "test-results/org-chart.png" });
  });

  test("a branch of the tree can be folded away and brought back", async ({ page, request }) => {
    const { o } = await team(request);
    await open(page, o);
    await page.getByRole("button", { name: /Hide the 1 person who report to Ada Admin/ }).click();
    await expect(page.getByTestId("org-node")).toHaveCount(3);                       // Mo and Sade are tucked away
    await expect(page.locator('[data-name="Mo Manager"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(page.getByTestId("org-node")).toHaveCount(5);
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByTestId("org-node")).toHaveCount(1);                       // only the owner remains
  });

  test("a new business with no team yet still shows its owner, not an empty box", async ({ page, request }) => {
    const o = await newOwner(request);
    await open(page, o);
    await expect(page.getByTestId("org-node")).toHaveCount(1);
    await expect(page.locator('[data-role="owner"]')).toBeVisible();
  });
});
