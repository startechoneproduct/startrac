import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Printer } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";

type View = {
  invoice: {
    invoiceNo: string; status: "issued" | "partial" | "paid" | "void"; displayStatus: "issued" | "partial" | "paid" | "void" | "overdue"; daysOverdue: number;
    customer: { name: string; email: string; phone: string; address: string };
    items: { name: string; description: string; qty: number; unitPrice: number; lineNet: number }[];
    subtotal: number; discount: number; vatRate: number; vat: number; total: number; amountPaid: number; balance: number;
    issueDate: string; dueDate: string | null; notes: string; terms: string;
    payments: { method: string; amount: number; at: string }[];
  };
  business: { name: string; address: string; phone: string; email: string; taxId: string; accent: string; logoUrl: string; currency: string; footer: string };
  bank: { bankName: string; accountName: string; accountNumber: string } | null;
};

const STAMP: Record<string, [string, string]> = {
  paid: ["Paid", "#0f9f6e"], overdue: ["Overdue", "#d02b3c"], void: ["Void", "#667085"], partial: ["Part paid", "#c96a05"], issued: ["Awaiting payment", "#3538f0"],
};

/**
 * What a customer opens from the link they were sent: the invoice, how to pay,
 * and a PDF. Public and read-only — no login, and nothing but what is printed
 * on the invoice itself.
 */
