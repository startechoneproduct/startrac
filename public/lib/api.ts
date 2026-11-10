// Same-origin by default: in production the API serves this very page, and in
// development Vite proxies /api to it. VITE_API_URL is only needed if the
// client is ever deployed apart from the server again.
const BASE = (import.meta.env.VITE_API_URL as string) || "/api";
const TOKEN_KEY = "startrack.token";

/**
 * Who this tab is signed in as.
 *
 * Each tab keeps its own login (sessionStorage), so one tab can stay on the
 * admin account while another uses a test shop, and a reload never swaps a
 * tab onto whichever account was signed into last somewhere else.
 * localStorage only holds the most recent sign-in, so a brand-new tab
 * starts signed in instead of asking every time.
 */
function readToken(): string | null {
  try {
    const own = sessionStorage.getItem(TOKEN_KEY);
    if (own) return own;
    // A tab without its own login yet (just opened, or opened before this
    // rule existed) takes the latest sign-in AND keeps a private copy of it
    // straight away, so a sign-in in another tab can't switch it later.
    const latest = localStorage.getItem(TOKEN_KEY);
    if (latest) sessionStorage.setItem(TOKEN_KEY, latest);
    return latest;
  } catch { return null; }
}

let token: string | null = readToken();
let businessId: string | null = null;
let branchId: string | null = null;

export function setToken(t: string | null) {
  const previous = token;
  token = t;
  try {
    if (t) {
      sessionStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(TOKEN_KEY, t);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
      // Signing out here only clears the shared default if it was this tab's
      // own login: signing out of a test tab mustn't sign new tabs out of admin.
      if (localStorage.getItem(TOKEN_KEY) === previous) localStorage.removeItem(TOKEN_KEY);
    }
  } catch { /* storage blocked: the login just lasts for this page */ }
}
export function getToken() {
  return token;
}

// The active business/branch ride on every request as headers. The server
// validates them against the caller's membership — they're context, not authority.
export function setTenant(biz: string | null, branch: string | null) {
  businessId = biz;
  branchId = branch;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  /** The server's whole error body, e.g. which plan a refused feature needs. */
  data?: Record<string, any>;
  constructor(message: string, status: number, code?: string, data?: Record<string, any>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  // A FormData body (file uploads) must NOT get an explicit Content-Type —
  // fetch sets multipart/form-data with the right boundary itself, and a
  // fixed "application/json" header here would break every image upload.
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  try {
    res = await fetch(BASE + path, {
      ...opts,
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(businessId ? { "x-business-id": businessId } : {}),
        ...(branchId ? { "x-branch-id": branchId } : {}),
        ...(opts.headers || {}),
      },
    });
  } catch {
    throw new ApiError("Can't reach the server. Is the API running?", 0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A plan boundary isn't a failure to hide in a corner: tell the whole app so
    // it can offer the upgrade, whichever screen made the request.
    if (res.status === 403 && (data.error === "plan_required" || data.error === "plan_limit")) {
      window.dispatchEvent(new CustomEvent("st:plan", { detail: data }));
    }
    if (res.status === 402 && data.error === "subscription_lapsed") {
      window.dispatchEvent(new CustomEvent("st:plan", { detail: { ...data, lapsed: true } }));
    }
    throw new ApiError(data.message || data.error || "Something went wrong", res.status, data.error, data);
  }
  return data as T;
}

/** GET a file with the same auth and tenant headers as every other call. A plain <a href> can't be used: the token travels in a header, not a cookie. */
async function fetchFile(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(businessId ? { "x-business-id": businessId } : {}),
        ...(branchId ? { "x-branch-id": branchId } : {}),
      },
    });
  } catch {
    throw new ApiError("Can't reach the server. Is the API running?", 0, "network");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.message || data.error || "Couldn't download that file.", res.status, data.error, data);
  }
  return res;
}

async function saveFile(res: Response, name: string) {
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download a report or PDF, named by the server (falling back to `fallbackName`). */
export async function apiDownload(path: string, fallbackName = "download"): Promise<void> {
  const res = await fetchFile(path);
  await saveFile(res, /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") || "")?.[1] || fallbackName);
}

/** Open a file (a receipt photo or PDF) in a new tab, fetched with the same sign-in as everything else. */
export async function openFile(path: string): Promise<void> {
  // Open the tab first, while the click still counts, or the browser blocks it as a pop-up.
  const tab = window.open("", "_blank");
  try {
    const url = URL.createObjectURL(await (await fetchFile(path)).blob());
    if (tab) tab.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Download a file (CSV export, template) under exactly this name. */
export async function downloadFile(path: string, fileName: string) {
  await saveFile(await fetchFile(path), fileName);
}
