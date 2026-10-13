"use client";

import { useEffect, useState } from "react";

export type AppConfig = {
  deployed: boolean;
  address: `0x${string}` | null;
  chainId: number | null;
  relayerEnabled: boolean;
  aiEnabled: boolean;
};

export function useAppConfig(): AppConfig | undefined {
  const [config, setConfig] = useState<AppConfig>();
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ deployed: false, address: null, chainId: null, relayerEnabled: false, aiEnabled: false }));
  }, []);
  return config;
}
