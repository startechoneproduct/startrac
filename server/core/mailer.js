import nodemailer from "nodemailer";
import { config } from "#core/config.js";

/**
 * Outbound email: the one door every kind of email this app sends goes through,
 * whatever triggers it (sign-up codes, the alerts digest, invoices, receipts,
 * password resets). It speaks plain SMTP, so any provider works; the default is
 * Gmail (smtp.gmail.com with an App password, see config.js). When SMTP_USER or
 * SMTP_PASS is missing the mailer stays off and says so once, rather than
 * pretending to send. Nothing in the app depends on mail succeeding: alerts
 * land in the in-app bell first, and email is the copy that follows.
 */
let transport = null;
let warned = false;

export const mailEnabled = () => !!(config.smtp.user && config.smtp.pass);

function getTransport() {
  if (transport) return transport;
  if (!mailEnabled()) {
    if (!warned) {
      warned = true;
      console.warn(
        "✉ Email is OFF: SMTP_USER / SMTP_PASS aren't set.\n" +
          "  For Gmail: turn on 2-Step Verification, create an App password at\n" +
          "  myaccount.google.com/apppasswords, then set SMTP_USER (your address) and SMTP_PASS.\n" +
          "  Alerts still appear in the app; only the email copy is skipped."
      );
    }
    return null;
  }
  const { host, port, secure, user, pass } = config.smtp;
  transport = nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
    // A mail server having a bad day must not hang a request: give up quickly.
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  return transport;
}

/** Gmail rejects mail whose From isn't the signed-in address, so unless told otherwise send as it. */
const fromAddress = () => config.smtp.from || `StarTrack <${config.smtp.user}>`;

/** A reason a person can act on, instead of a stack of SMTP codes. */
function explain(err) {
  const code = err?.code, resp = String(err?.response || err?.message || "");
  if (code === "EAUTH" || /535|Username and Password not accepted|BadCredentials/i.test(resp)) {
    return "The email server refused the login. For Gmail, SMTP_PASS must be an App password (not your normal password) and SMTP_USER the same account.";
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "ENOTFOUND" || code === "EDNS") {
    return "Couldn't reach the email server. Check the internet connection, and the SMTP_HOST and SMTP_PORT settings.";
  }
  return err?.message || "send_failed";
}

/**
 * Sends one message. Never throws: a mail provider having a bad day must not
 * take a checkout or a nightly sweep down with it. Resolves { sent, reason }.
 */
export async function sendMail({ to, subject, html, text }) {
  const mailer = getTransport();
  if (!mailer || !to?.length) return { sent: false, reason: "not_configured" };
  try {
    await mailer.sendMail({
      from: fromAddress(),
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
    return { sent: true };
  } catch (err) {
    console.error("✉ email failed:", err.message);
    return { sent: false, reason: explain(err) };
  }
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const TONE = {
  critical: { bg: "#fee2e2", fg: "#dc2626", label: "Urgent" },
  warning: { bg: "#fef3c7", fg: "#d97706", label: "Attention" },
  info: { bg: "#e0e7ff", fg: "#1a48cc", label: "For your information" },
};

/**
 * The house email shell. Inline styles only and a table-free layout — mail
 * clients are not browsers, and the legacy app's flexbox email body silently
 * collapsed in Outlook.
 */
export function emailShell({ businessName, heading, intro, sections, footNote }) {
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f6f7f9;padding:24px">
  <div style="background:#1a48cc;padding:24px 28px;border-radius:12px 12px 0 0">
    <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px">${esc(businessName)}</div>
    <div style="color:rgba(255,255,255,.72);font-size:12px;margin-top:3px">via StarTrack</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h1 style="font-size:19px;font-weight:800;color:#111827;margin:0 0 8px">${esc(heading)}</h1>
    ${intro ? `<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px">${esc(intro)}</p>` : ""}
    ${sections.join("")}
    <div style="margin-top:26px;padding-top:18px;border-top:1px solid #e5e7eb">
      <p style="font-size:11px;color:#9ca3af;margin:0;line-height:1.6">
        ${esc(footNote || "You are receiving this because your address is listed for alerts in Settings.")}
      </p>
    </div>
  </div>
</div>`;
}

/** One alert rendered as a row inside the shell. */
export function alertRow({ severity, title, body, meta }) {
  const tone = TONE[severity] || TONE.info;
  return `<div style="border:1px solid #e5e7eb;border-left:3px solid ${tone.fg};border-radius:8px;padding:14px 16px;margin-bottom:10px">
    <div style="display:inline-block;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;background:${tone.bg};color:${tone.fg};margin-bottom:8px">${tone.label}</div>
    <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:3px">${esc(title)}</div>
    ${body ? `<div style="font-size:13px;color:#4b5563;line-height:1.55">${esc(body)}</div>` : ""}
    ${meta ? `<div style="font-size:11px;color:#9ca3af;margin-top:6px">${esc(meta)}</div>` : ""}
  </div>`;
}
