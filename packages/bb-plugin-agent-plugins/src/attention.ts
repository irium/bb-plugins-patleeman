// Which MCP servers the app overlay should ask the user to fix.

export type AttentionServer = {
  pluginId: string;
  pluginName: string;
  serverId: string;
  status: string;
  authStatus: string;
  lastError: string | null;
};

type SnapshotLike = {
  plugins: { id: string; name: string }[];
  mcpServers: {
    pluginId: string;
    serverId: string;
    type: string;
    status: string;
    authStatus?: string;
    lastError: string | null;
    approved: number;
    enabled: boolean;
  }[];
};

export function serversNeedingAttention(snapshot: SnapshotLike): AttentionServer[] {
  const names = new Map(snapshot.plugins.map((plugin) => [plugin.id, plugin.name]));
  return snapshot.mcpServers
    .filter((server) => {
      if (!server.enabled || server.approved !== 1 || server.type === "stdio") return false;
      return server.status === "needs-auth" || server.status === "error";
    })
    .map((server) => ({
      pluginId: server.pluginId,
      pluginName: names.get(server.pluginId) ?? server.pluginId,
      serverId: server.serverId,
      status: server.status,
      authStatus: server.authStatus ?? "unknown",
      lastError: server.lastError,
    }));
}
