import { Router } from "express";
import { z } from "zod";
import { User } from "#modules/auth/user.model.js";
import { Account } from "#modules/auth/account.model.js";
import { Business } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { Membership } from "#modules/auth/membership.model.js";
import { hashPassword, checkPassword, signToken, permsForRole } from "#modules/auth/auth.service.js";
import { requireAuth } from "#core/middleware/requireAuth.js";
import { rateLimit, failureGuard } from "#core/rateLimit.js";
import { config } from "#core/config.js";
import { effectivePlan, featuresFor, isPlan, planStatus, PLANS, PAYMENTS_ENABLED } from "#shared/plans.js";
import { typeTemplate } from "#shared/businessTypes.js";
import { createDemoSandbox } from "#modules/auth/demoSeed.js";
import { DEMOS } from "#modules/auth/demoShops.js";
import { withTransaction } from "#core/tx.js";
import { requestVerification } from "#modules/auth/verify.routes.js";
import { issueCode, consumeCode } from "#modules/auth/codes.js";
import { emailPerson, emailOwner, realEmail, button } from "#core/ownerMail.js";
import { esc } from "#core/mailer.js";
import { HttpError } from "#core/httpError.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().default(""),
  password: z.string().min(6, "Password must be at least 6 characters"),
  businessName: z.string().min(2, "Enter your business name"),
  businessType: z.string().default("restaurant"),
  tradingName: z.string().default(""),
  taxId: z.string().default(""),
  employees: z.number().int().min(0).max(100000).default(0),
  currency: z.string().default("₦"),
  branchName: z.string().default("Main Branch"),
  // The plan to try for the first 14 days (chosen on the landing page).
  plan: z.enum(["free", "pro", "business"]).optional(),
});

// POST /api/auth/register — creates user + account + business + branch + owner membership
authRouter.post("/register", async (req, res) => {
  if (!rateLimit(`register:${req.ip}`, { max: 10, windowMs: 60 * 60_000 })) {
    return res.status(429).json({ error: "rate_limited", message: "Too many sign-ups from this address. Please try again later." });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  }
  const d = parsed.data;

  if (await User.findOne({ email: d.email })) {
    return res.status(409).json({ error: "email_taken", message: "That email is already registered." });
  }

  // The five documents that make up a new tenant are one thing: a user with
  // no account, or an account with no branch, is a broken sign-up nobody can
  // recover from. They commit together, or the sign-up never happened.
  // Without transactions (standalone MongoDB) we undo by hand instead.
  const created = {};
  try {
    await withTransaction(async (session) => {
      const passwordHash = await hashPassword(d.password);
      [created.user] = await User.create([{ name: d.name, email: d.email, phone: d.phone, passwordHash }], { session });
      const startPlan = isPlan(d.plan) ? d.plan : config.defaultPlan;
      [created.account] = await Account.create([{
        name: d.businessName, ownerUserId: created.user._id, plan: startPlan,
        // Starts unpaid: no period yet, so the account is read-only until the first payment.
        // That payment (billing.routes.js applyTransaction) starts the paid month, and for a
        // Freemium sign-up also the Pro welcome bonus. See planStatus() in shared/plans.js.
        subscription: { plan: startPlan, trial: false, registeredPlan: startPlan },
      }], { session });
      [created.business] = await Business.create(
        [{
          accountId: created.account._id,
          name: d.businessName,
          typeKey: d.businessType,
        tradingName: d.tradingName,
        taxId: d.taxId,
        employees: d.employees,
          // The business type provisions its defaults (blueprint: type = template).
          settings: { currency: d.currency, modules: typeTemplate(d.businessType).modules },
        }],
        { session }
      );
      [created.branch] = await Branch.create(
        [{
          accountId: created.account._id,
          businessId: created.business._id,
          name: d.branchName,
        }],
        { session }
      );
      [created.membership] = await Membership.create(
        [{
          userId: created.user._id,
          accountId: created.account._id,
          businessId: created.business._id,
          branchId: created.branch._id,
          role: "owner",
        }],
        { session }
      );
    });
  } catch (err) {
    // Only reachable on a deployment without transactions — the abort has
    // already cleaned up everywhere else.
    if (created.membership) await Membership.deleteOne({ _id: created.membership._id }).catch(() => {});
    if (created.branch) await Branch.deleteOne({ _id: created.branch._id }).catch(() => {});
    if (created.business) await Business.deleteOne({ _id: created.business._id }).catch(() => {});
    if (created.account) await Account.deleteOne({ _id: created.account._id }).catch(() => {});
    if (created.user) await User.deleteOne({ _id: created.user._id }).catch(() => {});
    console.error("register error:", err.message);
    return res.status(500).json({ error: "server", message: "Could not create your account. Please try again." });
  }

  // Fire-and-forget: a code is already in the inbox by the time the UI shows
  // the verify nag. Never blocks or fails the sign-up response.
  requestVerification(created.user._id, "email");
  welcomeEmail(created.account, created.user, startPlanOf(req.body)).catch(() => {});

  return res.status(201).json(sessionPayload(created.user, created.account, created.membership, {
    businesses: [created.business],
    branches: [created.branch],
  }));
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 8 wrong passwords per email, 60 per address, then a 15 minute wait.
const LOGIN_BY_EMAIL = { max: 8, windowMs: 15 * 60_000 };
const LOGIN_BY_IP = { max: 60, windowMs: 15 * 60_000 };

// POST /api/auth/login
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "Enter your email and password." });

  // Wrong guesses are counted per email AND per address, and a locked email is refused
  // even with the right password, otherwise the lockout would only slow a guesser down.
  const email = parsed.data.email.toLowerCase();
  const byEmail = failureGuard(`login:e:${email}`, LOGIN_BY_EMAIL);
  const byIp = failureGuard(`login:ip:${req.ip}`, LOGIN_BY_IP);
  if (byEmail.blocked() || byIp.blocked()) {
    return res.status(429).json({ error: "rate_limited", message: "Too many failed attempts. Try again in a few minutes." });
  }
  const user = await User.findOne({ email: parsed.data.email });
  if (!user || !(await checkPassword(parsed.data.password, user.passwordHash))) {
    byEmail.fail(); byIp.fail();
    return res.status(401).json({ error: "bad_credentials", message: "Incorrect email or password." });
  }
  byEmail.clear();
  if (user.status !== "active") {
    return res.status(403).json({ error: "account_suspended", message: "This account is suspended. Please contact support." });
  }

  const membership = await Membership.findOne({ userId: user._id, role: { $in: ["owner", "admin"] } })
    || await Membership.findOne({ userId: user._id });
  if (!membership) return res.status(403).json({ error: "no_business", message: "This account has no business yet." });

  const account = await Account.findById(membership.accountId);
  if (account.status === "suspended") {
    return res.status(403).json({ error: "account_suspended", message: "This account is suspended. Please contact support." });
  }
  const businesses = await Business.find({ accountId: account._id });
  const branches = await Branch.find({ accountId: account._id });

  return res.json(sessionPayload(user, account, membership, { businesses, branches }));
});

