export function fmtMoney(n: number, currency = "₦") {
  const sign = n < 0 ? "−" : "";
  // A symbol that ends in a letter ("KSh", "CFA", "AED") reads better with a space before the number.
  const gap = /[A-Za-z]$/.test(currency) ? " " : "";
  return `${sign}${currency}${gap}${Math.abs(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export function fmtTime(d: string | Date) {
  return new Date(d).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
}

export function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | Date) {
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PAY_LABELS: Record<string, string> = { cash: "Cash", pos: "POS", transfer: "Transfer", credit: "On account", store_credit: "Store credit" };
/** How a payment method reads on screens and receipts. */
export const payLabel = (method: string) => PAY_LABELS[method] || method;
