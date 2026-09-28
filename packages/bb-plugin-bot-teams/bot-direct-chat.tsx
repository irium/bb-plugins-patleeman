import {
  experimental_Icon as Icon,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import type { DirectThreadView } from "./contract";
import { directStatusPresentation } from "./direct-status";
import { useDirectDraft } from "./direct-draft";

export function DirectMessageStatus({ thread }: { thread: DirectThreadView }) {
  const draft = useSidebarThreadDraft(thread.threadId);
  const localDraft = useDirectDraft(thread.threadId);
  const rowStatus = useSidebarThreadRowStatus(thread.threadId);
  const status = directStatusPresentation(thread,
    draft.hasUnsubmittedDraft || localDraft, rowStatus);
  if (status.shortLabel === "Ready") return null;
  return (
    <span className="channel-nav-status">
      <span className={`bot-thread-status-icon bot-thread-status-${status.tone}`}
        data-motion={status.motion ?? undefined}
        role="img" aria-label={status.label} title={status.label}>
        {status.icon ? <Icon name={status.icon} /> :
          <span className="channel-unread-dot" aria-hidden="true" />}
      </span>
    </span>
  );
}
