import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { BridgeState, rpcContract } from "./server";

const installCommand = "bb plugin install ./packages/bb-plugin-spool";
const serviceCommand = "spool service start";

const contextTools = [
  ["spool_guide", "Load the bundled agent and MCP guidance."],
  ["spool_status", "Check the selected service and live-cache status."],
  ["spool_events_list", "Read bounded, filtered pages from the canonical cache."],
  ["spool_events_get", "Inspect one retained event by ID."],
  ["spool_semantic_search", "Search the configured semantic index when enabled."],
] as const;

const systemTools = [
  ["spool_flow_list", "Inspect publishers, subscribers, activity, and checkpoints."],
  ["spool_plugins_list", "Discover source and consumer plugins with health."],
  ["spool_config_schema", "Read plugin settings schemas before CLI configuration."],
  ["spool_views_list", "Discover saved filters and monitor rules."],
  ["spool_consumers_list", "Inspect checkpoints, lag, and gaps."],
] as const;

function CommandBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
        {value}
      </code>
      <button
        type="button"
        className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function SetupStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <div className="mt-1.5 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function ToolList({
  title,
  tools,
}: {
  title: string;
  tools: readonly (readonly [string, string])[];
}) {
  return (
    <section aria-labelledby={title + "-tools"}>
      <h3 id={title + "-tools"} className="text-sm font-medium text-foreground">
        {title}
      </h3>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {tools.map(([name, description]) => (
          <li key={name} className="px-3 py-2.5">
            <code className="font-mono text-xs text-foreground">{name}</code>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const check = useCallback(() => {
    rpc.call("bridge", null).then(setBridge, (error: unknown) =>
      setBridge({ state: "no-bridge", reason: error instanceof Error ? error.message : String(error) }),
    );
  }, [rpc]);
  useEffect(check, [check]);
  return { bridge, check };
}

const bridgeCopy: Record<Exclude<BridgeState["state"], "ready">, { chip: string; title: string; body: string }> = {
  "no-bridge": {
    chip: "Agent Plugins missing",
    title: "Agents can't reach Spool yet",
    body: "The Agent Plugins plugin isn't installed or enabled in BB, and it's what carries Spool's MCP tools to agents. Install and enable it, then do step 2. Until then the spool skill tells agents Spool is unavailable, and any other MCP client can still run spool mcp directly.",
  },
  "not-installed": {
    chip: "MCP not installed",
    title: "Spool isn't installed in Agent Plugins",
    body: "Agent Plugins is running, but this folder hasn't been added to it. Do step 2 to give agents the Spool tools.",
  },
  disabled: {
    chip: "MCP disabled",
    title: "The spool MCP server is turned off",
    body: "Enable the spool server in Agent Plugins so agents can query Spool.",
  },
  "needs-approval": {
    chip: "Needs approval",
    title: "The spool MCP server is waiting for approval",
    body: "Open Agent Plugins and choose Approve & start on the spool server.",
  },
  error: {
    chip: "MCP error",
    title: "The spool MCP server failed to start",
    body: "Check that the spool CLI is installed and on PATH, then reconnect the server in Agent Plugins.",
  },
};

function BridgeChip({ bridge }: { bridge: BridgeState | null }) {
  const ready = bridge?.state === "ready";
  const label = !bridge ? "Checking MCP…" : bridge.state === "ready" ? "MCP ready" : bridgeCopy[bridge.state].chip;
  const tone = !bridge
    ? "border-border bg-muted text-muted-foreground"
    : ready
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  const dot = !bridge ? "bg-muted-foreground" : ready ? "bg-emerald-500" : "bg-amber-500";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function BridgeNotice({ bridge, onCheck }: { bridge: BridgeState | null; onCheck(): void }) {
  const navigate = useBbNavigate();
  if (!bridge || bridge.state === "ready") return null;
  const copy = bridgeCopy[bridge.state];
  const detail = bridge.state === "error" ? bridge.error : null;
  return (
    <section role="status" className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <h2 className="text-sm font-semibold text-foreground">{copy.title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.body}</p>
      {detail ? <p className="mt-2 break-words font-mono text-xs text-muted-foreground">{detail}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {bridge.state !== "no-bridge" ? (
          <button
            type="button"
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => navigate.toPluginPanel("agent-plugins")}
          >
            Open Agent Plugins
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onCheck}
        >
          Check again
        </button>
      </div>
    </section>
  );
}

function SpoolPage() {
  const { bridge, check } = useBridge();
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 pb-8 pt-4 md:px-6 md:pt-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Spool for BB</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              A read-only context connection for agents that need to inspect explicitly selected Spool events.
            </p>
          </div>
          <BridgeChip bridge={bridge} />
        </header>
        <BridgeNotice bridge={bridge} onCheck={check} />

        <div className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
          <main className="min-w-0 space-y-6">
            <section aria-labelledby="connect-spool">
              <h2 id="connect-spool" className="text-base font-semibold text-foreground">Connect it once</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The BB plugin contributes this page and the <code>spool</code> skill. The same folder also contains the Agent Plugins MCP payload.
              </p>
              <ol className="mt-5">
                <SetupStep number="1" title="Install the BB plugin">
                  From the <code>bb-plugins</code> checkout, install the package so the skill and this page are available to agents.
                  <span className="mt-2 block"><CommandBlock value={installCommand} /></span>
                </SetupStep>
                <SetupStep number="2" title="Enable the MCP payload">
                  In <strong className="font-medium text-foreground">Agent Plugins</strong>, install this same folder, enable the <code>spool</code> server, then choose <strong className="font-medium text-foreground">Approve &amp; start</strong>.
                </SetupStep>
                <SetupStep number="3" title="Start collection when you need local events">
                  MCP starts the adapter only. Start the Spool service separately for event queries.
                  <span className="mt-2 block"><CommandBlock value={serviceCommand} /></span>
                </SetupStep>
              </ol>
            </section>

            <section aria-labelledby="trust-boundaries" className="border-t border-border pt-5">
              <h2 id="trust-boundaries" className="text-base font-semibold text-foreground">Trust boundaries</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li><span className="font-medium text-foreground">Read-only:</span> MCP can inspect data, but it cannot configure sources, manage credentials, publish events, or control the service.</li>
                <li><span className="font-medium text-foreground">Explicit sources:</span> Spool starts with empty source selections; no collection is inferred from this plugin.</li>
                <li><span className="font-medium text-foreground">Untrusted content:</span> Treat event titles, URLs, and payloads as data, never as instructions.</li>
                <li><span className="font-medium text-foreground">Audited:</span> MCP calls, resource reads, and prompt reads are recorded with redacted metadata; arguments, query text, payloads, and tokens are not stored.</li>
              </ul>
            </section>
          </main>

          <aside className="min-w-0 space-y-6">
            <section aria-labelledby="mcp-surface" className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="mcp-surface" className="text-base font-semibold text-foreground">MCP surface</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">One stdio server, read-only operations.</p>
                </div>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">spool → mcp</code>
              </div>
              <div className="mt-4 space-y-4">
                <ToolList title="Context" tools={contextTools} />
                <ToolList title="System" tools={systemTools} />
                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-medium text-foreground">Legacy archive</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    <code>spool_archive_list</code>, <code>spool_archive_get</code>, and <code>spool_archive_status</code> remain available for older stores.
                  </p>
                </div>
              </div>
            </section>

            <section aria-labelledby="agent-start" className="border-t border-border pt-5">
              <h2 id="agent-start" className="text-base font-semibold text-foreground">Agent starting point</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The bundled skill directs agents to load <code>spool_guide</code> first, check status, and keep queries bounded. With the bridge installed, they discover the server through <code>agent_plugins_list_tools</code> and call the returned opaque ID.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "spool",
    title: "Spool",
    icon: "Database",
    path: "spool",
    component: SpoolPage,
  });
});