// ── welcome, and a forgotten password ───────────────────────────────────────

const startPlanOf = (body) => (isPlan(body?.plan) ? body.plan : config.defaultPlan);

/** The first email a new owner gets: what happens next. Fire-and-forget. */
async function welcomeEmail(account, user, plan) {
  const p = PLANS[plan];
  const next = PAYMENTS_ENABLED
    ? `Your account is ready. To start selling, make your first payment for the ${p.name} plan (₦${p.price.toLocaleString("en-NG")} a month)${plan === "free" ? " and you get 14 days of Pro free with it" : ""}. Until then you can look around but not make changes.`
    : `Your account is ready on the ${p.name} plan. Add your products and make your first sale.`;
  await emailPerson(user.email, {
    subject: `Welcome to StarTrack, ${user.name.split(" ")[0]}`,
    businessName: account.name || "StarTrack",
    heading: `Welcome, ${user.name.split(" ")[0]}`,
    intro: next,
    sections: [config.appUrl ? button(`${config.appUrl.replace(/\/$/, "")}/app/billing`, PAYMENTS_ENABLED ? "Make your first payment" : "Open StarTrack") : "",
      `<p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">We've also sent a separate email with a code to verify your address.</p>`],
    footNote: "You are receiving this because you created a StarTrack account.",
  });
}

const forgotSchema = z.object({ email: z.string().email("Enter a valid email") });
const FORGOT_REPLY = { ok: true, message: "If that email has an account, we've sent a code to it. It expires in 10 minutes." };

// POST /api/auth/forgot: emails a one-time code. Answers the same whether or not the address has an account.
authRouter.post("/forgot", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const email = parsed.data.email.toLowerCase();
  if (!rateLimit(`forgot:ip:${req.ip}`, { max: 30, windowMs: 60 * 60_000 }) || !rateLimit(`forgot:e:${email}`, { max: 3, windowMs: 15 * 60_000 })) {
    return res.status(429).json({ error: "rate_limited", message: "Too many requests. Please wait a few minutes and try again." });
  }
  const user = await User.findOne({ email });
  if (user && user.status === "active" && realEmail(user.email)) {
    const code = await issueCode({ user, channel: "email", target: user.email, purpose: "reset_password" });
    await emailPerson(user.email, {
      subject: "Reset your StarTrack password",
      heading: "Reset your password",
      intro: "Use this code to choose a new password. It expires in 10 minutes.",
      sections: [`<div style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;margin:12px 0">${esc(code)}</div>`],
      footNote: "If you didn't ask for this, you can ignore this email. Your password hasn't changed.",
    });
  } else {
    await hashPassword("same-work-for-unknown-emails"); // so an unknown address takes about as long to answer
  }
  res.json(FORGOT_REPLY);
});

const resetSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// POST /api/auth/reset: checks the code and sets the new password.
authRouter.post("/reset", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const email = parsed.data.email.toLowerCase();
  const guard = failureGuard(`reset:e:${email}`, { max: 8, windowMs: 15 * 60_000 });
  if (guard.blocked()) return res.status(429).json({ error: "rate_limited", message: "Too many wrong codes. Please wait a few minutes, or ask for a new code." });

  const user = await User.findOne({ email });
  if (!user || user.status !== "active") {
    guard.fail();
    return res.status(400).json({ error: "bad_code", message: "Incorrect code." });
  }
  try {
    await consumeCode(user._id, "reset_password", parsed.data.code);
  } catch (err) {
    guard.fail();
    // Don't let "no code was ever requested" tell a stranger the address has an account.
    if (err instanceof HttpError && err.code === "no_code") return res.status(400).json({ error: "bad_code", message: "Incorrect code." });
    throw err;
  }
  user.passwordHash = await hashPassword(parsed.data.password);
  user.emailVerified = true; // they just proved they control the address
  await user.save();
  guard.clear();
  failureGuard(`login:e:${email}`, LOGIN_BY_EMAIL).clear(); // and a lockout from guessing no longer applies
  emailPerson(user.email, {
    subject: "Your StarTrack password was changed",
    heading: "Your password was changed",
    intro: "You just reset the password on your StarTrack account. If that wasn't you, reset it again straight away and contact support.",
    footNote: "This is a security notice about your account.",
  }).catch(() => {});
  res.json({ ok: true });
});

// GET /api/auth/demo/shops — the trades a visitor can try. Public: the
// landing page shows these before anyone has an account.
authRouter.get("/demo/shops", (_req, res) => {
  res.json({
    shops: Object.entries(DEMOS).map(([key, d]) => ({
      key,
      label: d.label,
      group: d.group,
      depth: d.depth,
      pending: d.pending || "",
      blurb: d.blurb,
      business: d.business,
      highlight: d.highlight,
      products: d.catalog.length + (d.madeToOrder ? 1 : 0),
    })),
  });
});

// POST /api/auth/demo — no-signup sandbox: a seeded business, gone in 24h.
// Rate-limited per IP so the endpoint can't be used to flood the database.
authRouter.post("/demo", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!rateLimit(`demo:${ip}`, { max: 8, windowMs: 60 * 60 * 1000 })) {
    return res.status(429).json({ error: "rate_limited", message: "Too many demo sessions from this device. Try again in an hour." });
  }

  // Unknown or missing type falls back to the restaurant.
  const typeKey = typeof req.body?.type === "string" && DEMOS[req.body.type] ? req.body.type : "restaurant";
  const { user, account, business, branch, membership } = await createDemoSandbox(typeKey);
  const body = sessionPayload(user, account, membership, { businesses: [business], branches: [branch] }, false);
  // Demo tokens die with the sandbox.
  body.token = signToken({ sub: String(user._id), accountId: String(account._id), name: user.name }, { expiresIn: "24h" });
  return res.status(201).json(body);
});

