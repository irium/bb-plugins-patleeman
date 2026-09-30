// Whether the Studio plugin is installed and running. Add-ons hand their
// collection over to Studio when it is.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { STUDIO_PLUGIN_ID } from "../contract";

type Presence = boolean | null;

let cached: { value: boolean; at: number } | null = null;
const CACHE_MS = 30_000;

interface PluginLister {
  plugins: { list(): Promise<{ plugins: readonly { id: string; enabled: boolean; status?: string }[] }> };
}

async function lookUp(sdk: PluginLister): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const { plugins } = await sdk.plugins.list();
  const studio = plugins.find((plugin) => plugin.id === STUDIO_PLUGIN_ID);
  const value = Boolean(studio?.enabled && studio.status !== "error" && studio.status !== "incompatible");
  cached = { value, at: Date.now() };
  return value;
}

/** null while checking; a failed check counts as absent. */
export function useStudioPresent(): Presence {
  const sdk = useSdk() as unknown as PluginLister;
  const [present, setPresent] = useState<Presence>(() => (cached && Date.now() - cached.at < CACHE_MS ? cached.value : null));
  useEffect(() => {
    let live = true;
    lookUp(sdk).then(
      (value) => live && setPresent(value),
      () => live && setPresent(false),
    );
    return () => {
      live = false;
    };
  }, [sdk]);
  return present;
}
