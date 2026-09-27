import { experimental_Icon as Icon, useSidebarThreadRowStatuses } from "@get-bb/plugin-sdk/app";
import type { RoomWork, ThreadStatusView } from "./contract";
import { StatusBadge } from "./bot-ui";
import { useChannelDraft } from "./channel-draft-state";
import { channelStatusPresentation } from "./channel-status";

export type ChannelStatusInput = {
  roomId: string;
  threads: readonly ThreadStatusView[];
  work?: RoomWork;
  active: boolean;
  unread: boolean;
  needsAttention: boolean;
};

export function useChannelStatus(input: ChannelStatusInput) {
  const draft = useChannelDraft(input.roomId);
  const rowStatuses = useSidebarThreadRowStatuses();
  return channelStatusPresentation({ ...input, work: input.work, draft, rowStatuses });
}

export function ChannelStatusIcon({ status }: {
  status: ReturnType<typeof channelStatusPresentation>;
}) {
  if (status.shortLabel === "Ready") return null;
  return <span className="channel-nav-status">
    <span className={`bot-thread-status-icon bot-thread-status-${status.tone}`}
      data-motion={status.motion ?? undefined}
      role="img" aria-label={status.label} title={status.label}>
      {status.icon ? <Icon name={status.icon} /> :
        <span className="channel-unread-dot" aria-hidden="true" />}
    </span>
  </span>;
}

export function ChannelHeaderStatus(input: ChannelStatusInput) {
  const status = useChannelStatus(input);
  if (status.shortLabel === "Ready") return null;
  return <span className="bot-direct-header-state" title={status.label}>
    <StatusBadge status={status.tone} label={status.shortLabel} />
  </span>;
}
