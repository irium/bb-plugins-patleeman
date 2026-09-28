import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "./contract";
import { Button } from "./components/ui/button";
import { ChannelMembersMenu } from "./channel-members";
import { ChannelRail } from "./channel-rail-view";
import { ChannelAutomationsView } from "./channel-automations-view";
import { ChannelSearch } from "./channel-search";
import {
  UsagePanel,
  workbenchLabels,
  type WorkbenchPanel,
} from "./channel-workbench";
import { WorkList } from "./bot-ui";
import { channelHandoffText, takeChannelThreadHandoff } from "./handoff-draft";

/**
 * A channel is a BB thread. These surfaces add what a channel has that a
 * thread does not: its members in the header and its live work in the
 * thread panel. The chat mode and bot permissions are the composer's own
 * model picker (see channel-provider.ts). Each renders nothing on ordinary
 * threads.
 */
export const channelDetailsPanelId = "channel-details";
/** Roomier channel views that open as their own thread panel tabs. */
export const channelWorkbenchPanelIds: Record<WorkbenchPanel, string> = {
  automations: "channel-automations",
  activity: "channel-activity",
  usage: "channel-usage",
};

type Surface = NonNullable<z.output<typeof rpcContract.channelSurface.output>>;

function useChannelSurface(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [surface, setSurface] = useState<Surface | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    if (!threadId) {
      setSurface(null);
      return;
    }
    void rpc.call("channelSurface", { threadId }).then(
      (next) => id === request.current && setSurface(next),
      () => id === request.current && setSurface(null),
    );
  }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime("changed", load);
  return { surface, load };
}

/** Header: who is in the channel, and the button that opens its live work. */
export function ChannelThreadHeader({ threadId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const { surface, load } = useChannelSurface(threadId);
  const [searchOpen, setSearchOpen] = useState(false);
  if (!surface) return null;
  return (
    <div className="channel-thread-header">
      <ChannelMembersMenu room={surface.room} bots={surface.bots} jobs={surface.jobs} onChanged={load} />
      <Button variant="ghost" size="icon" aria-label="Search channel" onClick={() => setSearchOpen(true)}>
        <Icon name="Search" />
      </Button>
      <ChannelSearch id={surface.room.id} open={searchOpen} onOpenChange={setSearchOpen} />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Channel details"
        onClick={() => navigate.openThreadPanel({ actionId: channelDetailsPanelId, title: `#${surface.room.name}` })}
      >
        <Icon name="ListView" />
      </Button>
    </div>
  );
}

/** Thread panel tab: the channel rail (live work, needs you, members, output). */
export function ChannelDetailsPanel({ threadId }: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const { surface, load } = useChannelSurface(threadId);
  if (!surface) return <p className="channel-menu-label">This thread is not a channel.</p>;
  return (
    <ChannelRail
      embedded
      onOpenAutomations={() =>
        navigate.openThreadPanel({ actionId: channelWorkbenchPanelIds.automations })
      }
      room={surface.room}
      bots={surface.bots}
      jobs={surface.jobs}
      runs={surface.runs}
      approvals={surface.approvals}
      messageIds={[]}
      onChanged={load}
    />
  );
}

/** A thread panel tab for one of the channel's workbench views. */
export function channelWorkbenchPanel(panel: WorkbenchPanel) {
  return function ChannelWorkbenchPanel({ threadId }: PluginThreadPanelProps) {
    const { surface } = useChannelSurface(threadId);
    if (!surface) return <p className="channel-menu-label">This thread is not a channel.</p>;
    const { room, bots, jobs } = surface;
    return (
      <section className="channel-workbench" aria-label={workbenchLabels[panel]}>
        {panel === "usage" ? (
          <UsagePanel id={room.id} kind="channel" />
        ) : panel === "automations" ? (
          <ChannelAutomationsView
            id={room.id}
            bots={bots.filter((b) => room.memberIds.includes(b.id))}
            open
            onOpenChange={() => {}}
            presentation="panel"
          />
        ) : (
          <WorkList jobs={jobs} bots={bots} />
        )}
      </section>
    );
  };
}

/** Pre-fills a new channel thread's draft with the thread it was handed off from. */
export function ChannelHandoffPrefill() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  useEffect(() => {
    const source = threadId && takeChannelThreadHandoff(threadId);
    if (!source) return;
    composer.setText(`${channelHandoffText(source)}\n\n${composer.text}`.trimEnd() + "\n\n");
    // Runs once per thread: the saved handoff is consumed on first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  return null;
}
