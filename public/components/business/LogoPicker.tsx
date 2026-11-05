import { useRef, useState } from "react";
import { ImagePlus, Trash2, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LockChip } from "@/components/plan/PlanUi";
import { shrinkLogo } from "@/lib/logo";
import { useSession } from "@/lib/session";

/**
 * Choose a business logo: a preview square, plus Upload / Change / Remove.
 * The image is shrunk in the browser first (see lib/logo.ts). `onPick` gets
 * the prepared image; saving it is up to the caller (straight away in
 * Settings, with the account at sign-up).
 */
export function LogoPicker({ url, onPick, onRemove, busy, note = true }: {
  url: string;
  onPick: (image: Blob, preview: string) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  busy?: boolean;
  /** Show the line about logos printing on Business plan receipts. */
  note?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { session, hasFeature } = useSession();
  // At sign-up there is no plan yet, so just say where it prints.
  const printsOnReceipts = !session || hasFeature("receiptLogo");
  const [error, setError] = useState("");

  async function chosen(file?: File) {
    if (!file) return;
    setError("");
    try {
      const image = await shrinkLogo(file);
      await onPick(image, URL.createObjectURL(image));
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="w-20 h-20 rounded-2xl border border-line-2 bg-surface-2 grid place-items-center overflow-hidden shrink-0">
        {url ? <img src={url} alt="Business logo" className="w-full h-full object-contain p-1.5" /> : <Store className="w-7 h-7 text-t4" />}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            <ImagePlus className="w-3.5 h-3.5" /> {busy ? "Saving…" : url ? "Change logo" : "Upload logo"}
          </Button>
          {url && onRemove && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onRemove()} disabled={busy}><Trash2 className="w-3.5 h-3.5" /> Remove</Button>
          )}
        </div>
        <div className="text-[11.5px] text-t3">PNG, JPEG or WebP. A square image looks best.</div>
        {note && (printsOnReceipts
          ? <div className="text-[11.5px] text-t3">Shows across the app{session ? " and prints at the top of your receipts" : ", and on receipts with the Business plan"}.</div>
          : <div className="text-[11.5px] text-t3 flex items-center gap-1.5 flex-wrap">Shows across the app. Printing it on receipts needs <LockChip feature="receiptLogo" /></div>)}
        {error && <div className="text-[11.5px] text-danger font-semibold">{error}</div>}
      </div>
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => chosen(e.target.files?.[0])} />
    </div>
  );
}
