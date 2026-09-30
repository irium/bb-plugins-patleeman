// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { serversNeedingAttention } from "./attention";

const app = await loadPluginApp(() => import("../app"));
const overlay = app.appOverlays.find((item) => item.id === "mcp-attention")!;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function server(overrides: Record<string, unknown>) {
  return {
    pluginId: "plugin-1",
    serverId: "docs",
    type: "http",
    status: "ready",
    authStatus: "authenticated",
    lastError: null,
    approved: 1,
    enabled: true,
    configJson: "{}",
    ...overrides,
  };
}

function snapshot(mcpServers: ReturnType<typeof server>[]) {
  return {
    plugins: [{ id: "plugin-1", name: "Example Plugin", version: "1.0.0", specVersion: "1", sourceType: "path", sourceIntent: "", sourceResolved: null, status: "active", approval: "approved", lastError: null }],
    skills: [],
    mcpServers,
    dataDir: "/tmp/bb",
  };
}

describe("MCP attention", () => {
  it("flags enabled, approved remote servers that need auth or failed", () => {
    const flagged = serversNeedingAttention(snapshot([
      server({ serverId: "ok" }),
      server({ serverId: "expired", status: "needs-auth", authStatus: "unauthenticated" }),
      server({ serverId: "broken", status: "error", lastError: "401" }),
      server({ serverId: "off", status: "needs-auth", enabled: false }),
      server({ serverId: "unapproved", status: "needs-auth", approved: 0 }),
      server({ serverId: "local", status: "error", type: "stdio" }),
    ]));
    expect(flagged.map((s) => s.serverId)).toEqual(["expired", "broken"]);
    expect(flagged[0]!.pluginName).toBe("Example Plugin");
  });

  it("registers an app overlay and no footer button", () => {
    expect(overlay).toBeDefined();
    expect(app.experimentalSidebarFooterItems).toEqual([]);
  });

  it("renders nothing while every server is connected", async () => {
    const calls: string[] = [];
    const slot = renderSlot(overlay, {}, {
      rpc: { snapshot: () => { calls.push("snapshot"); return snapshot([server({})]); } } as never,
    });
    await waitFor(() => expect(calls).toContain("snapshot"));
    expect(slot.queryByRole("region", { name: "MCP connections" })).toBeNull();
  });

  it("shows servers needing sign-in, starts auth, and closes on request", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const calls: string[] = [];
    const slot = renderSlot(overlay, {}, {
      rpc: {
        snapshot: () => snapshot([server({ status: "needs-auth", authStatus: "unauthenticated" })]),
        authenticate: () => { calls.push("authenticate"); return { url: null, status: "authenticated" }; },
      } as never,
    });

    await slot.findByRole("region", { name: "MCP connections" });
    fireEvent.click(slot.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(calls).toEqual(["authenticate"]));

    fireEvent.click(slot.getByRole("button", { name: "Close" }));
    expect(slot.queryByRole("region", { name: "MCP connections" })).toBeNull();
  });
});
