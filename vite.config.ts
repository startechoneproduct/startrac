import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// The web client lives in public/ and the API in server/ — the two halves of
// one app. In production the client is built into dist/ and served by the API
// process itself; in development Vite proxies /api through to that same API.
// Either way the browser talks to a single origin, so there is no CORS.
export default defineConfig(({ mode }) => {
  const root = path.resolve(__dirname, "public");
  // Read the same .env the server uses, so ports are configured in one place.
  const env = loadEnv(mode, __dirname, "");
  const apiPort = Number(env.PORT) || 4000;
  const webPort = Number(env.WEB_PORT) || 5173;

  return {
    root,
    // Files copied to the build verbatim (favicon, icons) — everything else in
    // public/ is application source that Vite compiles.
    publicDir: path.resolve(root, "static"),
    build: {
      outDir: path.resolve(__dirname, "dist"),
      emptyOutDir: true,
    },
    envDir: __dirname,
    plugins: [
      react(),
      tailwindcss(),
      // injectManifest, not generateSW: the custom Background Sync handler
      // in public/sw.js (flushing the offline sales outbox) needs a real
      // event listener generateSW's declarative runtimeCaching config
      // can't express. manifest:false — public/static/manifest.json is
      // hand-authored and already copied verbatim by Vite's publicDir.
      VitePWA({
        strategies: "injectManifest",
        srcDir: ".",
        filename: "sw.js",
        manifest: false,
        injectRegister: "auto",
        registerType: "autoUpdate",
        injectManifest: {
          // The app shell only — API responses are handled by sw.js's own
          // runtime-caching routes, not precached.
          globPatterns: ["**/*.{js,css,html,svg}"],
          // The main bundle is ~2.35 MB, over Workbox's 2 MiB default, which
          // fails the build. Raise the cap so the shell is still precached
          // (needed for offline use).
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        // SW support in `vite dev` has real quirks and isn't how a PWA is
        // normally verified anyway — test this with a production build
        // (`npm run build`, then serve dist/) instead.
        devOptions: { enabled: false },
      }),
    ],
    server: {
      port: webPort,
      strictPort: true, // never silently move — the link stays stable
      proxy: {
        "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    resolve: {
      alias: {
        "@": root,
        "#shared": path.resolve(__dirname, "server/shared"),
      },
    },
  };
});
