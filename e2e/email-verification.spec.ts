import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { closeDb, db, payFor } from "./support/db";
import { codeIn, mailTo, newCode } from "./support/mailbox";
import { freshIp } from "./support/owner";

/**
 * Email verification, end to end over real SMTP (to a pretend mail server, see
 * support/smtp.ts): a code is emailed at sign-up, can be re-sent, is checked, and
 * unlocks the "verified" state, with the limits that stop it being guessed.
 */
test.afterAll(closeDb);

let n = 0;
async function signUp(request: APIRequestContext) {
  const email = `verify-${Date.now().toString(36)}-${++n}@example.test`;
  const res = await request.post("/api/auth/register", {
    headers: { "x-forwarded-for": freshIp() },
    data: { name: "Verify Me", email, phone: "08031112222", password: "OwnerPass123", businessName: `Verify Shop ${n}`, businessType: "supermarket", plan: "free" },
  });
  expect(res.status()).toBe(201);
  const s = await res.json();
  await payFor(s.account.id, "free");
  return { email, token: s.token as string, headers: { Authorization: `Bearer ${s.token}` } };
}
const verified = async (email: string) => !!(await (await db()).collection("users").findOne({ email }))?.emailVerified;

test.describe("The code", () => {
  test("is emailed the moment someone signs up, from the app's mail account", async ({ request }) => {
    const u = await signUp(request);
    const mail = await mailTo(u.email, /Verify your email/);
    expect(mail.to).toEqual([u.email]);
    expect(mail.from).toBe("app@example.test");              // sent as the signed-in account, as Gmail requires
    expect(codeIn(mail)).toMatch(/^\d{6}$/);
    expect(mail.html).toContain("expires in 10 minutes");
    expect(await verified(u.email)).toBe(false);              // not verified until the code comes back
  });

  test("the right code verifies the address — once", async ({ request }) => {
    const u = await signUp(request);
    const code = codeIn(await mailTo(u.email, /Verify your email/));
    const ok = await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code } });
    expect(ok.status()).toBe(200);
    expect(await verified(u.email)).toBe(true);
    expect((await (await request.get("/api/auth/me", { headers: u.headers })).json()).emailVerified).toBe(true);
    // The same code is spent.
    const again = await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code } });
    expect(again.status()).toBeGreaterThanOrEqual(400);
  });

  test("a wrong code is refused, and guessing runs out", async ({ request }) => {
    const u = await signUp(request);
    const code = codeIn(await mailTo(u.email, /Verify your email/));
    const wrong = code === "000000" ? "111111" : "000000";
    const first = await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code: wrong } });
    expect(first.status()).toBe(400);
    expect((await first.json()).error).toBe("bad_code");
    for (let i = 0; i < 4; i++) await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code: wrong } });
    // After enough wrong tries even the right code stops working: a new one has to be requested.
    const late = await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code } });
    expect(late.status()).toBe(409);
    expect((await late.json()).error).toBe("too_many_attempts");
    expect(await verified(u.email)).toBe(false);
  });

  test("an expired code is refused", async ({ request }) => {
    const u = await signUp(request);
    const code = codeIn(await mailTo(u.email, /Verify your email/));
    await (await db()).collection("verificationcodes").updateMany({ target: u.email }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
    const r = await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe("expired");
  });

  test("one person's code can't verify someone else's address", async ({ request }) => {
    const a = await signUp(request);
    const b = await signUp(request);
    const codeA = codeIn(await mailTo(a.email, /Verify your email/));
    await mailTo(b.email, /Verify your email/);   // B has their own code waiting too
    const r = await request.post("/api/verify/confirm", { headers: b.headers, data: { channel: "email", code: codeA } });
    expect(r.status()).toBe(400);
    expect(await verified(b.email)).toBe(false);
  });

  test("can be sent again, a new code replaces the old, and sending is limited", async ({ request }) => {
    const u = await signUp(request);
    const first = codeIn(await mailTo(u.email, /Verify your email/));
    expect((await request.post("/api/verify/request", { headers: u.headers, data: { channel: "email" } })).status()).toBe(200);
    // Wait for the second email (a different code from the first).
    let second = first;
    for (let i = 0; i < 40 && second === first; i++) { await new Promise((r) => setTimeout(r, 250)); second = codeIn(await mailTo(u.email, /Verify your email/)); }
    expect(second).not.toBe(first);
    expect((await request.post("/api/verify/confirm", { headers: u.headers, data: { channel: "email", code: second } })).status()).toBe(200);
    // Already verified: asking again just says so.
    const done = await (await request.post("/api/verify/request", { headers: u.headers, data: { channel: "email" } })).json();
    expect(done.alreadyVerified).toBe(true);
  });

  test("asking for codes over and over is throttled", async ({ request }) => {
    const u = await signUp(request);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await request.post("/api/verify/request", { headers: u.headers, data: { channel: "email" } })).status());
    expect(statuses).toContain(429);
  });

  test("needs a signed-in person", async ({ request }) => {
    expect((await request.post("/api/verify/request", { data: { channel: "email" } })).status()).toBe(401);
    expect((await request.post("/api/verify/confirm", { data: { channel: "email", code: "123456" } })).status()).toBe(401);
  });
});

