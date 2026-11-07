import PDFDocument from "pdfkit";
import { fontFile } from "#modules/reports/renderPdf.js";

/**
 * The invoice as a PDF (A4). Drawn by hand like the reports, so it needs no
 * browser and works wherever the API runs. Uses the same bundled Inter fonts,
 * with a per-character fallback to the "latin-ext" cut so the naira sign prints.
 *
 * `inv` is the shaped invoice (see shape() in invoices.service.js), `biz` is the
 * public face of the business: { name, address, phone, email, taxId, accent, bank:{…}, footer }.
 */

const C = { ink: "#14172e", muted: "#667085", subtle: "#98a2b3", rule: "#e4e7ec", zebra: "#f8f9fc", good: "#0f9f6e", bad: "#d02b3c", warn: "#c96a05", white: "#ffffff" };
const MARGIN = 44;

const money = (n, cur) => `${cur}${/[A-Za-z]$/.test(cur) ? " " : ""}${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const dateText = (d) => (d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function renderInvoicePdf(inv, biz, currency = "₦") {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 }, bufferPages: true, font: fontFile("latin", 400),
      info: { Title: `Invoice ${inv.invoiceNo || "draft"} — ${biz.name}`, Author: biz.name, Creator: "StarTrack" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const [w, label] of [[400, "R"], [600, "S"], [700, "B"]]) {
      doc.registerFont(label, fontFile("latin", w));
      doc.registerFont(`${label}x`, fontFile("latin-ext", w));
    }

    const W = doc.page.width, H = doc.page.height, CW = W - MARGIN * 2;
    const accent = /^#[0-9a-f]{6}$/i.test(biz.accent || "") ? biz.accent : "#3538f0";

    // Text with a per-character font fallback (naira sign lives in the ext cut).
    const has = {};
    const covers = (face, ch) => { if (!(face in has)) { doc.font(face); has[face] = doc._font.font; } return has[face].hasGlyphForCodePoint(ch.codePointAt(0)); };
    const runs = (s, face) => {
      const out = [];
      for (const ch of String(s)) {
        const f = ch === " " || covers(face, ch) ? face : covers(`${face}x`, ch) ? `${face}x` : face;
        if (out.length && out[out.length - 1].f === f) out[out.length - 1].t += ch; else out.push({ f, t: ch });
      }
      return out;
    };
    const measure = (s, face, size) => runs(s, face).reduce((n, r) => n + doc.font(r.f).fontSize(size).widthOfString(r.t), 0);
    const fit = (s, face, size, maxW) => { let t = String(s); if (measure(t, face, size) <= maxW) return t; while (t.length > 1 && measure(`${t}…`, face, size) > maxW) t = t.slice(0, -1); return `${t.trimEnd()}…`; };
    const put = (s, x, y, { face = "R", size = 9.5, color = C.ink, align = "left", width = 0 } = {}) => {
      let cx = x;
      if (align !== "left" && width) { const w = measure(s, face, size); cx = align === "right" ? x + width - w : x + (width - w) / 2; }
      doc.fillColor(color);
      for (const r of runs(s, face)) { doc.font(r.f).fontSize(size).text(r.t, cx, y, { lineBreak: false }); cx += doc.widthOfString(r.t); }
    };
    // Wrapped paragraph; returns the y after it.
    const para = (s, x, y, w, opts = {}) => {
      const size = opts.size || 9;
      const words = String(s).split(/\s+/);
      let line = "", yy = y;
      for (const word of words) {
        const trial = line ? `${line} ${word}` : word;
        if (measure(trial, opts.face || "R", size) > w && line) { put(line, x, yy, opts); yy += size * 1.45; line = word; } else line = trial;
      }
      if (line) { put(line, x, yy, opts); yy += size * 1.45; }
      return yy;
    };

    const status = inv.displayStatus;
    const stamp = { paid: ["PAID", C.good], overdue: ["OVERDUE", C.bad], void: ["VOID", C.subtle], partial: ["PART PAID", C.warn], draft: ["DRAFT", C.subtle] }[status];

    // ── header ──
    doc.rect(0, 0, W, 6).fill(accent);
    put(biz.name, MARGIN, 40, { face: "B", size: 19 });
    let by = 66;
    for (const line of [biz.address, [biz.phone, biz.email].filter(Boolean).join("  ·  "), biz.taxId ? `Tax ID: ${biz.taxId}` : ""].filter(Boolean)) { put(line, MARGIN, by, { size: 9, color: C.muted }); by += 13; }

    put("INVOICE", MARGIN, 40, { face: "B", size: 26, color: accent, align: "right", width: CW });
    put(inv.invoiceNo || "Draft", MARGIN, 72, { face: "S", size: 12, align: "right", width: CW });
    if (stamp) {
      const w = measure(stamp[0], "B", 9.5) + 20;
      doc.roundedRect(W - MARGIN - w, 94, w, 20, 10).lineWidth(1.2).strokeColor(stamp[1]).stroke();
      put(stamp[0], W - MARGIN - w, 99.5, { face: "B", size: 9.5, color: stamp[1], align: "center", width: w });
    }

    // ── bill to / dates ──
    let y = Math.max(by, 124) + 18;
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).lineWidth(0.8).strokeColor(C.rule).stroke();
    y += 16;
    put("BILL TO", MARGIN, y, { face: "S", size: 8, color: C.subtle });
    put(inv.customer?.name || "—", MARGIN, y + 13, { face: "B", size: 12 });
    let cy = y + 31;
    for (const line of [inv.customer?.phone, inv.customer?.email, inv.customer?.address].filter(Boolean)) { cy = para(line, MARGIN, cy, CW * 0.5, { size: 9, color: C.muted }); }
    const colX = MARGIN + CW * 0.62, colW = CW * 0.38;
    [["Issued", dateText(inv.issueDate)], ["Due", dateText(inv.dueDate)], ["Amount due", money(inv.balance, currency)]].forEach(([k, v], i) => {
      put(k, colX, y + i * 19, { size: 9, color: C.muted });
      put(v, colX, y + i * 19, { face: i === 2 ? "B" : "S", size: i === 2 ? 11 : 9.5, align: "right", width: colW, color: i === 2 && inv.balance > 0 ? accent : C.ink });
    });
    y = Math.max(cy, y + 64) + 10;

    // ── lines ──
    const cols = { desc: MARGIN + 10, qty: MARGIN + CW * 0.56, price: MARGIN + CW * 0.68, amt: MARGIN + CW - 10 };
    const head = () => {
      doc.rect(MARGIN, y, CW, 24).fill(accent);
      put("DESCRIPTION", cols.desc, y + 8, { face: "B", size: 8, color: C.white });
      put("QTY", cols.qty, y + 8, { face: "B", size: 8, color: C.white, align: "right", width: 40 });
      put("UNIT PRICE", cols.price, y + 8, { face: "B", size: 8, color: C.white, align: "right", width: 70 });
      put("AMOUNT", cols.amt - 80, y + 8, { face: "B", size: 8, color: C.white, align: "right", width: 80 });
      y += 24;
    };
    head();
    inv.items.forEach((l, i) => {
      const descW = cols.qty - cols.desc - 14;
      const h = 22 + (l.description ? 12 : 0);
      if (y + h > H - 150) { doc.addPage(); y = 48; head(); }
      if (i % 2 === 0) doc.rect(MARGIN, y, CW, h).fill(C.zebra);
      put(fit(l.name, "S", 9.5, descW), cols.desc, y + 6.5, { face: "S", size: 9.5 });
      if (l.description) put(fit(l.description, "R", 8.2, descW), cols.desc, y + 19, { size: 8.2, color: C.muted });
      put(String(l.qty), cols.qty, y + 7, { size: 9.5, align: "right", width: 40 });
      put(money(l.unitPrice, currency), cols.price, y + 7, { size: 9.5, align: "right", width: 70 });
      put(money(l.lineNet, currency), cols.amt - 80, y + 7, { face: "S", size: 9.5, align: "right", width: 80 });
      y += h;
    });
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).lineWidth(0.8).strokeColor(C.rule).stroke();

    // ── totals ──
    if (y > H - 190) { doc.addPage(); y = 48; }
    y += 14;
    const tx = MARGIN + CW * 0.55, tw = CW * 0.45;
    const row = (k, v, { bold = false, color = C.ink, size = 10 } = {}) => {
      put(k, tx, y, { face: bold ? "B" : "R", size, color: bold ? color : C.muted });
      put(v, tx, y, { face: bold ? "B" : "S", size, color, align: "right", width: tw });
      y += size + 8;
    };
    row("Subtotal", money(inv.subtotal, currency));
    if (inv.discount > 0) row("Discount", `−${money(inv.discount, currency)}`);
    if (inv.vat > 0) row(`VAT (${inv.vatRate}%)`, money(inv.vat, currency));
    doc.moveTo(tx, y - 2).lineTo(tx + tw, y - 2).lineWidth(0.8).strokeColor(C.rule).stroke();
    y += 4;
    row("Total", money(inv.total, currency), { bold: true, size: 12 });
    if (inv.amountPaid > 0) row("Paid", `−${money(inv.amountPaid, currency)}`, { color: C.good });
    if (status !== "void") {
      doc.roundedRect(tx - 8, y - 4, tw + 16, 30, 6).fill(inv.balance > 0 ? accent : C.good);
      put(inv.balance > 0 ? "Balance due" : "Paid in full", tx + 4, y + 5.5, { face: "B", size: 11, color: C.white });
      put(money(inv.balance, currency), tx, y + 5.5, { face: "B", size: 12, color: C.white, align: "right", width: tw - 12 });
      y += 40;
    }

    // ── how to pay, notes, terms ──
    const left = MARGIN;
    let ny = y + 6;
    const block = (title, body) => { if (ny > H - 90) { doc.addPage(); ny = 48; } put(title, left, ny, { face: "S", size: 8, color: C.subtle }); ny = para(body, left, ny + 12, CW, { size: 9, color: C.ink }) + 8; };
    if (biz.bank?.accountNumber && inv.balance > 0 && status !== "void") block("HOW TO PAY", `${biz.bank.bankName ? `${biz.bank.bankName} · ` : ""}${biz.bank.accountName ? `${biz.bank.accountName} · ` : ""}Account ${biz.bank.accountNumber}. Please use ${inv.invoiceNo} as the reference.`);
    if (inv.notes) block("NOTES", inv.notes);
    if (inv.terms) block("TERMS", inv.terms);
    if (inv.payments.length) block("PAYMENTS RECEIVED", inv.payments.map((p) => `${dateText(p.at)} · ${money(p.amount, currency)} by ${p.method}`).join("   |   "));

    // ── footer on every page ──
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, H - 44).lineTo(W - MARGIN, H - 44).lineWidth(0.6).strokeColor(C.rule).stroke();
      put(biz.footer || "Thank you for your business.", MARGIN, H - 34, { size: 8.5, color: C.muted });
      put(`Page ${i + 1} of ${range.count}`, MARGIN, H - 34, { size: 8.5, color: C.subtle, align: "right", width: CW });
    }
    doc.end();
  });
}
