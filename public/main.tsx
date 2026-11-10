import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, getTheme } from "./lib/theme";
import { SessionProvider } from "./lib/session";
import { startStackingTables } from "./lib/stackTables";

applyTheme(getTheme());
// Tables become cards on a phone (see lib/stackTables.ts).
startStackingTables();

// A data router (rather than <BrowserRouter>) because only it can animate a
// page change with the browser's View Transitions. The app's own <Routes>
// still live in App.tsx unchanged — this single catch-all route just hosts them.
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <SessionProvider>
        <App />
      </SessionProvider>
    ),
  },
]);

// Every navigation animates (old page out, new page in, see index.css), so
// no link has to opt in by hand. Skipped for people who ask for less motion;
// browsers without View Transitions just switch instantly as before.
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const navigate = router.navigate.bind(router);
router.navigate = ((to: Parameters<typeof navigate>[0], opts?: Parameters<typeof navigate>[1]) =>
  navigate(to as never, { ...opts, viewTransition: opts?.viewTransition ?? !reduceMotion?.matches })) as typeof router.navigate;

// Starting a new navigation while one is still animating cancels the first
// transition, and the browser reports that as an unhandled rejection. It's
// expected and harmless, so it's silenced here once for every caller.
const startVT = (document as any).startViewTransition?.bind(document);
if (startVT) {
  (document as any).startViewTransition = (arg: unknown) => {
    const t = startVT(arg);
    t.ready?.catch(() => {});
    t.updateCallbackDone?.catch(() => {});
    t.finished?.catch(() => {});
    return t;
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
