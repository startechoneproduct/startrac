import { Account } from "#modules/auth/account.model.js";
import { config } from "#core/config.js";
import { emailOwner, button } from "#core/ownerMail.js";
import { esc } from "#core/mailer.js";
import { PLANS, PAYMENTS_ENABLED, planStatus } from "#shared/plans.js";

/**
 * The emails an owner gets about their plan: a receipt when they pay, and a
 * heads-up before something changes (the free Pro days ending, the paid month
 * ending, the account going view-only). Each is sent once per period: the key
 * is remembered on the account, and only once the email really went out, so a
 * sweep that ran while email was down tries again later.
 */
const DAY = 86_400_000;
const WARN_DAYS = 3;
const date = (d) => new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const naira = (n) => `₦${Number(n).toLocaleString("en-NG")}`;
const billingLink = () => (config.appUrl ? button(`${config.appUrl.replace(/\/$/, "")}/app/billing`, "Open plans & billing") : "");

/** Receipt for a payment that just went through. Fire-and-forget. */
export async function emailPaymentReceipt(account, { plan, amount, periodEnd, bonusUntil }) {
  const p = PLANS[plan];
  return emailOwner(account._id, {
    subject: `Payment received: ${p.name} plan, ${naira(amount)}`,
    businessName: account.name || "StarTrack",
    heading: "Thank you, your payment was received",
    intro: `${naira(amount)} for the ${p.name} plan. It runs until ${date(periodEnd)}.`,
    sections: [
      bonusUntil ? `<p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px">As a welcome gift you also have <b>Pro, free, until ${esc(date(bonusUntil))}</b>. After that you carry on with ${esc(p.name)}, the plan you paid for.</p>` : "",
      billingLink(),
    ],
    footNote: "You are receiving this because a payment was made on your StarTrack account.",
  }).catch(() => {});
}

async function remember(accountId, key) {
  await Account.updateOne({ _id: accountId }, { $addToSet: { "subscription.notices": key } });
}

/** One pass over every paying account: sends whichever plan emails are due. */
export async function runBillingNotices(now = new Date()) {
  if (!PAYMENTS_ENABLED) return { checked: 0, sent: 0 };
  const accounts = await Account.find({
    isSandbox: { $ne: true }, status: { $ne: "suspended" },
    "subscription.plan": { $exists: true }, "subscription.grandfathered": { $ne: true },
  });
  let sent = 0;
  for (const account of accounts) {
    const st = planStatus(account, now);
    if (st.legacy) continue;
    const done = new Set(account.subscription?.notices || []);
    const left = (d) => Math.max(0, Math.ceil((new Date(d) - now) / DAY));
    const notices = [];

    // The free Pro days are about to end (only while there IS a paid plan to fall back to).
    if (st.trial && st.paidUntil && st.periodEnd && new Date(st.periodEnd).getTime() !== new Date(st.paidUntil).getTime() && new Date(st.periodEnd) - now <= WARN_DAYS * DAY) {
      const paid = PLANS[st.paidPlan]?.name || "your plan";
      notices.push({
        key: `bonus-ending:${dayKey(st.periodEnd)}`,
        subject: `Your free ${st.plan === "pro" ? "Pro" : PLANS[st.plan].name} days end in ${left(st.periodEnd)} day${left(st.periodEnd) === 1 ? "" : "s"}`,
        heading: `${left(st.periodEnd) === 0 ? "Today is" : `${left(st.periodEnd)} day${left(st.periodEnd) === 1 ? "" : "s"} left of`} your free ${PLANS[st.plan].name} days`,
        intro: `After ${date(st.periodEnd)} you carry on with ${paid}, which you've paid for until ${date(st.paidUntil)}. ${PLANS[st.plan].name} features pause and ${paid} limits apply; nothing is deleted. Upgrade any time to keep ${PLANS[st.plan].name}.`,
      });
    }
    // The paid month is about to run out.
    else if (!st.lapsed && !st.awaitingPayment && st.paidUntil && new Date(st.paidUntil) - now <= WARN_DAYS * DAY) {
      notices.push({
        key: `paid-ending:${dayKey(st.paidUntil)}`,
        subject: `Your ${PLANS[st.paidPlan || st.plan].name} plan ends in ${left(st.paidUntil)} day${left(st.paidUntil) === 1 ? "" : "s"}`,
        heading: "Your plan is about to end",
        intro: `It runs until ${date(st.paidUntil)}. Plans don't renew by themselves: pay again before then to keep everything working. After that your data stays safe, but changes are paused until you renew.`,
      });
    }
    // It has run out: view-only until paid.
    if (st.lapsed && !st.awaitingPayment && st.paidUntil) {
      notices.push({
        key: `lapsed:${dayKey(st.paidUntil)}`,
        subject: "Your StarTrack plan has ended",
        heading: "Your account is now view-only",
        intro: `Your plan ended on ${date(st.paidUntil)}. You can still see everything, but changes are paused. Renew to pick up exactly where you left off; nothing has been deleted.`,
      });
    }
    // Signed up but never paid.
    if (st.awaitingPayment && now - new Date(account.createdAt) >= DAY) {
      notices.push({
        key: "awaiting-payment",
        subject: "Finish setting up your StarTrack account",
        heading: "One step left: your first payment",
        intro: "Your account is ready, but it stays view-only until the first payment. Choose a plan to start selling.",
      });
    }

    for (const n of notices) {
      if (done.has(n.key)) continue;
      const r = await emailOwner(account._id, { subject: n.subject, heading: n.heading, intro: n.intro, sections: [billingLink()], businessName: account.name || "StarTrack", footNote: "You are receiving this because you own this StarTrack account." });
      if (r.sent) { await remember(account._id, n.key); sent++; }
    }
  }
  return { checked: accounts.length, sent };
}
