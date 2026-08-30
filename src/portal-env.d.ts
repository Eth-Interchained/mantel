/**
 * Ambient declaration for Portal's virtual routes module.
 *
 * `@portal/routes` is emitted at build time by @interchained/portal-core's
 * Vite plugin from the routes/ directory. The plugin doesn't ship an ambient
 * type for it (upstream improvement candidate for portal-core), so we declare
 * it here to keep `tsc --noEmit` honest.
 */
declare module "@portal/routes" {
  import type { RouteDefinition } from "@interchained/portal-react";

  export const routes: RouteDefinition[];
}
