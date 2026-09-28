import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "./contract";
import { Button } from "./components/ui/button";
import { ChannelMembersMenu } from "./channel-members";
import { ChannelModePicker } from "./channel-mode-picker";
import { ChannelPermissionPicker } from "./channel-permissions";
import { ChannelRail } from "./channel-rail-view";
import { automationsTab } from "./channels";
import {
  channelHandoffText,
  takeChannelThreadHandoff,
} from "./handoff-draft";

/**
 * A channel is a BB thread. These surfaces add what a channel has that a
 * thread does not: its members in the header, its chat mode and permissions
 * beside the composer, and its live work in the thread panel. Each renders
 * nothing on ordinary threads.
 */
export const channelDetailsPanelId = "channel-details";

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
  if (!surface) return null;
  return (
    <div className="channel-thread-header">
      <ChannelMembersMenu room={surface.room} bots={surface.bots} jobs={surface.jobs} onChanged={load} />
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

/** Beside the composer: who answers (Smart / Directed / Everyone) and what bots may do. */
export function ChannelComposerControls() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const { surface, load } = useChannelSurface(threadId);
  // The compact composer is one line; the pickers would cover the prompt.
  if (!surface || view.layout === "compact") return null;
  return (
    <span className="channel-composer-controls">
      <ChannelModePicker room={surface.room} onChanged={load} />
      <ChannelPermissionPicker room={surface.room} bots={surface.bots} onChanged={load} />
    </span>
  );
}

/** Thread panel tab: the channel rail (live work, needs you, members, output). */
export function ChannelDetailsPanel({ threadId }: PluginThreadPanelProps) {
  const { surface, load } = useChannelSurface(threadId);
  if (!surface) return <p className="channel-menu-label">This thread is not a channel.</p>;
  return (
    <ChannelRail
      embedded
      automationsTab={automationsTab}
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
