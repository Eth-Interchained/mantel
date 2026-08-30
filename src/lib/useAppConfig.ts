import { useEffect, useState } from "react";

import { getAppConfig, type AppConfig } from "./api";

/** The deployment's product config — null until the first fetch lands
 *  (cached module-wide after that, so subsequent mounts are instant). */
export function useAppConfig(): AppConfig | null {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void getAppConfig().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
