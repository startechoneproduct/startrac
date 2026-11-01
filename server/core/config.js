import dotenv from "dotenv";
dotenv.config();

const isProd = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-me";

// Refuse to boot in production with the development secret — a silent
// default here would let anyone forge login tokens. Throwing rather than
// process.exit()-ing matters beyond style: this module loads on every cold
// start of the Netlify function too (server/app.js imports it transitively),
// and calling process.exit() there doesn't fail one request cleanly — it can
// tear down the whole serverless runtime mid-init, which is exactly the kind
// of thing that shows up client-side as a bare 502 with no useful message.
// A thrown error still stops a standalone server (server/index.js) from
// booting at all — Node exits non-zero on an uncaught exception during
// module evaluation either way — but the function's logs get an actual
// stack trace pointing at this line instead of a mystery crash.
if (isProd && jwtSecret === "dev-secret-change-me") {
  throw new Error("FATAL: set a real JWT_SECRET before running in production.");
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || "", // blank → in-memory dev DB
  jwtSecret,
  // Empty by default: this process serves the web client itself, so requests
  // are same-origin and CORS is unnecessary. Set WEB_ORIGIN (comma-separated)
  // only if the client is ever hosted somewhere else again.
  webOrigins: (process.env.WEB_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Outbound email: every kind the app sends (sign-up codes, alerts, invoices,
  // receipts, password resets) goes through SMTP; see mailer.js. For Gmail use
  // smtp.gmail.com with your address and a Google "App password" (not your normal
  // password). Absent SMTP_USER/SMTP_PASS = email stays off, said once at start-up.
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    // Port 465 is TLS from the first byte; 587 upgrades with STARTTLS. Left unset it follows the port.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== "false" : (Number(process.env.SMTP_PORT) || 465) === 465,
    user: (process.env.SMTP_USER || "").trim(),
    // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
    pass: (process.env.SMTP_PASS || "").replace(/\s+/g, ""),
    // Gmail only sends as the signed-in address (or an alias set up in Gmail), whatever this says.
    from: process.env.MAIL_FROM || "",
  },
  // Outbound SMS — phone verification codes and (opt-in) gym renewal
  // reminders go through Termii; see server/core/sms.js. Absent
  // TERMII_API_KEY = SMS stays off, same graceful fallback as email above.
  termii: {
    apiKey: process.env.TERMII_API_KEY || "",
    senderId: process.env.TERMII_SENDER_ID || "StarTrack",
  },
  // Free-tier Groq API serving an open-weight model — see server/core/ai.js.
  // Absent GROQ_API_KEY = every AI feature reports itself unavailable rather
  // than erroring. gpt-oss-120b (OpenAI's own open-weight release, hosted by
  // Groq) — verified working 2026-09-24 against a live key; Groq's catalog
  // has shifted before and new accounts must explicitly enable a model at
  // console.groq.com/settings/limits before it's callable at all (a blocked
  // model 403s, a nonexistent one 404s — GROQ_MODEL overrides this if the
  // catalog moves again).
  groq: {
    apiKey: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
  // Product photo storage — see server/core/cloudinary.js. Absent
  // CLOUDINARY_* = image upload stays off (products just show a category
  // icon instead of a photo), same graceful fallback as email/SMS/AI above.
  // Get these from the dashboard at cloudinary.com/console.
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },
  // Subscription payments (https://paystack.com). Absent = the Upgrade button
  // explains that online payment isn't set up; plans can still be set by hand
  // from the platform screen.
  paystack: { secretKey: process.env.PAYSTACK_SECRET_KEY || "" },
  // The public address of this app, used for payment return links. Falls back
  // to the address the request came from.
  appUrl: (process.env.APP_URL || "").trim(),
  // The plan a brand-new account starts on. "free" in production; tests and
  // local demos can set DEFAULT_PLAN=business to have everything switched on.
  defaultPlan: ["free", "pro", "business"].includes(process.env.DEFAULT_PLAN) ? process.env.DEFAULT_PLAN : "free",
  // Optional stock-photo sources for "find photos" (server/modules/products/
  // photoSearch.js). Without either, it falls back to Wikimedia Commons.
  photos: {
    pexelsKey: process.env.PEXELS_API_KEY || "",
    pixabayKey: process.env.PIXABAY_API_KEY || "",
  },
  // How often the background sweep looks for expiring stock and unattended
  // returns. Every 6 hours by default; 0 turns the sweep off entirely.
  // After an urgent alert (something just ran out), wait this long to gather any others, then email once.
  alertDigestDelayMs: process.env.ALERT_DIGEST_DELAY_MS === undefined ? 60_000 : Number(process.env.ALERT_DIGEST_DELAY_MS),
  alertSweepHours: process.env.ALERT_SWEEP_HOURS === undefined ? 6 : Number(process.env.ALERT_SWEEP_HOURS),
  // The email promoted to platform overseer on boot, so StarTrack always has
  // a way in without editing the database by hand.
  platformOwnerEmail: (process.env.PLATFORM_OWNER_EMAIL || "").trim().toLowerCase(),
  // Render's free tier spins a web service down after 15 minutes with no
  // inbound HTTP request — RENDER_EXTERNAL_URL is set automatically there,
  // so this needs no manual configuration on Render itself. PING_URL
  // overrides it for any other host that wants the same trick. Blank
  // (local dev, or a paid tier that never sleeps) = the ping never runs.
  keepAwakeUrl: (process.env.PING_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, ""),
  isProd,
};
