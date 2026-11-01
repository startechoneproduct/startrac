import crypto from "node:crypto";
import { VerificationCode } from "#modules/auth/verificationCode.model.js";
import { hashPassword, checkPassword } from "#modules/auth/auth.service.js";
import { badRequest, notFound, conflict } from "#core/httpError.js";

/**
 * One-time codes, for everything that is "we send you a code, you type it back":
 * proving an email or phone is yours, and resetting a forgotten password. Codes
 * are stored hashed, expire, and stop working after too many wrong guesses.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;

const genCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** Makes a fresh code for this person and purpose; returns it in plain text so it can be sent. */
export async function issueCode({ user, channel, target, purpose }) {
  const code = genCode();
  await VerificationCode.create({
    userId: user._id, channel, target, purpose,
    codeHash: await hashPassword(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

/**
 * Checks the newest unused code for this person and purpose, and spends it.
 * Throws a plain-English HttpError when it can't be used: none pending, expired,
 * too many wrong tries, or simply wrong.
 */
export async function consumeCode(userId, purpose, code) {
  const entry = await VerificationCode.findOne({ userId, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (!entry) throw notFound("No pending code — request a new one.", "no_code");
  if (entry.expiresAt < new Date()) throw conflict("That code has expired — request a new one.", "expired");
  if (entry.attempts >= entry.maxAttempts) throw conflict("Too many wrong attempts — request a new code.", "too_many_attempts");

  if (!(await checkPassword(code, entry.codeHash))) {
    entry.attempts += 1;
    await entry.save();
    throw badRequest("Incorrect code.", "bad_code");
  }
  entry.consumedAt = new Date();
  await entry.save();
}