test.describe("In the app", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a new owner is asked to verify, gets the email, types the code, and is done", async ({ page, request }) => {
    const u = await signUp(request);
    await page.addInitScript(() => localStorage.setItem("startrack.tour.dashboard-v1", "1"));
    await page.goto("/login");
    await page.getByPlaceholder("Email address").fill(u.email);
    await page.getByPlaceholder("Password").fill("OwnerPass123");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText(/Verify your email/).first()).toBeVisible({ timeout: 15_000 });
    const signupCode = codeIn(await mailTo(u.email, /Verify your email/));
    await page.getByRole("button", { name: "Send code" }).first().click();

    const code = await newCode(u.email, signupCode);      // clicking Send issues a fresh code, replacing the sign-up one
    await page.getByPlaceholder("6-digit code").fill(code);
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByPlaceholder("6-digit code")).toHaveCount(0);   // that channel is done
    await expect.poll(() => verified(u.email)).toBe(true);
  });

  test("a wrong code says so on screen", async ({ page, request }) => {
    const u = await signUp(request);
    await page.addInitScript(() => localStorage.setItem("startrack.tour.dashboard-v1", "1"));
    await page.goto("/login");
    await page.getByPlaceholder("Email address").fill(u.email);
    await page.getByPlaceholder("Password").fill("OwnerPass123");
    await page.getByRole("button", { name: "Sign In" }).click();
    const signupCode = codeIn(await mailTo(u.email, /Verify your email/));
    await page.getByRole("button", { name: "Send code" }).first().click();
    const code = await newCode(u.email, signupCode);
    await page.getByPlaceholder("6-digit code").fill(code === "123456" ? "654321" : "123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Incorrect code.")).toBeVisible();
  });
});

test.describe("When email isn't set up", () => {
  const run = (env: Record<string, string>) =>
    JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
      `import { sendMail, mailEnabled } from "./server/core/mailer.js";
       const r = await sendMail({ to: ["someone@example.test"], subject: "x", html: "<p>x</p>" });
       console.log(JSON.stringify({ enabled: mailEnabled(), ...r }));`],
      { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop()!);

  test("the mailer stays off and says so, rather than pretending to send", () => {
    expect(run({ SMTP_USER: "", SMTP_PASS: "" })).toEqual({ enabled: false, sent: false, reason: "not_configured" });
    expect(run({ SMTP_USER: "me@gmail.com", SMTP_PASS: "" }).enabled).toBe(false);   // half set up is still off
  });

  test("a mail server that can't be reached gives a reason a person can act on, and never throws", () => {
    const r = run({ SMTP_USER: "me@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_SECURE: "false" });
    expect(r).toMatchObject({ enabled: true, sent: false });
    expect(r.reason).toMatch(/Couldn't reach the email server/);
  });
});
