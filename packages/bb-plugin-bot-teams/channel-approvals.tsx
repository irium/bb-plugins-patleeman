import type { ChannelApproval } from "./contract";

export function approvalFor(
  approvals: ChannelApproval[],
  job: { threadId: string | null },
) {
  return approvals.find((a) => a.threadId === job.threadId) ?? null;
}

export function revealApproval(approvalId: string) {
  document
    .getElementById(`approval-${approvalId}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
