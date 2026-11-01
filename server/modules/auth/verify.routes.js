import { Router } from "express";
import { z } from "zod";
import { User } from "#modules/auth/user.model.js";
import { issueCode, consumeCode } from "#modules/auth/codes.js";
import { rateLimit } from "#core/rateLimit.js";
import { sendMail, emailShell } from "#core/mailer.js";
import { sendSms } from "#core/sms.js";


export const verifyRouter = Router();

const REQUEST_LIMIT = { max: 3, windowMs: 15 * 60 * 1000 };
const CONFIRM_LIMIT = { max: 8, windowMs: 15 * 60 * 1000 };

function purposeFor(channel) {
  return channel === "email" ? "verify_email" : "verify_phone";
}

/**
 * Fire-and-forget helper reused by auth.routes.js's register handler so a
 * code is already in the inbox the first time the UI shows the nag banner.
 * Never throws — verification is additive, never allowed to break sign-up.
 */
export async function requestVerification(userId, channel) {
  try {
    const user = await User.findById(userId);
    if (!user) return { sent: false, reason: "no_user" };
    const target = channel === "email" ? user.email : user.phone;
    if (!target) return { sent: false, reason: "no_target" };

    const code = await issueCode({ user, channel, target, purpose: purposeFor(channel) });

    if (channel === "email") {
      return await sendMail({
        to: target,
        subject: "Verify your email — StarTrack",
        html: emailShell({
          businessName: "StarTrack",
          heading: "Verify your email",
          intro: `Your verification code is below. It expires in 10 minutes.`,
          sections: [`<div style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;margin:12px 0">${code}</div>`],
          footNote: "If you didn't request this, you can ignore this email.",
        }),
      });
    }
    await sendSms({ to: target, message: `Your StarTrack verification code is ${code}. It expires in 10 minutes.` });
    return { sent: true }; // text messages keep their own behaviour; only email reports failure
  } catch (err) {
    console.error("requestVerification failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

const channelSchema = z.object({ channel: z.enum(["email", "sms"]) });

// POST /api/verify/request — send (or resend) a code for the given channel.
verifyRouter.post("/request", async (req, res) => {
  const parsed = channelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "Choose email or sms." });
  const { channel } = parsed.data;

  if (!rateLimit(`verify:request:${channel}:${req.auth.userId}`, REQUEST_LIMIT)) {
    return res.status(429).json({ error: "rate_limited", message: "Too many codes requested. Wait a bit and try again." });
  }

  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (channel === "email" && user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  if (channel === "sms" && user.phoneVerified) return res.json({ ok: true, alreadyVerified: true });
  if (channel === "sms" && !user.phone) {
    return res.status(400).json({ error: "no_phone", message: "Add a phone number first." });
  }

  const out = await requestVerification(user._id, channel);
  // Say so when the code didn't actually go out, instead of leaving them waiting for it.
  if (out && out.sent === false) {
    const off = out.reason === "not_configured";
    return res.status(off ? 503 : 502).json({
      error: off ? "email_off" : "send_failed",
      message: off
        ? `We can't send ${channel === "email" ? "emails" : "texts"} from this server yet. Please contact support.`
        : `We couldn't send the code to your ${channel === "email" ? "email" : "phone"}. Please try again in a moment.`,
    });
  }
  res.json({ ok: true, channel });
});

const confirmSchema = z.object({ channel: z.enum(["email", "sms"]), code: z.string().min(4).max(8) });

// POST /api/verify/confirm — check a code, mark the channel verified.
verifyRouter.post("/confirm", async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid", message: "Enter the code you were sent." });
  const { channel, code } = parsed.data;

  if (!rateLimit(`verify:confirm:${req.auth.userId}`, CONFIRM_LIMIT)) {
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Wait a bit and try again." });
  }

  await consumeCode(req.auth.userId, purposeFor(channel), code);
  await User.updateOne(
    { _id: req.auth.userId },
    { $set: channel === "email" ? { emailVerified: true } : { phoneVerified: true } }
  );

  res.json({ ok: true, channel });
});
