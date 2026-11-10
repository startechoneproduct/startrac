import { useMemo, useState } from "react";
import { Factory, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/EmptyState";
import { ErrorBanner, Field, Input, Select } from "@/components/ui/Field";
import { Table, TR, TH, TD } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { usePaged, Pager } from "@/components/ui/Pager";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";

type BomLine = { productId: string; factor: number; includeLeakage?: boolean };
type Product = { id: string; name: string; archetype?: string; bom?: BomLine[]; producedUnitsPerStockUnit?: number };
type Run = {
  id: string; runNo: string; productName: string; producedUnits: number; leakage: number;
  creditedQty: number; components: { name: string; qty: number }[]; note: string; staffName: string; at: string;
};

// Water bottling/sachet lines, but equally bakery/furniture/printing — any
// trade with the "production" capability and a recipe on a stock product.
export function Production() {
  const { activeBranch } = useSession();
  const { data: prodData } = useApi<{ products: Product[] }>("/products", [activeBranch?.id]);
  const products = useMemo(() => prodData?.products ?? [], [prodData]);
  const recipeProducts = useMemo(() => products.filter((p) => p.archetype !== "made_to_order" && p.bom?.length), [products]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const { data: runData, loading, reload } = useApi<{ runs: Run[] }>("/production/runs", [activeBranch?.id]);
  const paged = usePaged(runData?.runs || []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <PageHeader title="Production" subtitle="Raw materials in, finished stock out — recorded batch by batch" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 p-5 self-start">
          <RunForm products={recipeProducts} productById={productById} onRecorded={reload} />
        </Card>

        <Card className="lg:col-span-3 overflow-hidden self-start">
          <div className="p-4 pb-2 flex items-center gap-2">
            <Factory className="w-4 h-4 text-primary" />
            <span className="text-[14px] font-semibold text-t1">Run history</span>
          </div>
          {loading ? (
            <Spinner />
          ) : !runData?.runs.length ? (
            <EmptyState icon={Factory} title="No runs recorded yet" body="Record your first production run on the left." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <TR hover={false}>
                      <TH>Run</TH>
                      <TH>Product</TH>
                      <TH className="text-right">Produced</TH>
                      <TH className="text-right">Leakage</TH>
                      <TH className="text-right">Credited</TH>
                      <TH>When</TH>
                    </TR>
                  </thead>
                  <tbody>
                    {paged.rows.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-mono !text-primary font-semibold">{r.runNo}</TD>
                        <TD>
                          <div className="font-semibold">{r.productName}</div>
                          <div className="text-[11px] text-t3">{r.components.map((c) => `${c.name} ×${c.qty}`).join(", ")}</div>
                        </TD>
                        <TD className="text-right font-mono">{r.producedUnits}</TD>
                        <TD className="text-right font-mono !text-t3">{r.leakage}</TD>
                        <TD className="text-right font-mono font-semibold">+{r.creditedQty}</TD>
                        <TD className="!text-t3">{fmtDateTime(r.at)} · {r.staffName}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
              <Pager {...paged} onPage={paged.setPage} noun="runs" />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function RunForm({ products, productById, onRecorded }: {
  products: Product[]; productById: Map<string, Product>; onRecorded: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [producedUnits, setProducedUnits] = useState(1);
  const [leakage, setLeakage] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  const product = productId ? productById.get(productId) : null;
  const yieldPer = product?.producedUnitsPerStockUnit || 1;
  const creditedPreview = product ? Math.floor(producedUnits / yieldPer) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return;
    setBusy(true); setError(""); setDone("");
    try {
      const res = await api<{ run: Run }>("/production/runs", {
        method: "POST",
        body: JSON.stringify({ productId, producedUnits, leakage, note }),
      });
      setDone(`${res.run.runNo} — credited +${res.run.creditedQty} ${res.run.productName}.`);
      setProducedUnits(1); setLeakage(0); setNote("");
      onRecorded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <ErrorBanner message={error} />
      {done && <div className="px-3 py-2.5 rounded-ctl bg-success-soft text-success text-[12px] font-semibold">{done}</div>}

      {products.length === 0 ? (
        <div className="text-[12px] text-t3">
          No product has a recipe yet — add one from the Products page (toggle "Made from raw materials" on a stock item).
        </div>
      ) : (
        <>
          <Field label="Product">
            <Select required value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Units produced">
              <Input required type="number" min="1" value={producedUnits} onChange={(e) => setProducedUnits(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Leakage" hint="Burst/torn during the run">
              <Input type="number" min="0" value={leakage} onChange={(e) => setLeakage(Number(e.target.value) || 0)} />
            </Field>
          </div>

          {product && (
            <div className="px-3 py-2.5 rounded-ctl bg-surface-2 border border-line text-[12px] text-t2 space-y-1">
              <div className="font-semibold text-t1">This run will consume:</div>
              {(product.bom || []).map((line, i) => {
                const comp = productById.get(line.productId);
                const includeLeakage = line.includeLeakage !== false;
                const qty = Math.round(line.factor * (producedUnits + (includeLeakage ? leakage : 0)) * 1000) / 1000;
                return <div key={i}>{comp?.name || "—"} × {qty}</div>;
              })}
              <div className="pt-1 mt-1 border-t border-line text-t1 font-semibold">
                Credits +{creditedPreview} {product.name}
                {yieldPer > 1 && <span className="text-t3 font-normal"> ({yieldPer} units = 1)</span>}
              </div>
            </div>
          )}

          <Field label="Note" hint="Optional">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Morning batch" />
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !productId}>
            <Plus className="w-4 h-4" /> {busy ? "Recording…" : "Record production run"}
          </Button>
        </>
      )}
    </form>
  );
}
