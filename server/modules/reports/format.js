// Turns a report cell into display text. Shared by the PDF and Excel renderers
// so the same number reads the same in both files.

const NUM = (n, min, max) => Number(n).toLocaleString("en-NG", { minimumFractionDigits: min, maximumFractionDigits: max });

// `dec` (true) forces two decimals so a whole column of money lines up.
export function formatValue(value, format, currency = "₦", dec = false) {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "money": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      const gap = /[A-Za-z]$/.test(currency) ? " " : "";
      const body = `${currency}${gap}${NUM(Math.abs(n), dec || !Number.isInteger(n) ? 2 : 0, 2)}`;
      return n < 0 ? `−${body}` : body;
    }
    case "int": return Number.isFinite(Number(value)) ? NUM(value, 0, 0) : String(value);
    case "decimal": return Number.isFinite(Number(value)) ? NUM(value, 0, 2) : String(value);
    case "pct": return Number.isFinite(Number(value)) ? `${NUM(value, 0, 1)}%` : String(value);
    case "date": {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
    }
    case "datetime": {
      const d = new Date(value);
      return Number.isNaN(d.getTime())
        ? String(value)
        : `${d.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
    }
    default: return String(value);
  }
}

export const reportFilename = (report, ext) => {
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
  return `${slug(report.business.name)}-${slug(report.kind)}-${new Date(report.generatedAt).toISOString().slice(0, 10)}.${ext}`;
};

export const periodText = (report) =>
  report.period ? `${report.period.label}${report.period.from && report.period.to && report.period.from !== report.period.to ? ` · ${report.period.from} to ${report.period.to}` : ""}` : "";

// Does any value in this column carry cents? Then every value shows them.
export const columnNeedsDecimals = (section, col) =>
  col.format === "money" &&
  [...section.rows, ...(section.totals ? [section.totals] : [])].some((r) => {
    const n = Number(r[col.key]);
    return r[col.key] !== undefined && r[col.key] !== null && Number.isFinite(n) && !Number.isInteger(n);
  });
