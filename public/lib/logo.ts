/** Where a business's logo loads from (see server/modules/business/logo.js), or "" if it has none. */
export function businessLogoUrl(b: { id: string; settings?: { logo?: { fileId?: string | null; version?: number } } } | null | undefined) {
  const logo = b?.settings?.logo;
  return b && logo?.fileId ? `/api/public/logo/${b.id}?v=${logo.version || 1}` : "";
}

/**
 * Shrinks a picked image to a logo-sized square-ish image (longest side
 * `max` px), keeping transparency, so receipts and the app load it quickly.
 * Returns the smaller of WebP and PNG.
 */
export async function shrinkLogo(file: File, max = 320): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That image couldn't be opened."));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const as = (type: string, q?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
    const [webp, png] = await Promise.all([as("image/webp", 0.9), as("image/png")]);
    const options = [webp?.type === "image/webp" ? webp : null, png].filter(Boolean) as Blob[];
    const best = options.sort((a, b) => a.size - b.size)[0];
    if (!best) throw new Error("That image couldn't be prepared.");
    if (best.size > 190 * 1024) throw new Error("That logo is still too large after shrinking. Try a simpler image.");
    return best;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A Blob as base64 (no "data:" prefix), for sending inside a JSON request. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
