import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { portalPlugin } from "@interchained/portal-core/vite";

/**
 * Portal's `@portal/routes` virtual module emits relative specifiers
 * (`import Route0 from "./routes/index.page.tsx"`). On Vite 5.4.x those can't be
 * resolved from a `\0virtual:` importer, which throws:
 *   "Failed to resolve import './routes/index.page.tsx' from 'virtual:@portal/routes'".
 * This shim rewrites them to absolute paths — scoped strictly to that virtual module,
 * so it never touches normal app imports.
 */
function portalRouteResolver(): Plugin {
  let root = process.cwd();
  return {
    name: "portal-virtual-route-resolver",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    resolveId(source, importer) {
      if (
        importer &&
        importer.includes("@portal/routes") &&
        (source.startsWith("./") || source.startsWith("../"))
      ) {
        return resolve(root, source);
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // LINKS_API_PORT = Express API server (canonical; falls back to PORT)
  // VITE_PORT      = Vite dev client (what the browser connects to in dev)
  // LINKS_API_URL  = full override for the API proxy target (optional)
  // The API resolves its port with the SAME chain (src/server/config.ts) —
  // if you change ports in .env, both sides move together. The dev-api
  // wrapper restarts the API on .env changes so it can never lag behind
  // a Vite env-triggered restart.
  const apiPort   = env.LINKS_API_PORT || env.PORT || "3001";
  const clientPort = Number(env.VITE_PORT || 3000);
  const apiTarget = env.LINKS_API_URL || `http://localhost:${apiPort}`;

  // Paths the DEV SERVER owns (the editor SPA + Vite internals). Everything
  // else — /:handle profiles, /go click redirects, /api — belongs to the
  // Express server, exactly like production. Without this, published
  // profiles 404 into the SPA during `npm run dev` (found live by Mark:
  // "View" showed the not-claimed page for a claimed handle).
  const SPA_PREFIXES = ["/identities", "/edit", "/analytics", "/verify", "/reset", "/magic", "/src", "/node_modules", "/assets"];
  function servedByVite(url: string): boolean {
    const path = url.split("?")[0];
    if (path === "/" || path === "/index.html") return true;
    if (path.startsWith("/@")) return true; // vite client, HMR, virtual modules
    if (path.includes(".")) return true; // files with extensions (favicon, ts, css…)
    return SPA_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  }

  /** ECONNREFUSED with a hint instead of a bare stack — the #1 dev trap
   *  is the API listening on a different port than the proxy targets. */
  function proxyHints(proxy: Parameters<NonNullable<ProxyOptions["configure"]>>[0]): void {
    let warned = 0;
    proxy.on("error", (err) => {
      if (Date.now() - warned < 2000) return; // rate-limit the hint
      warned = Date.now();
      console.error(
        `\n[links] API proxy → ${apiTarget} failed: ${err.message}\n` +
          `        Is the [api] process running? If you changed ports in .env,\n` +
          `        restart \`npm run dev\` — or rely on the dev-api wrapper,\n` +
          `        which restarts the API on .env changes automatically.\n`,
      );
    });
  }

  return {
    plugins: [react(), portalPlugin(), portalRouteResolver()],
    server: {
      port: clientPort,
      allowedHosts: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true, configure: proxyHints },
        // Catch-all: public surfaces render on the API server in dev too.
        "/": {
          target: apiTarget,
          changeOrigin: true,
          bypass: (req) => (req.url && servedByVite(req.url) ? req.url : undefined),
          configure: proxyHints,
        },
      },
    },
    resolve: {
      alias: { "@": "/src" },
    },
  };
});
