import mongoose from "mongoose";

/** How an expense was paid for. Not the same as how customers pay at the till. */
export const EXPENSE_METHODS = ["cash", "transfer", "pos", "card", "cheque", "other"];

const expenseSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, required: true, trim: true }, // the category: Rent, Fuel, Salaries, …
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "" }, // description
    paidBy: { type: String, default: "" }, // who paid it out
    paymentMethod: { type: String, enum: EXPENSE_METHODS, default: "cash" },
    reference: { type: String, default: "" }, // the supplier's receipt or invoice number
    // Supporting documents (receipts, invoices). The files themselves live in
    // ExpenseAttachment so listing expenses never drags their bytes along.
    attachments: [{ _id: false, id: mongoose.Schema.Types.ObjectId, name: String, mime: String, size: Number }],
    recurringId: { type: mongoose.Schema.Types.ObjectId, default: null }, // recorded from a recurring expense
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    actorName: { type: String, default: "" },
    editedAt: { type: Date, default: null },
    editedBy: { type: String, default: "" },
    at: { type: Date, default: Date.now }, // the day the money went out
  },
  { timestamps: true }
);

expenseSchema.index({ businessId: 1, branchId: 1, at: -1 });

export const Expense = mongoose.model("Expense", expenseSchema);

/** One supporting file for an expense, kept in the database so it works without any file storage set up. */
const attachmentSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    expenseId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, default: "file" },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

export const ExpenseAttachment = mongoose.model("ExpenseAttachment", attachmentSchema);

/**
 * A cost that comes round on a schedule (rent, salaries, subscriptions). It is
 * not recorded by itself: when it falls due it shows on the Expenses page and
 * someone confirms it, because the amount or the day it was paid may differ.
 */
const recurringSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "" },
    paidBy: { type: String, default: "" },
    paymentMethod: { type: String, enum: EXPENSE_METHODS, default: "transfer" },
    frequency: { type: String, enum: ["weekly", "monthly", "quarterly", "yearly"], default: "monthly" },
    nextDue: { type: String, required: true }, // YYYY-MM-DD
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const RecurringExpense = mongoose.model("RecurringExpense", recurringSchema);
