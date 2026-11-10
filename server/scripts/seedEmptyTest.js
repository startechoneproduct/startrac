import mongoose from "mongoose";
import { SHOWCASE_PLAN_KEYS, showcaseSubscription } from "./showcasePlans.js";
import { PLANS } from "#shared/plans.js";
import { typeTemplate } from "#shared/businessTypes.js";
import { connectDb } from "#core/db.js";
import { hashPassword } from "#modules/auth/auth.service.js";
import { User } from "#modules/auth/user.model.js";
import { Account } from "#modules/auth/account.model.js";
import { Membership } from "#modules/auth/membership.model.js";
import { Business } from "#modules/business/business.model.js";
import { Branch } from "#modules/business/branch.model.js";
import { DEMOS } from "#modules/auth/demoShops.js";

/**
 * Seeds EMPTY test accounts: one owner per business type per plan (Freemium,
 * Pro, Business), each with a business + one branch and nothing else — no
 * products, customers, sales, expenses or staff. Use these to test onboarding
 * and first-run flows from a true zero state.
 *
 * Kept separate from seedShowcase.js (lived-in demo data, @startrack.demo) so
 * neither script can wipe or collide with the other.
 *
 * Run:   node server/scripts/seedEmptyTest.js
 *        add --reset to delete and recreate these empty accounts only
 *        add --only=<type> to act on a single business type
 */
export const EMPTY_PASSWORD = "test12";
export const emptyEmail = (typeKey, plan) => `${typeKey}.${plan}@empty.startrack.test`;

async function purge(accountIds, userIds) {
  const by = { accountId: { $in: accountIds } };
  await Promise.all([Membership.deleteMany(by), Branch.deleteMany(by), Business.deleteMany(by)]);
  await Account.deleteMany({ _id: { $in: accountIds } });
  await User.deleteMany({ _id: { $in: userIds } });
}

async function main() {
  const reset = process.argv.includes("--reset");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  if (only && !DEMOS[only]) {
    console.error(`Unknown business type "${only}". Choose one of: ${Object.keys(DEMOS).join(", ")}`);
    process.exit(1);
  }
  await connectDb();

  const passwordHash = await hashPassword(EMPTY_PASSWORD);
  const rows = [];

  for (const typeKey of Object.keys(DEMOS)) {
    if (only && typeKey !== only) continue;
    const shop = DEMOS[typeKey];
    for (const plan of SHOWCASE_PLAN_KEYS) {
      const email = emptyEmail(typeKey, plan);
      let user = await User.findOne({ email });

      if (user && reset) {
        const accounts = await Account.find({ ownerUserId: user._id }).select("_id");
        await purge(accounts.map((a) => a._id), [user._id]);
        user = null;
      }

      if (user) {
        // Make sure a previous run wasn't cut off half-way and the plan is still valid.
        const account = await Account.findOne({ ownerUserId: user._id });
        if (account && (await Business.exists({ accountId: account._id }))) {
          account.plan = plan;
          account.subscription = showcaseSubscription(plan);
          await account.save();
          user.passwordHash = passwordHash;
          await user.save();
          rows.push({ typeKey, plan, email, status: "exists (plan renewed)" });
          continue;
        }
        if (account) await purge([account._id], [user._id]);
        else await User.deleteOne({ _id: user._id });
      }

      user = await User.create({ name: `${shop.business} Test Owner`, email, passwordHash, emailVerified: true, phoneVerified: true });
      const account = await Account.create({
        name: `${shop.business} — empty test (${PLANS[plan].name})`,
        ownerUserId: user._id, isSandbox: false, plan, subscription: showcaseSubscription(plan),
      });
      const template = typeTemplate(typeKey);
      const business = await Business.create({
        accountId: account._id, name: `${shop.business} (Empty ${PLANS[plan].name})`, typeKey,
        settings: { currency: "₦", vatEnabled: true, vatRate: 7.5, modules: template.modules },
      });
      const branch = await Branch.create({ accountId: account._id, businessId: business._id, name: shop.branch.name, address: shop.branch.address });
      await Membership.create({ userId: user._id, accountId: account._id, businessId: business._id, branchId: branch._id, role: "owner" });
      rows.push({ typeKey, plan, email, status: "created" });
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log(`Empty test accounts — ${rows.length} logins, all with password ${EMPTY_PASSWORD}`);
  console.log("=".repeat(78));
  for (const plan of SHOWCASE_PLAN_KEYS) {
    console.log(`\n${PLANS[plan].name.toUpperCase()}`);
    for (const r of rows.filter((x) => x.plan === plan)) console.log(`  ${DEMOS[r.typeKey].label.padEnd(34)} ${r.email.padEnd(44)} ${r.status}`);
  }
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
