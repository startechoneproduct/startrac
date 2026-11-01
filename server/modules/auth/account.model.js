import mongoose from "mongoose";

// The billing + login umbrella (formerly "organization"). Invisible in the UI
// until a user owns more than one business. Every tenant record traces to this.
const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Legacy label, kept in step with subscription.plan for the platform screen.
    // What an account may actually do comes from `subscription` (shared/plans.js).
    plan: { type: String, enum: ["free", "growth", "pro", "business"], default: "free" },
    // Absent on accounts that existed before plans did — those keep full access.
    subscription: {
      plan: { type: String, enum: ["free", "pro", "business"] },
      // True while the first, unpaid period is running; cleared by the first payment.
      trial: { type: Boolean, default: false },
      // When the paid period ends; after that the account is on Freemium.
      currentPeriodEnd: { type: Date, default: null },
      // Every payment that has been applied, so a replayed webhook or a
      // double-click on "verify" can never extend the plan twice.
      payments: { type: [{ _id: false, reference: String, plan: String, amount: Number, at: Date }], default: [] },
      // What the owner signed up for. New accounts carry it (and may be trialling
      // a bigger plan); its absence is how accounts from before the trial rules
      // are recognised and grandfathered — see migrateExistingAccounts().
      registeredPlan: { type: String, enum: ["free", "pro", "business"] },
      // Full access for good (existing accounts when the trial rules began).
      grandfathered: { type: Boolean, default: false },
      // The welcome bonus a first Freemium payment earns: a bigger plan, free, until `until`.
      bonus: { type: { _id: false, plan: String, until: Date }, default: undefined },
      bonusUsed: { type: Boolean, default: false },
      // Plan emails already sent ("paid-ending:2026-12-01"), so each goes out once per period.
      notices: { type: [String], default: [] },
    },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    // Throwaway "Try the demo" sandboxes — swept after 24h.
    isSandbox: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export const Account = mongoose.model("Account", accountSchema);
