// Finds the Studio add-ons and fans Studio's requests out to them. Add-ons
// publish `studio_describe` for discovery; the suite's own plugins are also
// looked up by id, so an older version that predates Studio can be named.
import { STUDIO_PLUGIN_ID, type StudioItem, type StudioProviderInfo } from "@bb-studio/kit/contract";
import { rpcErrorStatus } from "@bb-studio/kit/server";
import type { z } from "zod";
import type { ProviderView } from "./contract";
import { schemas } from "./contract";

/** The BB Studio suite, in the order Studio lists it. */
export const SUITE = ["pages", "talk", "excalidraw"];
const CALL_TIMEOUT_MS = 10_000;
const LIVE_STATES = new Set(["running", "degraded", "starting"]);

interface PluginEntry {
  id: string;
  name: string | null;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  version: string;
}

export interface HubSdk {
  plugins: {
    list(): Promise<{ plugins: readonly PluginEntry[] }>;
    experimental_discoverRpc(args?: { method?: string }): Promise<readonly { pluginId: string }[]>;
    callRpc<T>(args: { pluginId: string; method: string; input?: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T>;
  };
}

type ProviderMethods = typeof schemas.provider;
export type HubItem = StudioItem & { pluginId: string };

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class StudioHub {
  private readonly described = new Map<string, { version: string; info: StudioProviderInfo }>();

  constructor(private readonly sdk: HubSdk) {}

  call<M extends keyof ProviderMethods>(
    pluginId: string,
    method: M,
    input: z.input<ProviderMethods[M]["input"]>,
  ): Promise<z.output<ProviderMethods[M]["output"]>> {
    if (pluginId === STUDIO_PLUGIN_ID) return Promise.reject(new Error("Studio isn't a provider."));
    return this.sdk.plugins.callRpc({
      pluginId,
      method,
      input: input as never,
      outputSchema: schemas.provider[method].output as unknown as z.ZodType<z.output<ProviderMethods[M]["output"]>>,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  }

  /** Every installed, enabled provider, ready or not. */
  async providers(): Promise<ProviderView[]> {
    const [{ plugins }, discovered] = await Promise.all([
      this.sdk.plugins.list(),
      this.sdk.plugins.experimental_discoverRpc({ method: "studio_describe" }).then(
        (methods) => methods.map((method) => method.pluginId),
        () => [] as string[],
      ),
    ]);
    const extra = [...new Set(discovered)].filter((id) => !SUITE.includes(id)).sort();
    const candidates = [...SUITE, ...extra].flatMap((id) => {
      const entry = plugins.find((plugin) => plugin.id === id);
      return entry && entry.enabled && id !== STUDIO_PLUGIN_ID ? [entry] : [];
    });
    return Promise.all(candidates.map((entry) => this.describe(entry)));
  }

  private async describe(entry: PluginEntry): Promise<ProviderView> {
    const base = { pluginId: entry.id, name: entry.name ?? entry.id, panel: null, kinds: [] };
    if (!LIVE_STATES.has(entry.status)) {
      return { ...base, state: "offline", detail: entry.statusDetail ?? `${base.name} isn't running (${entry.status}).` };
    }
    const cached = this.described.get(entry.id);
    if (cached?.version === entry.version) return { ...base, state: "ready", detail: null, panel: cached.info.panel, kinds: cached.info.kinds };
    try {
      const info = await this.call(entry.id, "studio_describe", null);
      this.described.set(entry.id, { version: entry.version, info });
      return { ...base, state: "ready", detail: null, panel: info.panel, kinds: info.kinds };
    } catch (error) {
      if (rpcErrorStatus(error) === 404) {
        return { ...base, state: "outdated", detail: `Update ${base.name} to see its items in Studio.` };
      }
      return { ...base, state: "offline", detail: errorText(error) };
    }
  }

  /** Providers and every ready provider's items; a provider that fails to list goes offline. */
  async overview(): Promise<{ providers: ProviderView[]; items: HubItem[] }> {
    const providers = await this.providers();
    const lists = await Promise.all(
      providers.map(async (provider) => {
        if (provider.state !== "ready") return { provider, items: [] as HubItem[] };
        try {
          const { items } = await this.call(provider.pluginId, "studio_list", null);
          return { provider, items: items.map((item) => ({ ...item, pluginId: provider.pluginId })) };
        } catch (error) {
          return { provider: { ...provider, state: "offline" as const, detail: errorText(error) }, items: [] as HubItem[] };
        }
      }),
    );
    return { providers: lists.map((list) => list.provider), items: lists.flatMap((list) => list.items) };
  }

  /** `<plugin>:<id>` keys whose content matches; providers that fail are skipped. */
  async search(query: string): Promise<string[]> {
    const ready = (await this.providers()).filter((provider) => provider.state === "ready");
    const results = await Promise.all(
      ready.map((provider) =>
        this.call(provider.pluginId, "studio_search", { query }).then(
          ({ ids }) => ids.map((id) => `${provider.pluginId}:${id}`),
          () => [],
        ),
      ),
    );
    return results.flat();
  }
}
