import mongoose from "mongoose";
import { Customer } from "#modules/customers/customer.model.js";
import { money } from "#core/money.js";
import { HttpError } from "#core/httpError.js";

/**
 * Store credit: money a business owes a customer, to be spent at the till —
 * issued when a return is taken as credit or exchanged, used up by a sale
 * paid with it, given back if that sale is voided. Customer.storeCredit is
 * the fast-read balance; StoreCreditEntry is the append-only record behind
 * it, so every change can be traced to the return or sale that caused it.
 */
const entrySchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    amount: { type: Number, required: true }, // + issued, − spent
    balanceAfter: { type: Number, required: true },
    refType: { type: String, enum: ["return", "sale", "void"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId },
    refNo: { type: String, default: "" }, // RTN-0003, R-00042
    byName: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

export const StoreCreditEntry = mongoose.model("StoreCreditEntry", entrySchema);

/**
 * Changes a customer's store credit and writes the matching record in one go.
 * Spending more than the customer has is refused, checked in the same write
 * so two tills can't both spend the last of it.
 */
export async function changeStoreCredit(ctx, customerId, amount, { refType, refId, refNo = "", session = null }) {
  const delta = money(amount);
  if (!delta) return null;
  const filter = { _id: customerId, businessId: ctx.businessId };
  if (delta < 0) filter.storeCredit = { $gte: -delta - 0.001 };
  const customer = await Customer.findOneAndUpdate(filter, { $inc: { storeCredit: delta } }, { new: true, session });
  if (!customer) throw new HttpError(409, "insufficient_credit", "The customer doesn't have that much store credit.");
  if (customer.storeCredit < 0.005 && customer.storeCredit !== 0) {
    customer.storeCredit = 0; // rounding dust, never a negative credit
    await customer.save({ session });
  }
  await StoreCreditEntry.create([{
    accountId: ctx.accountId, businessId: ctx.businessId, customerId,
    amount: delta, balanceAfter: money(customer.storeCredit), refType, refId, refNo, byName: ctx.actorName || "",
  }], { session });
  return customer;
}