const tillSchema = z.object({
  businessCode: z.string().min(4, "Enter your business code"),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

// POST /api/auth/till — staff login: business code + PIN.
// Rate limiting is a global throttle per business code (not per client),
// so rotating IPs doesn't buy an attacker more attempts.
authRouter.post("/till", async (req, res) => {
  const parsed = tillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const code = parsed.data.businessCode.trim().toUpperCase();

  if (!rateLimit(`till:${code}`, { max: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Wait a minute and try again." });
  }

  // A 4-digit PIN has only 10,000 values, so beyond the per-minute throttle, wrong guesses
  // against one business are capped over the hour as well.
  const slowGuess = failureGuard(`till:slow:${code}`, { max: 30, windowMs: 60 * 60_000 });
  if (slowGuess.blocked()) return res.status(429).json({ error: "rate_limited", message: "Too many wrong PINs. Try again later, or ask the owner to reset yours." });
  const business = await Business.findOne({ code });
  if (!business) return res.status(401).json({ error: "bad_credentials", message: "Business code or PIN is incorrect." });

  // Small teams: compare the PIN against each active membership that has one.
  const memberships = await Membership.find({
    accountId: business.accountId,
    status: "active",
    pinHash: { $ne: "" },
    $or: [{ businessId: business._id }, { businessId: null }],
  });
  let match = null;
  for (const m of memberships) {
    if (await checkPassword(parsed.data.pin, m.pinHash)) {
      match = m;
      break;
    }
  }
  if (!match) {
    slowGuess.fail();
    return res.status(401).json({ error: "bad_credentials", message: "Business code or PIN is incorrect." });
  }
  slowGuess.clear();

  const user = await User.findById(match.userId);
  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "bad_credentials", message: "This staff account is suspended." });
  }

  const account = await Account.findById(business.accountId);
  const branches = match.branchId
    ? await Branch.find({ _id: match.branchId })
    : await Branch.find({ businessId: business._id });

  const body = sessionPayload(user, account, match, { businesses: [business], branches }, false);
  // Till sessions are short-lived by design.
  body.token = signToken(
    { sub: String(user._id), accountId: String(account._id), name: user.name, mode: "till" },
    { expiresIn: "12h" }
  );
  body.mode = "till";
  return res.json(body);
});

const changePinSchema = z.object({
  businessId: z.string(),
  currentPin: z.string().default(""),
  newPin: z.string().regex(/^\d{4}$/, "New PIN must be exactly 4 digits"),
});

// POST /api/auth/change-pin — staff change their OWN till PIN.
// Requires the current PIN when one is set; rate-limited per user.
authRouter.post("/change-pin", requireAuth, async (req, res) => {
  const parsed = changePinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
  const d = parsed.data;

  if (!rateLimit(`changepin:${req.auth.userId}`, { max: 5, windowMs: 60_000 })) {
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Wait a minute." });
  }

  const membership =
    (await Membership.findOne({ userId: req.auth.userId, accountId: req.auth.accountId, businessId: d.businessId, status: "active" })) ||
    (await Membership.findOne({ userId: req.auth.userId, accountId: req.auth.accountId, businessId: null, status: "active" }));
  if (!membership) return res.status(404).json({ error: "not_found", message: "No membership found for this business." });

  if (membership.pinHash && !(await checkPassword(d.currentPin, membership.pinHash))) {
    return res.status(401).json({ error: "bad_pin", message: "Your current PIN is incorrect." });
  }

  membership.pinHash = await hashPassword(d.newPin);
  await membership.save();
  res.json({ ok: true });
});

// GET /api/auth/me — bootstrap the app after a page refresh
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  const membership = await Membership.findOne({ userId: user._id, accountId: req.auth.accountId, role: { $in: ["owner", "admin"] } })
    || await Membership.findOne({ userId: user._id, accountId: req.auth.accountId });
  const account = await Account.findById(req.auth.accountId);
  const businesses = await Business.find({ accountId: req.auth.accountId });
  const branches = await Branch.find({ accountId: req.auth.accountId });
  const body = sessionPayload(user, account, membership, { businesses, branches }, false);
  // A page refresh re-reads the session from here. Without this a till
  // session came back as an ordinary login, so staff were sent to the
  // self-service home page instead of back to their till.
  if (req.auth.mode === "till") body.mode = "till";
  return res.json(body);
});

/** What the app needs to know about the plan: which features are on, the caps, and when it ends. */
function planSummary(account) {
  const s = planStatus(account);
  return {
    key: s.plan,
    name: PLANS[s.plan].name,
    features: featuresFor(s.plan),
    limits: PLANS[s.plan].limits,
    legacy: s.legacy,
    trial: s.trial,
    lapsed: s.lapsed,
    periodEnd: s.periodEnd,
    trialEnded: !!s.trialEnded,
    awaitingPayment: !!s.awaitingPayment,
    paidUntil: s.paidUntil || null,
    paidPlan: s.paidPlan || null,
    paymentsOn: PAYMENTS_ENABLED,
  };
}

// Shapes the response the frontend needs. `withToken` false on /me (already has one).
function sessionPayload(user, account, membership, { businesses, branches }, withToken = true) {
  const body = {
    user: { id: user._id, name: user.name, email: user.email, phone: user.phone || "" },
    emailVerified: !!user.emailVerified,
    phoneVerified: !!user.phoneVerified,
    // Platform access is a property of the PERSON, not of any business they
    // belong to — see user.model.js.
    platformRole: user.platformRole || "none",
    account: { id: account._id, name: account.name, plan: effectivePlan(account) },
    plan: planSummary(account),
    demo: !!account.isSandbox,
    role: membership?.role || "staff",
    permissions: permsForRole(membership?.role || "staff", membership?.permsOverride || []),
    // capabilities come from the trade, not from settings — the client uses
    // them to decide which screens exist at all (see hasCapability).
    businesses: businesses.map((b) => ({
      id: b._id, name: b.name, typeKey: b.typeKey, settings: b.settings,
      capabilities: typeTemplate(b.typeKey).capabilities || [],
    })),
    branches: branches.map((br) => ({ id: br._id, businessId: br.businessId, name: br.name })),
  };
  if (withToken) body.token = signToken({ sub: String(user._id), accountId: String(account._id), name: user.name });
  return body;
}
