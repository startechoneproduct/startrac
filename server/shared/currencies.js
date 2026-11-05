/**
 * The currencies a business can run in. Read by the server (to check and
 * store a choice) and by the app (to show the choices), so both agree.
 *
 * A business stores both the code (settings.currencyCode, "NGN") and the
 * symbol it prints (settings.currency, "₦"). Every screen, receipt, invoice
 * and report prints the symbol, which is why the symbol is kept as its own
 * field: businesses created before codes existed only have the symbol, and
 * they keep working unchanged.
 */
export const CURRENCIES = [
  { code: "NGN", symbol: "₦", name: "Nigerian naira" },
  { code: "USD", symbol: "$", name: "US dollar" },
  { code: "GBP", symbol: "£", name: "British pound" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GHS", symbol: "GH₵", name: "Ghanaian cedi" },
  { code: "KES", symbol: "KSh", name: "Kenyan shilling" },
  { code: "ZAR", symbol: "R", name: "South African rand" },
  { code: "XOF", symbol: "CFA", name: "West African CFA franc" },
  { code: "XAF", symbol: "FCFA", name: "Central African CFA franc" },
  { code: "EGP", symbol: "E£", name: "Egyptian pound" },
  { code: "UGX", symbol: "USh", name: "Ugandan shilling" },
  { code: "TZS", symbol: "TSh", name: "Tanzanian shilling" },
  { code: "RWF", symbol: "FRw", name: "Rwandan franc" },
  { code: "CAD", symbol: "CA$", name: "Canadian dollar" },
  { code: "AUD", symbol: "A$", name: "Australian dollar" },
  { code: "INR", symbol: "₹", name: "Indian rupee" },
  { code: "AED", symbol: "AED", name: "UAE dirham" },
  { code: "CNY", symbol: "CN¥", name: "Chinese yuan" },
];

export const DEFAULT_CURRENCY = CURRENCIES[0];

/**
 * A currency from a code ("USD") or a symbol ("$"), as older clients and
 * stored data may give either. Unknown input gives null.
 */
export function findCurrency(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return CURRENCIES.find((c) => c.code === v.toUpperCase()) || CURRENCIES.find((c) => c.symbol === v) || null;
}

/** The code a stored business is on: its code if it has one, else worked out from its symbol, else NGN. */
export function currencyCodeOf(settings) {
  return settings?.currencyCode || findCurrency(settings?.currency)?.code || DEFAULT_CURRENCY.code;
}
