import { Account } from "#modules/auth/account.model.js";
import { User } from "#modules/auth/user.model.js";
import { sendMail, emailShell } from "#core/mailer.js";

/**
 * Email to a person who has an account but isn't in the middle of a request:
 * the account's owner (billing, welcome) or a named user (tickets, new staff).
 * Till-only staff have a made-up address ending .till.local, which never receives mail.
 */
export const realEmail = (email) => !!email && !/\.till\.local$/i.test(email);

/** The person who owns an account, with their address. */
export async function ownerOf(accountId) {
  const account = await Account.findById(accountId).select("ownerUserId");
  return account ? User.findById(account.ownerUserId).select("name email") : null;
}

/** Sends a message in the house style to the account's owner. Never throws; resolves like sendMail. */
export async function emailOwner(accountId, { subject, heading, intro, sections = [], footNote, businessName = "StarTrack" }) {
  const owner = await ownerOf(accountId);
  if (!owner || !realEmail(owner.email)) return { sent: false, reason: "no_recipient" };
  return emailPerson(owner.email, { subject, heading, intro, sections, footNote, businessName });
}

export const emailPerson = (to, { subject, heading, intro, sections = [], footNote, businessName = "StarTrack" }) =>
  sendMail({ to, subject, html: emailShell({ businessName, heading, intro, sections, footNote }) });

/** A call-to-action button, for the end of a message. */
export const button = (href, label) =>
  `<p style="margin:18px 0"><a href="${href}" style="display:inline-block;background:#1a48cc;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${label}</a></p>`;