export function InvoiceView() {
  const { token = "" } = useParams();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<View>(`/public/invoices/${token}`).then(setV).catch((e) => setError(e instanceof ApiError ? e.message : "This invoice isn't available."));
  }, [token]);

  if (error) return <div className="min-h-screen grid place-items-center bg-surface-2 p-6 text-center"><div><div className="text-[18px] font-semibold text-t1">Invoice not available</div><p className="text-[13px] text-t3 mt-1">{error} Check the link, or ask the sender for a new one.</p></div></div>;
  if (!v) return <div className="min-h-screen grid place-items-center bg-surface-2"><div className="w-6 h-6 rounded-full border-2 border-line border-t-primary animate-spin" /></div>;

  const { invoice: i, business: b, bank } = v;
  const money = (n: number) => fmtMoney(n, b.currency, false);
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : "#3538f0";
  const [stampText, stampColor] = STAMP[i.displayStatus] || STAMP.issued;
  const owing = i.status !== "void" && i.balance > 0;

  return (
    <div className="min-h-screen bg-surface-2 py-6 px-4 print:bg-white print:p-0">
      <div className="max-w-[760px] mx-auto">
        <div className="flex justify-end gap-2 mb-3 print:hidden">
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-line-2 bg-surface text-[13px] font-semibold text-t1 hover:bg-surface-3"><Printer className="w-4 h-4" /> Print</button>
          <a href={`/api/public/invoices/${token}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-white text-[13px] font-semibold" style={{ background: accent }}><Download className="w-4 h-4" /> PDF</a>
        </div>

        <article className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden print:shadow-none print:border-0" data-testid="public-invoice">
          <div className="h-1.5" style={{ background: accent }} />
          <div className="p-6 sm:p-9">
            <header className="flex justify-between gap-6 flex-wrap">
              <div>
                {b.logoUrl && <img src={b.logoUrl} alt="" className="h-10 mb-2 object-contain" />}
                <h1 className="text-[20px] font-bold text-t1">{b.name}</h1>
                <div className="text-[12.5px] text-t3 mt-1 space-y-0.5">{b.address && <div>{b.address}</div>}{(b.phone || b.email) && <div>{[b.phone, b.email].filter(Boolean).join(" · ")}</div>}{b.taxId && <div>Tax ID: {b.taxId}</div>}</div>
              </div>
              <div className="text-right">
                <div className="text-[26px] font-bold tracking-tight" style={{ color: accent }}>INVOICE</div>
                <div className="text-[14px] font-semibold text-t1" data-testid="public-invoice-no">{i.invoiceNo}</div>
                <span className="inline-block mt-2 px-3 py-0.5 rounded-full border-[1.5px] text-[11px] font-bold uppercase tracking-wide" style={{ color: stampColor, borderColor: stampColor }}>{i.displayStatus === "overdue" ? `Overdue · ${i.daysOverdue}d` : stampText}</span>
              </div>
            </header>

            <div className="grid sm:grid-cols-2 gap-6 mt-8 pt-6 border-t border-line">
              <div>
                <div className="text-[10.5px] font-semibold tracking-wider text-t4">BILL TO</div>
                <div className="text-[15px] font-bold text-t1 mt-1">{i.customer.name}</div>
                <div className="text-[12.5px] text-t3 mt-0.5 space-y-0.5">{[i.customer.phone, i.customer.email, i.customer.address].filter(Boolean).map((x) => <div key={x}>{x}</div>)}</div>
              </div>
              <dl className="text-[13px] space-y-1.5 sm:justify-self-end sm:min-w-[220px]">
                <div className="flex justify-between gap-6"><dt className="text-t3">Issued</dt><dd className="font-semibold text-t1">{fmtDate(i.issueDate)}</dd></div>
                {i.dueDate && <div className="flex justify-between gap-6"><dt className="text-t3">Due</dt><dd className="font-semibold text-t1">{fmtDate(i.dueDate)}</dd></div>}
                <div className="flex justify-between gap-6"><dt className="text-t3">Amount due</dt><dd className="font-bold" style={{ color: owing ? accent : "#0f9f6e" }}>{money(i.status === "void" ? 0 : i.balance)}</dd></div>
              </dl>
            </div>

            <div className="mt-7 rounded-xl overflow-hidden border border-line">
              <div className="grid grid-cols-[1fr_52px_96px_104px] sm:grid-cols-[1fr_70px_120px_130px] gap-2 px-4 py-2.5 text-[10.5px] font-bold tracking-wider text-white" style={{ background: accent }}>
                <div>DESCRIPTION</div><div className="text-right">QTY</div><div className="text-right">UNIT</div><div className="text-right">AMOUNT</div>
              </div>
              {i.items.map((l, k) => (
                <div key={k} className="grid grid-cols-[1fr_52px_96px_104px] sm:grid-cols-[1fr_70px_120px_130px] gap-2 px-4 py-3 text-[13px] border-b border-line last:border-0 odd:bg-surface-2/60">
                  <div><div className="font-semibold text-t1">{l.name}</div>{l.description && <div className="text-[11.5px] text-t3">{l.description}</div>}</div>
                  <div className="text-right tabular-nums">{l.qty}</div>
                  <div className="text-right tabular-nums">{money(l.unitPrice)}</div>
                  <div className="text-right tabular-nums font-semibold text-t1">{money(l.lineNet)}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 ml-auto max-w-[300px] text-[13px] space-y-1.5">
              <div className="flex justify-between text-t3"><span>Subtotal</span><span className="tabular-nums">{money(i.subtotal)}</span></div>
              {i.discount > 0 && <div className="flex justify-between text-t3"><span>Discount</span><span className="tabular-nums">−{money(i.discount)}</span></div>}
              {i.vat > 0 && <div className="flex justify-between text-t3"><span>VAT ({i.vatRate}%)</span><span className="tabular-nums">{money(i.vat)}</span></div>}
              <div className="flex justify-between font-bold text-t1 text-[15px] pt-1.5 border-t border-line"><span>Total</span><span className="tabular-nums">{money(i.total)}</span></div>
              {i.amountPaid > 0 && <div className="flex justify-between text-success"><span>Paid</span><span className="tabular-nums">−{money(i.amountPaid)}</span></div>}
              {i.status !== "void" && (
                <div className="flex justify-between items-center rounded-xl px-3.5 py-3 text-white font-bold text-[14px]" style={{ background: owing ? accent : "#0f9f6e" }}>
                  <span>{owing ? "Balance due" : "Paid in full"}</span><span className="tabular-nums" data-testid="public-balance">{money(i.balance)}</span>
                </div>
              )}
            </div>

            {owing && bank && (
              <section className="mt-8 rounded-xl border border-line p-4 bg-surface-2">
                <div className="text-[10.5px] font-semibold tracking-wider text-t4">HOW TO PAY</div>
                <div className="text-[13px] text-t1 mt-1.5">{[bank.bankName, bank.accountName].filter(Boolean).join(" · ")}</div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="font-mono text-[20px] font-bold text-t1 tracking-wide" data-testid="public-account">{bank.accountNumber}</span>
                  <button className="text-[12px] font-semibold hover:underline print:hidden" style={{ color: accent }} onClick={() => { navigator.clipboard?.writeText(bank.accountNumber.replace(/\D/g, "")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}>{copied ? "Copied" : "Copy number"}</button>
                </div>
                <p className="text-[11.5px] text-t3 mt-1.5">Please use {i.invoiceNo} as the payment reference.</p>
              </section>
            )}

            {(i.notes || i.terms) && (
              <div className="mt-6 grid sm:grid-cols-2 gap-5 text-[12.5px] text-t2">
                {i.notes && <div><div className="text-[10.5px] font-semibold tracking-wider text-t4 mb-1">NOTES</div><p className="whitespace-pre-wrap">{i.notes}</p></div>}
                {i.terms && <div><div className="text-[10.5px] font-semibold tracking-wider text-t4 mb-1">TERMS</div><p className="whitespace-pre-wrap">{i.terms}</p></div>}
              </div>
            )}

            {i.payments.length > 0 && (
              <div className="mt-6 text-[12.5px] text-t2">
                <div className="text-[10.5px] font-semibold tracking-wider text-t4 mb-1">PAYMENTS RECEIVED</div>
                {i.payments.map((p, k) => <div key={k}>{fmtDate(p.at)} · {money(p.amount)} by {p.method}</div>)}
              </div>
            )}

            <footer className="mt-9 pt-4 border-t border-line text-center text-[12px] text-t3">{b.footer}</footer>
          </div>
        </article>
      </div>
    </div>
  );
}
