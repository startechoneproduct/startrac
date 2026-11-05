import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, ErrorBanner } from "@/components/ui/Field";
import { CheckCircle2, Keyboard, Package, SearchX } from "lucide-react";

/** What a lookup found for a scanned code, shown before it is used. */
export type ScanMatch = { title: string; subtitle?: string; imageUrl?: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A scanned QR can carry either a bare code or a full card URL
// (…/loyalty/<code> — see loyaltyCard.service.js's loyaltyCardUrl). Either
// way, the code is what the server actually needs.
function extractCardCode(scanned: string): string {
  const m = scanned.match(/\/loyalty\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : scanned.trim();
}

/** What is being scanned decides the wording and how the result is read. */
export type ScanKind = "loyalty" | "member" | "product";

const TEXT: Record<ScanKind, { title: string; aim: string; manual: string; label: string; placeholder: string; submit: string }> = {
  loyalty: {
    title: "Scan loyalty card", aim: "Point the camera at the QR code on the card", manual: "Type the code from the card",
    label: "Loyalty code", placeholder: "From the customer's card", submit: "Apply",
  },
  member: {
    title: "Check in a member", aim: "Point the camera at the QR code on the member's card", manual: "Type the code from the member's card",
    label: "Card code", placeholder: "From the member's card", submit: "Check in",
  },
  product: {
    title: "Scan a product", aim: "Point the camera at the product's barcode", manual: "Type the barcode, or scan it with a barcode scanner",
    label: "Barcode or SKU", placeholder: "e.g. 5449000000996", submit: "Add to sale",
  },
};

// Every format a shop is likely to meet: the EAN/UPC on manufacturer packaging,
// Code 128/39 on labels and cartons, and QR for StarTrack's own cards and labels.
const FORMATS = [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
];

/** Why the camera couldn't start, in words a shop assistant can act on. */
function cameraProblem(err: unknown): string {
  const name = (err as { name?: string })?.name || "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "The camera only works when the app is opened on a secure (https) address. Type the code instead.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was refused. Allow the camera from the icon in your browser's address bar, or type the code instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device. Type the code instead, or use a barcode scanner.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is being used by another app. Close it and try again, or type the code instead.";
  }
  return "The camera couldn't start. Type the code instead.";
}

/**
 * Camera scanning with a type-it-in fallback, for product barcodes at the
 * till, loyalty cards and gym check-ins. Reads both striped barcodes (the
 * EAN/UPC printed on packaging) and QR codes. A USB or Bluetooth barcode
 * scanner also works on the typing screen: it types the code and presses
 * Enter, which submits.
 */
export function QrScanModal({ open, onClose, onCode, kind = "loyalty", title, lookup }: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
  kind?: ScanKind;
  title?: string;
  /**
   * Optional: find what a code refers to. With it, the window searches as soon
   * as a code is typed or scanned, shows what it found, and hands the code on
   * only when the person confirms (Add to sale). Without it, the code is
   * handed on straight away.
   */
  lookup?: (code: string) => ScanMatch | null | Promise<ScanMatch | null>;
}) {
  const text = TEXT[kind];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ status: "idle" | "searching" | "found" | "missing"; code: string; match: ScanMatch | null }>({ status: "idle", code: "", match: null });
  const read = (raw: string) => (kind === "product" ? raw.trim() : extractCardCode(raw));

  // A camera read goes into the box, where the search below picks it up.
  function scanned(raw: string) {
    if (!lookup) return onCode(read(raw));
    setManualCode(read(raw));
    setManual(true);
  }

  // Search as soon as typing pauses, so the product shows before anything is added.
  useEffect(() => {
    if (!lookup || !open) return;
    const code = read(manualCode);
    if (!code) { setPreview({ status: "idle", code: "", match: null }); return; }
    let stale = false;
    setPreview({ status: "searching", code, match: null });
    const timer = setTimeout(async () => {
      // A short minimum, so the search is seen rather than flashing past.
      const [hit] = await Promise.all([Promise.resolve(lookup(code)).catch(() => null), wait(300)]);
      if (!stale) setPreview({ status: hit ? "found" : "missing", code, match: hit });
    }, 350);
    return () => { stale = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualCode, open]);

  useEffect(() => {
    if (!open || manual) return;
    let cancelled = false;
    let controls: IScannerControls | null = null;
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

    (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (!result || cancelled) return;
            cancelled = true;
            controls?.stop();
            scanned(result.getText());
          }
        );
        if (cancelled) controls.stop();
      } catch (err) {
        if (cancelled) return;
        // Nothing to look at without a camera: go straight to typing the code.
        setError(cameraProblem(err));
        setManual(true);
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, manual, onCode, kind]);

  useEffect(() => {
    if (!open) { setManual(false); setManualCode(""); setError(""); setPreview({ status: "idle", code: "", match: null }); }
  }, [open]);

  const code = read(manualCode);
  const ready = !lookup ? !!code : preview.status === "found" && preview.code === code;

  return (
    <Modal open={open} onClose={onClose} title={title || text.title} subtitle={manual ? text.manual : text.aim}>
      <div className="space-y-3">
        <ErrorBanner message={error} />
        {!manual ? (
          <>
            <div className="relative aspect-square w-full max-w-[320px] mx-auto rounded-ctl overflow-hidden bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className={kind === "product" ? "absolute inset-x-6 top-1/3 bottom-1/3 border-2 border-white/70 rounded-lg pointer-events-none" : "absolute inset-6 border-2 border-white/70 rounded-lg pointer-events-none"} />
            </div>
            <button
              type="button"
              onClick={() => setManual(true)}
              className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-primary hover:underline"
            >
              <Keyboard className="w-3.5 h-3.5" /> Type the code instead
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); if (ready) onCode(code); }}
            className="space-y-3"
          >
            <Field label={text.label}>
              <Input autoFocus value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder={text.placeholder} inputMode={kind === "product" ? "numeric" : undefined} />
            </Field>

            {lookup && preview.status !== "idle" && (
              <div aria-live="polite">
                {preview.status === "searching" && (
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-4" role="status">
                    <div className="w-5 h-5 rounded-full border-2 border-line border-t-primary animate-spin shrink-0" />
                    <span className="text-[13px] font-semibold text-t2">Searching…</span>
                  </div>
                )}
                {preview.status === "found" && preview.match && (
                  <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success-soft px-4 py-3.5">
                    {preview.match.imageUrl ? (
                      <img src={preview.match.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-surface" />
                    ) : (
                      <span className="grid place-items-center w-14 h-14 rounded-lg bg-surface text-t3 shrink-0"><Package className="w-6 h-6" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-t1 truncate">{preview.match.title}</div>
                      {preview.match.subtitle && <div className="text-[12.5px] text-t2">{preview.match.subtitle}</div>}
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-success"><CheckCircle2 className="w-3.5 h-3.5" /> Product found</div>
                    </div>
                  </div>
                )}
                {preview.status === "missing" && (
                  <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3.5 text-[13px] text-danger">
                    <SearchX className="w-5 h-5 shrink-0" />
                    <span>No product found for "{preview.code}". Check the number and try again.</span>
                  </div>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!ready}>{text.submit}</Button>
            <button type="button" onClick={() => { setError(""); setManualCode(""); setManual(false); }} className="w-full text-[12px] font-semibold text-primary hover:underline">
              Try the camera again
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
