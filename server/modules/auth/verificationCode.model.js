import mongoose from "mongoose";

/**
 * A short-lived one-time code sent to prove someone owns an email or phone.
 * Kept as its own collection (not a sub-array on User) so it can carry a TTL
 * index — codes vanish on their own, nothing accumulates on the user doc the
 * way stageHistory does on a Job — and so the same shape covers whatever
 * other purpose needs a "send a code, confirm a code" flow later (password
 * reset, say) without a new model.
 */
const verificationCodeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    channel: { type: String, enum: ["email", "sms"], required: true },
    target: { type: String, required: true }, // the email or phone the code was sent to
    purpose: { type: String, enum: ["verify_email", "verify_phone", "reset_password"], required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    consumedAt: { type: Date, default: null },
    // TTL index: Mongo deletes the document itself once expiresAt passes.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

verificationCodeSchema.index({ userId: 1, purpose: 1, consumedAt: 1, createdAt: -1 });

export const VerificationCode = mongoose.model("VerificationCode", verificationCodeSchema);
