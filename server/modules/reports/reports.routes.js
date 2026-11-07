import { Router } from "express";
import { REPORT_KINDS, buildReport, canBuild, reportsFor } from "#modules/reports/reportData.js";
import { renderPdf } from "#modules/reports/renderPdf.js";
import { renderXlsx } from "#modules/reports/renderXlsx.js";
import { reportFilename } from "#modules/reports/format.js";
import { rateLimit } from "#core/rateLimit.js";
import { audit } from "#core/audit.js";

export const reportsRouter = Router();

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// GET /api/reports — the reports this person may download
reportsRouter.get("/", (req, res) => {
  res.json({ reports: reportsFor(req.ctx) });
});

// GET /api/reports/:kind?format=pdf|xlsx&days=30
//
// Built fresh from the database on every download, from the same builders the
// dashboard uses, and gated by the same permission as the screen it mirrors —
// so a report can never show someone more than the app would.
reportsRouter.get("/:kind", async (req, res) => {
  const { kind } = req.params;
  if (!REPORT_KINDS[kind]) return res.status(404).json({ error: "not_found", message: "There's no report by that name." });
  if (!canBuild(req.ctx, kind)) return res.status(403).json({ error: "forbidden", message: "You don't have permission to download that report." });
  if (!rateLimit(`report:${req.ctx.userId}`, { max: 60, windowMs: 60 * 60 * 1000 })) {
    return res.status(429).json({ error: "rate_limited", message: "That's a lot of reports — give it a little while and try again." });
  }

  const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
  const { from, to, type, method } = req.query;
  const report = await buildReport(req.ctx, kind, req.query.days, { from, to, type, method });
  if (!report) return res.status(404).json({ error: "not_found", message: "That report isn't available." });

  const buffer = format === "xlsx" ? await renderXlsx(report) : await renderPdf(report);
  audit(req.ctx, "report.download", { type: "report", label: `${report.title} (${format.toUpperCase()})` });

  res.set({
    "Content-Type": TYPES[format],
    "Content-Disposition": `attachment; filename="${reportFilename(report, format)}"`,
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
  });
  res.send(buffer);
});
