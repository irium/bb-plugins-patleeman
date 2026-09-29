import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * Spool's MCP process is supplied through the Agent Plugins payload in this
 * package. The BB half owns the skill and setup page; it does not duplicate
 * the MCP gateway with a second native tool surface. It only reports whether
 * that bridge is in place, so the page can say what's missing.
 */

const AGENT_PLUGINS_ID = "agent-plugins";
const PAYLOAD_NAME = "spool";
const SERVER_ID = "spool";

export const bridgeStateSchema = z.discriminatedUnion("state", [
  /** Agent Plugins isn't installed or enabled in BB. */
  z.object({ state: z.literal("no-bridge"), reason: z.string() }),
  /** Agent Plugins is there, but this folder isn't installed in it. */
  z.object({ state: z.literal("not-installed") }),
  z.object({ state: z.literal("disabled") }),
  z.object({ state: z.literal("needs-approval") }),
  z.object({ state: z.literal("error"), error: z.string().nullable() }),
  z.object({ state: z.literal("ready") }),
]);

export type BridgeState = z.infer<typeof bridgeStateSchema>;

export const rpcContract = defineRpcContract({
  bridge: { input: z.null(), output: bridgeStateSchema },
});

const snapshotSchema = z.object({
  plugins: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  mcpServers: z.array(
    z
      .object({
        pluginId: z.string(),
        serverId: z.string(),
        status: z.string(),
        lastError: z.string().nullable().optional(),
        enabled: z.boolean(),
      })
      .passthrough(),
  ),
}).passthrough();

export function bridgeState(snapshot: z.infer<typeof snapshotSchema>): BridgeState {
  const payloads = new Set(snapshot.plugins.filter((plugin) => plugin.name === PAYLOAD_NAME).map((plugin) => plugin.id));
  const server = snapshot.mcpServers.find((entry) => payloads.has(entry.pluginId) && entry.serverId === SERVER_ID);
  if (!server) return { state: "not-installed" };
  if (!server.enabled || server.status === "disabled") return { state: "disabled" };
  if (server.status === "needs-approval") return { state: "needs-approval" };
  if (server.status === "error") return { state: "error", error: server.lastError ?? null };
  return { state: "ready" };
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async bridge() {
      try {
        const snapshot = await bb.sdk.plugins.callRpc({
          pluginId: AGENT_PLUGINS_ID,
          method: "snapshot",
          input: null,
          outputSchema: snapshotSchema,
        });
        return bridgeState(snapshot);
      } catch (error) {
        return { state: "no-bridge" as const, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  bb.log.info("Spool skill and MCP payload ready");
}
